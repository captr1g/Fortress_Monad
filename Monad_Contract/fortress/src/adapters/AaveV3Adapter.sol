// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "../interfaces/IFortProtocol.sol";
import "../interfaces/IAaveV3Pool.sol";

/// @title AaveV3Adapter — stateless `IFortProtocol` adapter for an Aave V3 market
///
/// @notice Supplies vault USDC into an Aave V3 reserve and redeems it back. One
///         implementation serves **both** Monad markets: `Aave V3 Monad` and the
///         `Neverland Market V3` fork. They differ only in their (pool, aToken)
///         pair, which is fixed per deployment.
///
/// @dev **Added under explicit operator instruction.** The Monad port shipped with
///      no Aave integration on purpose — port prompt §3.4 requires an explicit
///      instruction before integrating a protocol that merely exists on the chain,
///      and `DeployMonad.s.sol` recorded the missing `"Aave"` registry key as a
///      deliberate omission. That instruction was given; this is the result.
///
///      It does **not** fill one of the three reserved adapter slots. `PENDING.md`
///      keeps ids 3/4/5 empty for eventual Compound V3 / Aerodrome / YO
///      replacements, and forbids substituting Aave for any of them. This adapter
///      is registered under its own vault registry keys, not against a reserved id.
///
///      **Why one contract and two deployments.** `pool` and `aToken` are
///      immutables, so each market needs its own implementation deployment behind
///      its own proxy. The alternative — one implementation with the pool in
///      storage — would add a cold SLOAD to every deposit and withdraw, and Monad
///      prices a cold SLOAD at ~8,100 gas. Immutables are free. The constructor
///      proves the wiring instead of trusting it (see below).
///
///      **Rebasing, not share-based.** aTokens are not ERC-4626 shares: `balanceOf`
///      is `scaledBalance × liquidityIndex` and grows in place. Aave's own
///      `asset()`, `totalAssets()` and `maxDeposit()` all revert, which is why
///      `FortVault`'s `isERC4626` fast path cannot drive this and an adapter is
///      required. The `shares` argument of `redeemFor` is therefore an amount of
///      aTokens denominated in underlying, not a share count.
///
///      **No slippage surface.** Supply and withdraw are 1:1 against the underlying
///      — there is no value-converting leg, no route, and no external target chosen
///      by the caller. I5 (target + selector allowlists) and I8 (caller-supplied
///      minimum) have nothing to bite on here; the pool is fixed at construction
///      and `FortVault` still applies its own `minUsdcOut` on the way out.
///
///      Invariants held: I1 (no residual balance), I2 (position credited straight
///      to the receiver via Aave's `onBehalfOf`), I6 (amounts are protocol-computed),
///      I7 (approval scoped to the exact amount and revoked in the same
///      transaction), plus delta-based verification against pre-call snapshots.
contract AaveV3Adapter is IFortProtocol, Ownable2StepUpgradeable, UUPSUpgradeable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using LibAaveReserve for uint256;

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @dev Aave referral codes are inert — the programme was never activated.
    uint16 internal constant REFERRAL_CODE = 0;

    /// @dev One ray. The liquidity index's scale.
    uint256 internal constant RAY = 1e27;

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    IERC20 public immutable usdc;
    IAaveV3Pool public immutable pool;
    IAToken public immutable aToken;

    address public vault;

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error OnlyVault();
    error ZeroAmount();
    error ZeroAddress();
    /// @notice The (pool, aToken, underlying) triple does not agree on chain.
    error WiringMismatch();
    error ReserveNotActive();
    error ReserveFrozen();
    error ReservePaused();
    /// @notice Supplying `requested` would breach the reserve's supply cap.
    error ProtocolAtCapacity(uint256 requested, uint256 capacity);
    /// @notice The receiver was not credited the aTokens the supply should have minted.
    error SupplyCreditShortfall(uint256 received, uint256 expected);
    /// @notice The pool returned less underlying than the aTokens burned.
    error WithdrawShortfall(uint256 received, uint256 expected);

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event Supplied(address indexed caller, address indexed receiver, uint256 usdcIn, uint256 aTokensCredited);
    event Redeemed(address indexed owner, address indexed receiver, uint256 aTokensBurned, uint256 usdcOut);
    event VaultUpdated(address indexed oldVault, address indexed newVault);

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTION
    //////////////////////////////////////////////////////////////*/

    /// @param _usdc The reserve's underlying asset.
    /// @param _pool The market's Pool proxy.
    /// @param _aToken The market's aToken for `_usdc`.
    ///
    /// @dev The three arguments are cross-checked against each other on chain, so a
    ///      deployment cannot be wired to the wrong market. Pointing the Neverland
    ///      aToken at the Aave pool, or either aToken at the wrong underlying,
    ///      reverts here rather than at the first user deposit. Both markets expose
    ///      `POOL()` and `UNDERLYING_ASSET_ADDRESS()`, so this holds for both.
    ///
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _usdc, address _pool, address _aToken) {
        if (_usdc == address(0) || _pool == address(0) || _aToken == address(0)) revert ZeroAddress();
        if (IAToken(_aToken).POOL() != _pool) revert WiringMismatch();
        if (IAToken(_aToken).UNDERLYING_ASSET_ADDRESS() != _usdc) revert WiringMismatch();

        usdc = IERC20(_usdc);
        pool = IAaveV3Pool(_pool);
        aToken = IAToken(_aToken);
        _disableInitializers();
    }

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    function initialize(address _owner, address _vault) external initializer {
        if (_owner == address(0) || _vault == address(0)) revert ZeroAddress();
        __Ownable_init(_owner);
        __Ownable2Step_init();
        vault = _vault;
    }

    /*//////////////////////////////////////////////////////////////
                              OWNER: CONFIG
    //////////////////////////////////////////////////////////////*/

    function setVault(address _vault) external onlyOwner {
        if (_vault == address(0)) revert ZeroAddress();
        address old = vault;
        vault = _vault;
        emit VaultUpdated(old, _vault);
    }

    /*//////////////////////////////////////////////////////////////
                                  VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @notice Underlying that can still be supplied before the cap binds.
    /// @return `type(uint256).max` when the reserve is uncapped, `0` when it cannot
    ///         accept a deposit at all (inactive, frozen, paused, or already at cap).
    ///
    /// @dev **Approximate at the boundary, and deliberately so.** Aave compares
    ///      `scaledTotalSupply.rayMul(nextLiquidityIndex) + accruedToTreasury + amount`
    ///      against the cap. This reads `aToken.totalSupply()`, which is the same
    ///      product at the CURRENT index and excludes `accruedToTreasury`, so it can
    ///      report slightly more headroom than Aave will actually allow.
    ///
    ///      Reproducing Aave's arithmetic exactly would mean decoding a
    ///      `ReserveData` struct whose layout differs between the two markets this
    ///      adapter serves — see `IAaveV3Pool`. The trade is intentional: the guard
    ///      turns the overwhelmingly common cap failure into an attributable revert,
    ///      and within a rounding-scale band of the cap Aave's own check still
    ///      backstops it. On the live reserves the gap is immaterial — Aave's Monad
    ///      USDC market carried ~38k of accrued treasury against ~108M of headroom.
    function availableCapacity() public view returns (uint256) {
        uint256 config = pool.getConfiguration(address(usdc));
        if (!config.isActive() || config.isFrozen() || config.isPaused()) return 0;

        uint256 cap = config.supplyCap();
        if (cap == 0) return type(uint256).max;

        uint256 capInUnits = cap * (10 ** config.decimals());
        uint256 supplied = aToken.totalSupply();
        return supplied >= capInUnits ? 0 : capInUnits - supplied;
    }

    /*//////////////////////////////////////////////////////////////
                                DEPOSIT
    //////////////////////////////////////////////////////////////*/

    /// @notice Supply USDC into the reserve, crediting aTokens to `receiver`.
    /// @param usdcAmount USDC pulled from the vault.
    /// @param receiver Address credited with aTokens (I2 — the pool credits it
    ///        directly through `onBehalfOf`; the position never rests here).
    function depositFor(uint256 usdcAmount, address receiver) external override onlyVault nonReentrant {
        if (usdcAmount == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();

        _requireCanSupply(usdcAmount);

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Delta against a pre-call snapshot, never an absolute balance. The snapshot
        // is taken before `supply`, which accrues the reserve's index, so any
        // interest that lands on the receiver's EXISTING balance is counted here
        // too. That only makes the credit check slacker, never stricter.
        uint256 creditBefore = aToken.balanceOf(receiver);

        // I7: approve exactly this deposit, revoked below in the same transaction.
        usdc.forceApprove(address(pool), usdcAmount);
        pool.supply(address(usdc), usdcAmount, receiver, REFERRAL_CODE);
        usdc.forceApprove(address(pool), 0);

        uint256 credited = aToken.balanceOf(receiver) - creditBefore;
        if (credited + _roundingTolerance() < usdcAmount) {
            revert SupplyCreditShortfall(credited, usdcAmount);
        }

        // I1: a pool that consumed less than it was approved would strand USDC here.
        _sweep(usdc, msg.sender);

        emit Supplied(msg.sender, receiver, usdcAmount, credited);
    }

    /*//////////////////////////////////////////////////////////////
                                 REDEEM
    //////////////////////////////////////////////////////////////*/

    /// @notice Burn `shares` of aTokens held by `owner` and send USDC to `receiver`.
    /// @param shares Amount of aTokens, denominated in underlying — NOT a share
    ///        count. aTokens rebase; `balanceOf` is already in USDC terms.
    /// @param receiver Address that receives the USDC.
    /// @param owner Holder the aTokens are pulled from. Must have approved this
    ///        adapter on the aToken.
    /// @return usdcOut USDC delivered to `receiver`.
    function redeemFor(uint256 shares, address receiver, address owner)
        external
        override
        onlyVault
        nonReentrant
        returns (uint256 usdcOut)
    {
        if (shares == 0) revert ZeroAmount();
        if (receiver == address(0) || owner == address(0)) revert ZeroAddress();

        _requireCanWithdraw();

        // Withdraw the amount actually received, not the amount requested. An
        // aToken transfer routes through the scaled balance and can land a unit
        // below `shares`; withdrawing `shares` would then revert on a balance the
        // adapter does not have.
        uint256 aBefore = aToken.balanceOf(address(this));
        IERC20(address(aToken)).safeTransferFrom(owner, address(this), shares);
        uint256 pulled = aToken.balanceOf(address(this)) - aBefore;
        if (pulled == 0) revert ZeroAmount();

        uint256 usdcBefore = usdc.balanceOf(address(this));
        pool.withdraw(address(usdc), pulled, address(this));
        usdcOut = usdc.balanceOf(address(this)) - usdcBefore;

        // The pool's return value is not taken on trust; the measured delta is.
        if (usdcOut + _roundingTolerance() < pulled) {
            revert WithdrawShortfall(usdcOut, pulled);
        }

        usdc.safeTransfer(receiver, usdcOut);

        // I1: a partial withdrawal would otherwise leave aTokens here. They belong
        // to whoever supplied them.
        _sweep(IERC20(address(aToken)), owner);

        emit Redeemed(owner, receiver, pulled, usdcOut);
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNAL
    //////////////////////////////////////////////////////////////*/

    /// @dev Turns Aave's numeric error strings ('2' frozen, '28' paused, '51' supply
    ///      cap exceeded, …) into named reverts before any value moves. `FortVault`
    ///      does the same for its ERC-4626 path with `ProtocolAtCapacity`; adapters
    ///      have to do it themselves.
    function _requireCanSupply(uint256 usdcAmount) internal view {
        uint256 config = pool.getConfiguration(address(usdc));
        if (!config.isActive()) revert ReserveNotActive();
        if (config.isPaused()) revert ReservePaused();
        if (config.isFrozen()) revert ReserveFrozen();

        uint256 cap = config.supplyCap();
        if (cap == 0) return; // uncapped

        uint256 capInUnits = cap * (10 ** config.decimals());
        uint256 supplied = aToken.totalSupply();
        uint256 capacity = supplied >= capInUnits ? 0 : capInUnits - supplied;
        if (usdcAmount > capacity) revert ProtocolAtCapacity(usdcAmount, capacity);
    }

    /// @dev A frozen reserve still permits withdrawals — freezing blocks new supply
    ///      and borrowing, it does not trap existing positions. Only inactive and
    ///      paused reserves block the exit, so only those are rejected here.
    function _requireCanWithdraw() internal view {
        uint256 config = pool.getConfiguration(address(usdc));
        if (!config.isActive()) revert ReserveNotActive();
        if (config.isPaused()) revert ReservePaused();
    }

    /// @dev Slack allowed on a scaled-balance round trip, in the underlying's
    ///      smallest unit.
    ///
    ///      Aave stores `amount.rayDiv(index)` and reports `scaled.rayMul(index)`.
    ///      Both round half-up, so the reported figure can differ from `amount` by
    ///      up to `0.5 × index/RAY + 0.5` units — the error is NOT a fixed 1 unit,
    ///      it grows with the index. A fixed tolerance passes today (Aave Monad's
    ///      index is 1.004 ray, Neverland's 1.023) and would start reverting good
    ///      deposits once an index passed ~2 ray. A fuzz run over indices up to
    ///      10 ray found it: a 999,999-USDC supply came back 3 units light.
    ///
    ///      `index/RAY + 1` covers both halves of the bound with integer division.
    ///
    ///      This is a liveness check on the credit — it catches a pool that takes
    ///      the underlying without crediting the position — not an accounting
    ///      reconciliation.
    function _roundingTolerance() internal view returns (uint256) {
        return pool.getReserveNormalizedIncome(address(usdc)) / RAY + 1;
    }

    /// @dev Returns any leftover balance of `token` to `to`. Zero-cost when clean.
    function _sweep(IERC20 token, address to) internal {
        uint256 residual = token.balanceOf(address(this));
        if (residual > 0) token.safeTransfer(to, residual);
    }

    /*//////////////////////////////////////////////////////////////
                                EMERGENCY
    //////////////////////////////////////////////////////////////*/

    /// @notice Rescue tokens accidentally sent to the adapter.
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    /*//////////////////////////////////////////////////////////////
                                  UUPS
    //////////////////////////////////////////////////////////////*/

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /*//////////////////////////////////////////////////////////////
                               STORAGE GAP
    //////////////////////////////////////////////////////////////*/

    uint256[50] private __gap;
}
