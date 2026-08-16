// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "../interfaces/IFortProtocolEx.sol";
import "../interfaces/IShMonad.sol";
import "../interfaces/ILiFi.sol";
import "../config/MonadAddresses.sol";

/// @title ShMonadAdapter — stakes vault USDC into FastLane shMONAD via a MON leg
///
/// @notice Two legs in, two legs out:
///
///           deposit:  USDC --(LI.FI ERC20->native)--> MON --(shMONAD)--> shMON
///           redeem:   shMON --(shMONAD)--> MON --(LI.FI native->ERC20)--> USDC
///
/// @dev **Why this needs an adapter at all.** shMONAD is ERC-4626 shaped, but its
///      `asset()` is the native-MON sentinel `0xEeee…`, not an ERC-20. `FortVault`'s
///      `isERC4626` fast path does `IERC20(asset).transferFrom`, which cannot work
///      against a sentinel, and shMONAD's `deposit` is **payable** — it takes the
///      MON as `msg.value` and reverts (`0x309a6b54`) without it.
///
///      **The swap leg reuses `LiFiAdapter` rather than re-implementing it.** All of
///      I5 and I8 — DEX address allowlist, per-leg selector allowlist, route
///      end-asset checks, balance-delta verification, deadline — live there and are
///      enforced on the nested call. A second copy would be a second allowlist to
///      keep in step, and it would drift. This adapter's own job is narrower:
///      custody hygiene across the MON hop, and slippage on both legs.
///
///      That reuse is what Phase 4 task 11 unlocked. The `ERC20->native` and
///      `native->ERC20` variants of GenericSwapFacetV3 exist in `LiFiAdapter`
///      because shMONAD needs them (DECISIONS.md D4-1); this is the caller.
///
///      **The exit is not free, and callers must price it.** shMONAD applies a real
///      haircut on redemption — 0.645% at the pinned block, measured as
///      `previewRedeem` against `convertToAssets`, with a 0.653% round-trip loss.
///      `previewRedeem` matched the realised amount exactly. A caller sizing
///      `minMonOut` off `convertToAssets` will be wrong by roughly that much, which
///      is why `previewRedeemMon` is exposed here.
///
///      **Slippage is enforced per leg, not just end to end.** A single end-to-end
///      minimum would let a bad swap hide behind a good exchange rate, or the
///      reverse. Both legs carry their own caller-supplied floor (I8).
///
///      Invariants held: I1 (no residual USDC, MON or shMON), I2 (shMON minted
///      straight to the receiver; USDC forwarded to it), I6 (leg amounts are
///      measured on chain, never taken from calldata), I7 (approvals scoped and
///      revoked in the same transaction), I8 (a minimum on every converting leg).
contract ShMonadAdapter is IFortProtocolEx, Ownable2StepUpgradeable, UUPSUpgradeable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using LibLiFi for LibLiFi.SwapKind;

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice FORTRESS's marker for native MON.
    address public constant NATIVE = MonadAddresses.NATIVE;

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    IERC20 public immutable usdc;
    IShMonad public immutable shMonad;

    /// @notice The `LiFiAdapter` proxy this adapter routes its MON leg through.
    ILiFiSwapper public immutable swapper;

    address public vault;

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error InvalidData();
    error OnlyVault();
    error ZeroAmount();
    error ZeroAddress();
    error DeadlineExpired();
    /// @notice shMONAD's `asset()` is not the native sentinel this adapter expects.
    error UnexpectedAsset(address asset);
    /// @notice The swap leg's variant does not move value in the required direction.
    error KindMismatch();
    error SlippageExceeded(uint256 received, uint256 minimum);
    /// @notice shMONAD would not accept a deposit of this size.
    error ProtocolAtCapacity(uint256 requested, uint256 capacity);
    /// @notice Native MON arrived from a contract this adapter does not transact with.
    error UnexpectedNative();
    error NativeTransferFailed();

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event Staked(address indexed caller, address indexed receiver, uint256 usdcIn, uint256 monIn, uint256 sharesOut);
    event Unstaked(address indexed owner, address indexed receiver, uint256 sharesIn, uint256 monOut, uint256 usdcOut);
    event VaultUpdated(address indexed oldVault, address indexed newVault);

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTION
    //////////////////////////////////////////////////////////////*/

    /// @dev Proves on chain that shMONAD really is native-denominated. If FastLane
    ///      ever repoints `asset()` at an ERC-20, this adapter's whole premise is
    ///      wrong and the deployment fails here rather than at the first deposit.
    ///
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _usdc, address _shMonad, address _swapper) {
        if (_usdc == address(0) || _shMonad == address(0) || _swapper == address(0)) revert ZeroAddress();
        address asset = IShMonad(_shMonad).asset();
        if (asset != MonadAddresses.NATIVE) revert UnexpectedAsset(asset);

        usdc = IERC20(_usdc);
        shMonad = IShMonad(_shMonad);
        swapper = ILiFiSwapper(_swapper);
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

    /// @notice Accepts MON from the two contracts this adapter transacts with:
    ///         shMONAD on redemption, and the swap adapter on an ERC20->native leg
    ///         or an unspent-input refund.
    /// @dev Anything else is rejected. Unattributed MON sitting here would be
    ///      indistinguishable from a leg's proceeds and could be swept into the
    ///      next caller's position.
    receive() external payable {
        if (msg.sender != address(shMonad) && msg.sender != address(swapper)) revert UnexpectedNative();
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

    /// @notice MON actually obtainable for `shares`, haircut included.
    /// @dev Quote `minMonOut` against this, never against `convertToAssets` — the
    ///      two differed by 0.645% at the pinned block.
    function previewRedeemMon(uint256 shares) external view returns (uint256) {
        return shMonad.previewRedeem(shares);
    }

    /// @notice MON shMONAD will still accept.
    function availableCapacity() external view returns (uint256) {
        return shMonad.maxDeposit(address(this));
    }

    /*//////////////////////////////////////////////////////////////
                    IFortProtocol (no-data) — revert
    //////////////////////////////////////////////////////////////*/

    function depositFor(uint256, address) external pure override {
        revert InvalidData();
    }

    function redeemFor(uint256, address, address) external view override onlyVault returns (uint256) {
        revert InvalidData();
    }

    /*//////////////////////////////////////////////////////////////
                       IFortProtocolEx (with data)
    //////////////////////////////////////////////////////////////*/

    /// @notice USDC -> MON -> shMON, with the shMON minted to `receiver`.
    /// @param usdcAmount USDC pulled from the vault. This, not the route, sets the
    ///        swap input (I6).
    /// @param receiver Address credited with shMON (I2 — shMONAD mints to it directly).
    /// @param data `abi.encode(uint8 kind, LibSwap.SwapData[] route, uint256 minMonOut, uint256 minSharesOut, uint256 deadline)`
    ///
    ///        `kind` must be an ERC20->native variant: `SingleERC20ToNative` or
    ///        `MultipleERC20ToNative`. Anything else reverts `KindMismatch`.
    function depositFor(uint256 usdcAmount, address receiver, bytes calldata data)
        external
        override
        onlyVault
        nonReentrant
    {
        if (usdcAmount == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();

        (uint8 kindRaw, LibSwap.SwapData[] memory route, uint256 minMonOut, uint256 minSharesOut, uint256 deadline) =
            abi.decode(data, (uint8, LibSwap.SwapData[], uint256, uint256, uint256));

        if (block.timestamp > deadline) revert DeadlineExpired();

        // The swap must end in native MON — that is the only thing shMONAD takes.
        LibLiFi.SwapKind kind = LibLiFi.SwapKind(kindRaw);
        if (!kind.isNativeOut() || kind.isNativeIn()) revert KindMismatch();

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Leg 1: USDC -> MON. `LiFiAdapter` validates the route, enforces
        // `minMonOut` against its own measured delta, and returns the MON here.
        // I7: the approval is scoped to this deposit and revoked immediately.
        usdc.forceApprove(address(swapper), usdcAmount);
        uint256 monBefore = address(this).balance;
        uint256 monOut = swapper.swap(address(usdc), usdcAmount, NATIVE, minMonOut, deadline, kindRaw, route);
        usdc.forceApprove(address(swapper), 0);

        // Measured here as well as by the swapper: this contract's own balance delta
        // is what the next leg actually has to spend.
        uint256 monReceived = address(this).balance - monBefore;
        if (monReceived < minMonOut) revert SlippageExceeded(monReceived, minMonOut);
        // `monOut` is the swapper's accounting; the delta above is ours. They should
        // agree, and the smaller one is what gets staked.
        if (monOut < monReceived) monReceived = monOut;

        _requireCapacity(monReceived);

        // Leg 2: MON -> shMON, minted straight to the receiver.
        uint256 sharesBefore = shMonad.balanceOf(receiver);
        shMonad.deposit{value: monReceived}(monReceived, receiver);
        uint256 sharesOut = shMonad.balanceOf(receiver) - sharesBefore;
        if (sharesOut < minSharesOut) revert SlippageExceeded(sharesOut, minSharesOut);

        // I1: nothing of any of the three assets stays here.
        _sweepAll(msg.sender);

        emit Staked(msg.sender, receiver, usdcAmount, monReceived, sharesOut);
    }

    /// @notice shMON -> MON -> USDC, with the USDC sent to `receiver`.
    /// @param shares shMON pulled from `owner`. `owner` must have approved this
    ///        adapter on the shMON token.
    /// @param receiver Address that receives the USDC.
    /// @param owner Holder of the shMON.
    /// @param data `abi.encode(uint8 kind, LibSwap.SwapData[] route, uint256 minMonOut, uint256 minUsdcOut, uint256 deadline)`
    ///
    ///        `kind` must be a native->ERC20 variant. Size `minMonOut` off
    ///        `previewRedeemMon`, which includes shMONAD's exit haircut.
    /// @return usdcOut USDC delivered to `receiver`.
    function redeemFor(uint256 shares, address receiver, address owner, bytes calldata data)
        external
        override
        onlyVault
        nonReentrant
        returns (uint256 usdcOut)
    {
        if (shares == 0) revert ZeroAmount();
        if (receiver == address(0) || owner == address(0)) revert ZeroAddress();

        (uint8 kindRaw, LibSwap.SwapData[] memory route, uint256 minMonOut, uint256 minUsdcOut, uint256 deadline) =
            abi.decode(data, (uint8, LibSwap.SwapData[], uint256, uint256, uint256));

        if (block.timestamp > deadline) revert DeadlineExpired();

        // The swap must start from native MON — that is what shMONAD pays out.
        LibLiFi.SwapKind kind = LibLiFi.SwapKind(kindRaw);
        if (!kind.isNativeIn() || kind.isNativeOut()) revert KindMismatch();

        IERC20(address(shMonad)).safeTransferFrom(owner, address(this), shares);

        // Leg 1: shMON -> MON. Redeemed to this contract so the proceeds can be
        // measured before they are spent, rather than trusting the return value.
        uint256 monBefore = address(this).balance;
        shMonad.redeem(shares, address(this), address(this));
        uint256 monOut = address(this).balance - monBefore;
        // I8 on the exit itself, not just on the swap. shMONAD's haircut lands here.
        if (monOut < minMonOut) revert SlippageExceeded(monOut, minMonOut);

        // Leg 2: MON -> USDC, back to this adapter, then on to the receiver.
        uint256 usdcBefore = usdc.balanceOf(address(this));
        swapper.swap{value: monOut}(NATIVE, monOut, address(usdc), minUsdcOut, deadline, kindRaw, route);
        usdcOut = usdc.balanceOf(address(this)) - usdcBefore;
        if (usdcOut < minUsdcOut) revert SlippageExceeded(usdcOut, minUsdcOut);

        usdc.safeTransfer(receiver, usdcOut);

        // I1: any unspent MON or leftover shMON goes back to whoever supplied it.
        _sweepAll(owner);

        emit Unstaked(owner, receiver, shares, monOut, usdcOut);
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNAL
    //////////////////////////////////////////////////////////////*/

    /// @dev shMONAD is effectively uncapped today (`maxDeposit` is
    ///      `type(uint128).max`), but the guard costs one call and turns a future
    ///      cap into an attributable revert instead of an anonymous one — the same
    ///      treatment `FortVault` gives its ERC-4626 path.
    function _requireCapacity(uint256 monAmount) internal view {
        uint256 capacity = shMonad.maxDeposit(address(this));
        if (monAmount > capacity) revert ProtocolAtCapacity(monAmount, capacity);
    }

    /// @dev Returns every asset this adapter could be holding to `to`. Called at the
    ///      end of both paths so a partial fill on any leg cannot strand value.
    function _sweepAll(address to) internal {
        uint256 usdcResidual = usdc.balanceOf(address(this));
        if (usdcResidual > 0) usdc.safeTransfer(to, usdcResidual);

        uint256 shareResidual = shMonad.balanceOf(address(this));
        if (shareResidual > 0) IERC20(address(shMonad)).safeTransfer(to, shareResidual);

        uint256 monResidual = address(this).balance;
        if (monResidual > 0) _sendNative(to, monResidual);
    }

    function _sendNative(address to, uint256 amount) internal {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
    }

    /*//////////////////////////////////////////////////////////////
                                EMERGENCY
    //////////////////////////////////////////////////////////////*/

    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    function rescueNative(address to, uint256 amount) external onlyOwner {
        _sendNative(to, amount);
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
