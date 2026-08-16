// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "../interfaces/IFortProtocolEx.sol";
import "../interfaces/IAerodromeRouter.sol";
import "../interfaces/IAerodromeGauge.sol";

/// @title AerodromeAdapter — stateless adapter for Aerodrome Finance LP yield
/// @notice Swaps half USDC to paired token, provides liquidity, stakes LP in Gauge.
///         Implements IFortProtocolEx (requires data for swap/LP params).
contract AerodromeAdapter is IFortProtocolEx, Ownable2StepUpgradeable, UUPSUpgradeable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IAerodromeRouter public immutable router;
    address public immutable factory;

    struct PoolConfig {
        address pool;
        address gauge;
        address pairedToken;
        bool stable;
    }

    mapping(bytes32 => PoolConfig) public pools;

    address public vault;

    error ZeroAmount();
    error OnlyVault();
    error InvalidData();
    error DeadlineExpired();
    error UnauthorizedPool(bytes32 poolKey);
    error PoolAlreadyExists(bytes32 poolKey);
    error PoolNotFound(bytes32 poolKey);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _usdc, address _router, address _factory) {
        usdc = IERC20(_usdc);
        router = IAerodromeRouter(_router);
        factory = _factory;
        _disableInitializers();
    }

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    function initialize(address _owner, address _vault) external initializer {
        __Ownable_init(_owner);
        __Ownable2Step_init();
        vault = _vault;
    }

    function setVault(address _vault) external onlyOwner {
        vault = _vault;
    }

    // ──── Owner: Pool whitelist ────

    function addPool(
        string calldata name,
        address pool,
        address gauge,
        address pairedToken,
        bool stable
    ) external onlyOwner {
        bytes32 key = keccak256(bytes(name));
        if (pools[key].pool != address(0)) revert PoolAlreadyExists(key);
        pools[key] = PoolConfig(pool, gauge, pairedToken, stable);
    }

    function removePool(string calldata name) external onlyOwner {
        bytes32 key = keccak256(bytes(name));
        if (pools[key].pool == address(0)) revert PoolNotFound(key);
        delete pools[key];
    }

    // ──── IFortProtocol (no-data) — revert ────

    function depositFor(uint256, address) external pure override {
        revert InvalidData();
    }

    function redeemFor(uint256, address, address) external view override onlyVault returns (uint256) {
        revert InvalidData();
    }

    // ──── IFortProtocolEx (with data) ────

    /// @notice Deposit USDC: swap half to paired token, add liquidity, stake LP
    /// @dev data = abi.encode(bytes32 poolKey, uint256 minPairedOut, uint256 amountAMin, uint256 amountBMin, uint256 deadline)
    function depositFor(uint256 usdcAmount, address receiver, bytes calldata data) external override onlyVault nonReentrant {
        if (usdcAmount == 0) revert ZeroAmount();
        if (data.length == 0) revert InvalidData();

        (
            bytes32 poolKey,
            uint256 minPairedOut,
            uint256 amountAMin,
            uint256 amountBMin,
            uint256 deadline
        ) = abi.decode(data, (bytes32, uint256, uint256, uint256, uint256));

        if (block.timestamp > deadline) revert DeadlineExpired();

        PoolConfig memory pc = pools[poolKey];
        if (pc.pool == address(0)) revert UnauthorizedPool(poolKey);

        // Pull USDC from caller
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Swap half USDC to paired token
        uint256 halfUsdc = usdcAmount / 2;
        uint256 remainUsdc = usdcAmount - halfUsdc;

        usdc.forceApprove(address(router), halfUsdc);

        IAerodromeRouter.Route[] memory routes = new IAerodromeRouter.Route[](1);
        routes[0] = IAerodromeRouter.Route({
            from: address(usdc),
            to: pc.pairedToken,
            stable: pc.stable,
            factory: factory
        });

        uint256[] memory amounts = router.swapExactTokensForTokens(
            halfUsdc,
            minPairedOut,
            routes,
            address(this),
            deadline
        );
        uint256 pairedAmount = amounts[amounts.length - 1];

        // Add liquidity
        usdc.forceApprove(address(router), remainUsdc);
        IERC20(pc.pairedToken).forceApprove(address(router), pairedAmount);

        (,, uint256 liquidity) = router.addLiquidity(
            address(usdc),
            pc.pairedToken,
            pc.stable,
            remainUsdc,
            pairedAmount,
            amountAMin,
            amountBMin,
            address(this),
            deadline
        );

        // Clear residual router approvals
        usdc.forceApprove(address(router), 0);
        IERC20(pc.pairedToken).forceApprove(address(router), 0);

        // Stake LP in gauge for receiver
        IERC20(pc.pool).forceApprove(pc.gauge, liquidity);
        IAerodromeGauge(pc.gauge).deposit(liquidity, receiver);

        // Return dust to receiver
        uint256 usdcDust = usdc.balanceOf(address(this));
        if (usdcDust > 0) {
            usdc.safeTransfer(receiver, usdcDust);
        }

        uint256 pairedDust = IERC20(pc.pairedToken).balanceOf(address(this));
        if (pairedDust > 0) {
            IERC20(pc.pairedToken).safeTransfer(receiver, pairedDust);
        }
    }

    /// @notice Redeem: unstake LP, remove liquidity, swap paired to USDC
    /// @dev data = abi.encode(bytes32 poolKey, uint256 minAmountA, uint256 minAmountB, uint256 minUsdcFromSwap, uint256 deadline)
    function redeemFor(uint256 shares, address receiver, address owner, bytes calldata data) external override onlyVault nonReentrant returns (uint256 usdcOut) {
        if (shares == 0) revert ZeroAmount();
        if (data.length == 0) revert InvalidData();

        (
            bytes32 poolKey,
            uint256 minAmountA,
            uint256 minAmountB,
            uint256 minUsdcFromSwap,
            uint256 deadline
        ) = abi.decode(data, (bytes32, uint256, uint256, uint256, uint256));

        if (block.timestamp > deadline) revert DeadlineExpired();

        PoolConfig memory pc = pools[poolKey];
        if (pc.pool == address(0)) revert UnauthorizedPool(poolKey);

        // Pull gauge tokens from owner
        IERC20(pc.gauge).safeTransferFrom(owner, address(this), shares);

        // Withdraw LP from gauge (also claims pending rewards)
        IAerodromeGauge(pc.gauge).withdraw(shares);

        // Sweep any AERO rewards to receiver
        address rewardToken = IAerodromeGauge(pc.gauge).rewardToken();
        uint256 rewardBal = IERC20(rewardToken).balanceOf(address(this));
        if (rewardBal > 0) IERC20(rewardToken).safeTransfer(receiver, rewardBal);

        // Remove liquidity
        IERC20(pc.pool).forceApprove(address(router), shares);
        (uint256 amountUsdc, uint256 amountPaired) = router.removeLiquidity(
            address(usdc),
            pc.pairedToken,
            pc.stable,
            shares,
            minAmountA,
            minAmountB,
            address(this),
            deadline
        );

        // Clear residual LP approval
        IERC20(pc.pool).forceApprove(address(router), 0);

        // Swap paired token back to USDC
        uint256 swappedUsdc;
        if (amountPaired > 0) {
            IERC20(pc.pairedToken).forceApprove(address(router), amountPaired);

            IAerodromeRouter.Route[] memory routes = new IAerodromeRouter.Route[](1);
            routes[0] = IAerodromeRouter.Route({
                from: pc.pairedToken,
                to: address(usdc),
                stable: pc.stable,
                factory: factory
            });

            uint256[] memory amounts = router.swapExactTokensForTokens(
                amountPaired,
                minUsdcFromSwap,
                routes,
                address(this),
                deadline
            );
            swappedUsdc = amounts[amounts.length - 1];

            // Clear residual paired token approval
            IERC20(pc.pairedToken).forceApprove(address(router), 0);
        }

        usdcOut = amountUsdc + swappedUsdc;
        usdc.safeTransfer(receiver, usdcOut);
    }

    // ──── Permissionless: Claim rewards ────

    /// @notice Claim AERO rewards from gauge for account
    function claimRewards(bytes32 poolKey, address account) external {
        PoolConfig memory pc = pools[poolKey];
        if (pc.pool == address(0)) revert UnauthorizedPool(poolKey);
        IAerodromeGauge(pc.gauge).getReward(account);
    }

    // ──── Emergency ────

    /// @notice Rescue tokens accidentally sent to adapter
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    // ──── UUPS ────

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ──── Storage Gap ────

    uint256[50] private __gap;
}
