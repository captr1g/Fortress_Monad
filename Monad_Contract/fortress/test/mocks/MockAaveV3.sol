// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../src/interfaces/IAaveV3Pool.sol";

/// @notice Builds Aave V3 reserve-configuration bitmaps for tests.
/// @dev Mirrors the bit layout `LibAaveReserve` reads, so a test can express
///      "frozen", "paused" or "capped at N" without hand-packing a uint256.
library MockAaveConfig {
    function build(uint256 decimals, bool active, bool frozen, bool paused, uint256 supplyCapWholeTokens)
        internal
        pure
        returns (uint256 config)
    {
        config = decimals << 48;
        if (active) config |= uint256(1) << 56;
        if (frozen) config |= uint256(1) << 57;
        if (paused) config |= uint256(1) << 60;
        config |= (supplyCapWholeTokens & 0xFFFFFFFFF) << 116;
    }

    /// @dev The common case: live, uncapped, 6-decimal reserve.
    function open(uint256 decimals) internal pure returns (uint256) {
        return build(decimals, true, false, false, 0);
    }
}

/// @notice Rebasing aToken mock, faithful to Aave's scaled-balance accounting.
///
/// @dev Balances are stored SCALED and reported as `scaled × index`, exactly as
///      Aave does. This matters: it is the reason `AaveV3Adapter` withdraws the
///      amount it measured rather than the amount it was asked for. A flat
///      1:1 ERC-20 mock would make that code path look like dead weight and hide
///      the off-by-one it exists to absorb.
///
///      `index` starts at 1 ray and can be advanced with `setIndex` to simulate
///      interest accrual between calls.
contract MockAToken is IAToken {
    uint256 internal constant RAY = 1e27;

    string public name = "Mock aToken";
    string public symbol = "maUSDC";
    uint8 public decimals;

    address public immutable pool;
    address public immutable underlying;

    /// @notice Liquidity index, in ray. 1e27 == 1.0.
    uint256 public index = RAY;

    mapping(address => uint256) public scaledBalanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public scaledTotalSupply;

    error OnlyPool();
    error InsufficientBalance();
    error InsufficientAllowance();

    constructor(address _pool, address _underlying, uint8 _decimals) {
        pool = _pool;
        underlying = _underlying;
        decimals = _decimals;
    }

    modifier onlyPool() {
        if (msg.sender != pool) revert OnlyPool();
        _;
    }

    function POOL() external view returns (address) {
        return pool;
    }

    function UNDERLYING_ASSET_ADDRESS() external view returns (address) {
        return underlying;
    }

    /// @notice Advance the liquidity index to simulate accrued interest.
    function setIndex(uint256 newIndex) external {
        index = newIndex;
    }

    function _rayDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a * RAY + b / 2) / b;
    }

    function _rayMul(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a * b + RAY / 2) / RAY;
    }

    function balanceOf(address account) public view returns (uint256) {
        return _rayMul(scaledBalanceOf[account], index);
    }

    function totalSupply() public view returns (uint256) {
        return _rayMul(scaledTotalSupply, index);
    }

    function mint(address to, uint256 amount) external onlyPool {
        uint256 scaled = _rayDiv(amount, index);
        scaledBalanceOf[to] += scaled;
        scaledTotalSupply += scaled;
    }

    function burn(address from, uint256 amount) external onlyPool {
        uint256 scaled = _rayDiv(amount, index);
        if (scaledBalanceOf[from] < scaled) revert InsufficientBalance();
        scaledBalanceOf[from] -= scaled;
        scaledTotalSupply -= scaled;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        uint256 scaled = _rayDiv(amount, index);
        if (scaledBalanceOf[from] < scaled) revert InsufficientBalance();
        scaledBalanceOf[from] -= scaled;
        scaledBalanceOf[to] += scaled;
    }
}

/// @notice Aave V3 Pool mock covering the three functions `AaveV3Adapter` calls.
///
/// @dev Enforces the same guards the real pool does — inactive, frozen, paused and
///      supply cap — so a test can prove the adapter rejects them FIRST, with a
///      named error, instead of letting an anonymous numeric revert bubble up.
contract MockAavePool is IAaveV3Pool {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlying;
    MockAToken public aToken;

    uint256 internal config;

    /// @notice When set, `withdraw` delivers only this fraction of the request, in
    ///         basis points. Models a pool short of liquidity.
    uint256 public withdrawFillBps = 10_000;

    /// @notice When set, `supply` credits only this fraction of the deposit, in
    ///         basis points. Models a pool that takes the underlying without fully
    ///         crediting the position — the failure the adapter's delta check on
    ///         the receiver exists to catch.
    uint256 public supplyCreditBps = 10_000;

    error ReserveInactive();
    error ReserveFrozenErr();
    error ReservePausedErr();
    error SupplyCapExceeded();

    constructor(address _underlying, uint8 _decimals) {
        underlying = IERC20(_underlying);
        aToken = new MockAToken(address(this), _underlying, _decimals);
        config = MockAaveConfig.open(_decimals);
    }

    function setConfiguration(uint256 _config) external {
        config = _config;
    }

    function setWithdrawFillBps(uint256 bps) external {
        withdrawFillBps = bps;
    }

    function setSupplyCreditBps(uint256 bps) external {
        supplyCreditBps = bps;
    }

    function getConfiguration(address) external view returns (uint256) {
        return config;
    }

    function getReserveNormalizedIncome(address) external view returns (uint256) {
        return aToken.index();
    }

    function supply(address asset, uint256 amount, address onBehalfOf, uint16) external {
        _validateSupply(amount);
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        aToken.mint(onBehalfOf, (amount * supplyCreditBps) / 10_000);
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        if ((config >> 56) & 1 == 0) revert ReserveInactive();
        if ((config >> 60) & 1 != 0) revert ReservePausedErr();

        uint256 delivered = (amount * withdrawFillBps) / 10_000;
        aToken.burn(msg.sender, amount);
        IERC20(asset).safeTransfer(to, delivered);
        return delivered;
    }

    function _validateSupply(uint256 amount) internal view {
        if ((config >> 56) & 1 == 0) revert ReserveInactive();
        if ((config >> 60) & 1 != 0) revert ReservePausedErr();
        if ((config >> 57) & 1 != 0) revert ReserveFrozenErr();

        uint256 cap = (config >> 116) & 0xFFFFFFFFF;
        if (cap == 0) return;
        uint256 capInUnits = cap * (10 ** ((config >> 48) & 0xFF));
        if (aToken.totalSupply() + amount > capInUnits) revert SupplyCapExceeded();
    }
}
