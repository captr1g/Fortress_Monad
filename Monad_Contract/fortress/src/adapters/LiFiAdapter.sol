// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "../interfaces/IFortProtocolEx.sol";
import "../interfaces/ILiFi.sol";
import "../config/MonadAddresses.sol";

/// @title LiFiAdapter — stateless swap adapter over LI.FI GenericSwapFacetV3
///
/// @notice Implements `IFortProtocolEx`. The no-data `depositFor`/`redeemFor`
///         overloads revert; a swap cannot be described without a route.
///
/// @dev **Phase 4 rewrite against GenericSwapFacetV3 (DECISIONS.md D0-5).**
///      The Base version called `swapTokensGeneric` (`0x4630a0d8`), which is not
///      registered on the Monad diamond — every swap path reverted. This version
///      dispatches to all six V3 variants, chosen by an explicit `SwapKind` in the
///      payload rather than inferred, so a caller can never land on a variant whose
///      native/ERC20 shape disagrees with the tokens it named.
///
///      Four defects in the Base version are fixed here, independent of the
///      selector change:
///
///      1. **`approveTo` was checked against the wrong address.** It required
///         `approveTo == lifiDiamond`. In LI.FI, `approveTo` is the spender the
///         diamond approves for a leg — the DEX, or a DEX's token-transfer proxy —
///         never the diamond itself. The old rule rejected every live quote and
///         only passed CI because the mock doubled as both. `approveTo` is now
///         allowlisted the same way `callTo` is.
///      2. **No selector allowlist** on `SwapData.callData`, so an allowlisted DEX
///         could be invoked through any of its functions. Violated I5, which
///         requires target **and** selector. Now fails closed:
///         `isApprovedSwapSelector` starts empty and every leg is checked.
///      3. **`depositFor` had no delta verification** — it pointed the diamond
///         straight at the end receiver and trusted the diamond's own `_minAmountOut`.
///         All three entry points now route output to the adapter, measure a
///         pre/post balance delta, re-check slippage, then forward.
///      4. **No end-asset check.** The declared `outputToken` is now required to
///         match the last leg's `receivingAssetId` (and likewise for the input),
///         so a mismatched route fails with a named error rather than a zero delta.
///
///      Invariants held: I1 (no residual balance), I2 (output goes to the end
///      user), I5 (address + selector allowlists), I6 (leg-0 amount is
///      protocol-computed, never taken from calldata), I7 (exact approval, revoked
///      in the same transaction), I8 (caller-supplied minimum on every leg).
contract LiFiAdapter is IFortProtocolEx, Ownable2StepUpgradeable, UUPSUpgradeable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using LibLiFi for LibLiFi.SwapKind;

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice FORTRESS's marker for native MON in this adapter's own API.
    /// @dev Never written into `SwapData` — route contents pass through untouched.
    address public constant NATIVE = MonadAddresses.NATIVE;

    /// @dev LI.FI integrator/referrer tag. Analytics only; no on-chain effect.
    string internal constant INTEGRATOR = "fortress";

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    IERC20 public immutable usdc;
    address public immutable lifiDiamond;

    /// @notice Contracts a leg may name as `callTo` or `approveTo`.
    mapping(address => bool) public isApprovedDex;

    address public vault;

    /// @notice Function selectors a leg's `callData` may carry (I5).
    /// @dev Appended after `vault` on purpose: inserting it above would shift
    ///      `vault`'s slot and break any proxy already pointing at this layout.
    ///      `__gap` shrinks by one to compensate.
    mapping(bytes4 => bool) public isApprovedSwapSelector;

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error InvalidData();
    error OnlyVault();
    error UnauthorizedCallTo(address target);
    error UnauthorizedApproveTo(address target);
    error UnauthorizedSelector(bytes4 selector);
    error DeadlineExpired();
    error ZeroAmount();
    error ZeroAddress();
    error SlippageExceeded(uint256 received, uint256 minimum);
    error SameToken();
    /// @notice The named tokens disagree with the native/ERC20 shape of `kind`.
    error KindMismatch();
    /// @notice Wrong number of legs for `kind` (single variants take exactly one).
    error InvalidSwapCount();
    /// @notice A route's end asset is not the token the caller declared.
    error AssetMismatch();
    /// @notice `msg.value` does not match the declared native input.
    error NativeValueMismatch();
    /// @notice Native MON arrived from somewhere other than the LI.FI diamond.
    error UnexpectedNative();
    error NativeTransferFailed();

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event Swapped(
        address indexed user,
        address indexed inputToken,
        address indexed outputToken,
        uint256 inputAmount,
        uint256 outputAmount
    );
    event DexApprovalUpdated(address indexed dex, bool approved);
    event SwapSelectorApprovalUpdated(bytes4 indexed selector, bool approved);
    event VaultUpdated(address indexed oldVault, address indexed newVault);

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTION
    //////////////////////////////////////////////////////////////*/

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _usdc, address _lifiDiamond) {
        if (_usdc == address(0) || _lifiDiamond == address(0)) revert ZeroAddress();
        usdc = IERC20(_usdc);
        lifiDiamond = _lifiDiamond;
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

    /// @notice Accepts native MON produced by an `*ToNative` swap, or refunded from
    ///         a `Native*` one. Anything else is rejected — the adapter is not a
    ///         wallet, and unattributed MON would be swept to the next caller.
    receive() external payable {
        if (msg.sender != lifiDiamond) revert UnexpectedNative();
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

    /// @notice Allow or revoke a contract as a leg's `callTo` / `approveTo`.
    /// @dev Both roles share one list. They are usually the same router, but some
    ///      aggregators approve a separate token-transfer proxy, so the operator
    ///      must be able to allow that proxy without also making it callable —
    ///      which is why each leg is checked against the list twice, by role.
    function setApprovedDex(address dex, bool approved) external onlyOwner {
        if (dex == address(0)) revert ZeroAddress();
        isApprovedDex[dex] = approved;
        emit DexApprovalUpdated(dex, approved);
    }

    /// @notice Allow or revoke a function selector inside a leg's `callData` (I5).
    /// @dev Starts empty, so every swap reverts until the operator populates it
    ///      from verified per-venue selectors. Failing closed is deliberate.
    function setApprovedSwapSelector(bytes4 selector, bool approved) external onlyOwner {
        isApprovedSwapSelector[selector] = approved;
        emit SwapSelectorApprovalUpdated(selector, approved);
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

    /// @notice Swap vault USDC into `outputToken` and deliver it to `receiver`.
    /// @param usdcAmount USDC pulled from the vault. This, not the route, sets the
    ///        leg-0 input amount (I6).
    /// @param receiver End recipient of the swap output (I2).
    /// @param data `abi.encode(uint8 kind, address outputToken, LibSwap.SwapData[] route, uint256 minOut, uint256 deadline)`
    ///
    ///        `kind` must be ERC20-in — `SingleERC20ToERC20`, `MultipleERC20ToERC20`,
    ///        `SingleERC20ToNative` or `MultipleERC20ToNative`. The native-out
    ///        variants exist for the shMONAD path, whose asset is native MON.
    function depositFor(uint256 usdcAmount, address receiver, bytes calldata data)
        external
        override
        onlyVault
        nonReentrant
    {
        if (usdcAmount == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();

        (uint8 kindRaw, address outputToken, LibSwap.SwapData[] memory route, uint256 minOut, uint256 deadline) =
            abi.decode(data, (uint8, address, LibSwap.SwapData[], uint256, uint256));

        if (block.timestamp > deadline) revert DeadlineExpired();

        // Vault-side input is always USDC, so a native-in variant is never valid here.
        LibLiFi.SwapKind kind = LibLiFi.SwapKind(kindRaw);
        if (kind.isNativeIn()) revert KindMismatch();

        _validate(kind, address(usdc), usdcAmount, outputToken, route);

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Residual input returns to the vault, which is where it came from.
        uint256 received = _execute(kind, address(usdc), usdcAmount, outputToken, minOut, route, receiver, msg.sender);

        emit Swapped(receiver, address(usdc), outputToken, usdcAmount, received);
    }

    /// @notice Swap `shares` of a held token back into USDC for `receiver`.
    /// @param shares Amount of `sourceToken` pulled from `owner`.
    /// @param receiver End recipient of the USDC.
    /// @param owner Holder the source token is pulled from.
    /// @param data `abi.encode(uint8 kind, address sourceToken, LibSwap.SwapData[] route, uint256 minUsdcOut, uint256 deadline)`
    ///
    ///        Output is USDC, an ERC-20, and the source is pulled with
    ///        `transferFrom`, so only the ERC20→ERC20 variants are reachable. Any
    ///        native `kind` reverts `KindMismatch` from `_validate`.
    function redeemFor(uint256 shares, address receiver, address owner, bytes calldata data)
        external
        override
        onlyVault
        nonReentrant
        returns (uint256 usdcOut)
    {
        if (shares == 0) revert ZeroAmount();
        if (receiver == address(0) || owner == address(0)) revert ZeroAddress();

        (uint8 kindRaw, address sourceToken, LibSwap.SwapData[] memory route, uint256 minUsdcOut, uint256 deadline) =
            abi.decode(data, (uint8, address, LibSwap.SwapData[], uint256, uint256));

        if (block.timestamp > deadline) revert DeadlineExpired();
        if (sourceToken == address(0)) revert ZeroAddress();

        LibLiFi.SwapKind kind = LibLiFi.SwapKind(kindRaw);
        _validate(kind, sourceToken, shares, address(usdc), route);

        IERC20(sourceToken).safeTransferFrom(owner, address(this), shares);

        usdcOut = _execute(kind, sourceToken, shares, address(usdc), minUsdcOut, route, receiver, owner);

        emit Swapped(owner, sourceToken, address(usdc), shares, usdcOut);
    }

    /*//////////////////////////////////////////////////////////////
                            USER: GENERIC SWAP
    //////////////////////////////////////////////////////////////*/

    /// @notice Swap any asset to any other via LI.FI. Not vault-gated.
    /// @param inputToken Asset to swap from, or `NATIVE` for MON.
    /// @param inputAmount Amount to spend. For `NATIVE` it must equal `msg.value`.
    /// @param outputToken Asset to receive, or `NATIVE` for MON.
    /// @param minOutputAmount Minimum output, re-checked against the measured delta.
    /// @param deadline Timestamp after which the call reverts.
    /// @param kindRaw Which `LibLiFi.SwapKind` variant to dispatch to.
    /// @param route LI.FI legs, built off-chain by the LI.FI SDK.
    /// @return received Output actually delivered to the caller.
    function swap(
        address inputToken,
        uint256 inputAmount,
        address outputToken,
        uint256 minOutputAmount,
        uint256 deadline,
        uint8 kindRaw,
        LibSwap.SwapData[] calldata route
    ) external payable nonReentrant returns (uint256 received) {
        if (inputAmount == 0) revert ZeroAmount();
        if (inputToken == address(0) || outputToken == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline) revert DeadlineExpired();

        LibLiFi.SwapKind kind = LibLiFi.SwapKind(kindRaw);
        LibSwap.SwapData[] memory _route = _copy(route);
        _validate(kind, inputToken, inputAmount, outputToken, _route);

        if (inputToken == NATIVE) {
            if (msg.value != inputAmount) revert NativeValueMismatch();
        } else {
            if (msg.value != 0) revert NativeValueMismatch();
            IERC20(inputToken).safeTransferFrom(msg.sender, address(this), inputAmount);
        }

        received = _execute(kind, inputToken, inputAmount, outputToken, minOutputAmount, _route, msg.sender, msg.sender);

        emit Swapped(msg.sender, inputToken, outputToken, inputAmount, received);
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNAL
    //////////////////////////////////////////////////////////////*/

    /// @dev Executes one already-validated swap. The input must already be held by
    ///      this contract (pulled by the caller, or arrived as `msg.value`).
    ///
    ///      Validation is deliberately NOT done here: every entry point calls
    ///      `_validate` before it moves any value, so a malformed request never
    ///      reaches a `transferFrom`.
    /// @param to Recipient of the swap output.
    /// @param residualTo Recipient of any unspent input — always whoever supplied it.
    function _execute(
        LibLiFi.SwapKind kind,
        address inputToken,
        uint256 inputAmount,
        address outputToken,
        uint256 minOut,
        LibSwap.SwapData[] memory route,
        address to,
        address residualTo
    ) internal returns (uint256 received) {
        // I6: the protocol's amount wins over whatever the route was quoted with.
        route[0].fromAmount = inputAmount;

        uint256 nativeValue;
        if (inputToken == NATIVE) {
            nativeValue = inputAmount;
        } else {
            // I7: approve exactly this swap's input, revoked below in the same tx.
            IERC20(inputToken).forceApprove(lifiDiamond, inputAmount);
        }

        // Requirement 10: delta against a pre-call snapshot, never an absolute
        // balance. `_validate` rejects inputToken == outputToken, so the input
        // sitting in this contract cannot contaminate the output measurement.
        uint256 outBefore = _balanceOf(outputToken);

        _dispatch(kind, keccak256(abi.encodePacked(block.timestamp, to, inputAmount)), minOut, nativeValue, route);

        received = _balanceOf(outputToken) - outBefore;

        // I8: the diamond checks its own minimum; this is FORTRESS's independent one.
        if (received < minOut) revert SlippageExceeded(received, minOut);

        if (inputToken != NATIVE) {
            IERC20(inputToken).forceApprove(lifiDiamond, 0);
            uint256 residual = IERC20(inputToken).balanceOf(address(this));
            if (residual > 0) IERC20(inputToken).safeTransfer(residualTo, residual);
        }

        // I2: output leaves for the end user, never parked here.
        _payOut(outputToken, to, received);

        // I1: a partially-filled native leg leaves MON behind; return it.
        if (inputToken == NATIVE) {
            uint256 nativeResidual = address(this).balance;
            if (nativeResidual > 0) _payOut(NATIVE, residualTo, nativeResidual);
        }
    }

    /// @dev Every check that must pass before any value moves into the diamond.
    function _validate(
        LibLiFi.SwapKind kind,
        address inputToken,
        uint256 inputAmount,
        address outputToken,
        LibSwap.SwapData[] memory route
    ) internal view {
        if (inputAmount == 0) revert ZeroAmount();
        // Delta accounting cannot separate input from output when they are the same
        // token, and a same-token swap has no legitimate use here.
        if (inputToken == outputToken) revert SameToken();

        // The declared tokens must agree with the variant's native/ERC20 shape, so a
        // caller cannot reach an unintended facet by mislabelling one side.
        if ((inputToken == NATIVE) != kind.isNativeIn()) revert KindMismatch();
        if ((outputToken == NATIVE) != kind.isNativeOut()) revert KindMismatch();

        uint256 legs = route.length;
        if (legs == 0) revert InvalidSwapCount();
        if (kind.isSingle() && legs != 1) revert InvalidSwapCount();

        // Indexed field-by-field rather than copying each `SwapData` into a local —
        // a struct copy would duplicate the whole `callData` blob per leg.
        for (uint256 i; i < legs; ++i) {
            // I5: allowlist the call target AND the selector. Address alone was an
            // audit finding — an allowlisted router still exposes other functions.
            address callTo = route[i].callTo;
            if (!isApprovedDex[callTo]) revert UnauthorizedCallTo(callTo);
            address approveTo = route[i].approveTo;
            if (!isApprovedDex[approveTo]) revert UnauthorizedApproveTo(approveTo);
            if (route[i].callData.length < 4) revert UnauthorizedSelector(bytes4(0));
            bytes4 selector = bytes4(route[i].callData);
            if (!isApprovedSwapSelector[selector]) revert UnauthorizedSelector(selector);
        }

        // Pin the route's ends to the declared tokens. Only checked for the ERC20
        // sides: LI.FI's own native marker is not assumed here, because route
        // contents are passed through and never interpreted.
        if (inputToken != NATIVE && route[0].sendingAssetId != inputToken) revert AssetMismatch();
        if (outputToken != NATIVE && route[legs - 1].receivingAssetId != outputToken) revert AssetMismatch();
    }

    /// @dev Calls the one GenericSwapFacetV3 function `kind` names. Output always
    ///      lands on this contract so the delta above is measurable.
    function _dispatch(
        LibLiFi.SwapKind kind,
        bytes32 txId,
        uint256 minOut,
        uint256 value,
        LibSwap.SwapData[] memory route
    ) internal {
        ILiFiGenericSwapFacetV3 diamond = ILiFiGenericSwapFacetV3(lifiDiamond);
        address payable self = payable(address(this));

        if (kind == LibLiFi.SwapKind.SingleERC20ToERC20) {
            diamond.swapTokensSingleV3ERC20ToERC20(txId, INTEGRATOR, INTEGRATOR, self, minOut, route[0]);
        } else if (kind == LibLiFi.SwapKind.SingleERC20ToNative) {
            diamond.swapTokensSingleV3ERC20ToNative(txId, INTEGRATOR, INTEGRATOR, self, minOut, route[0]);
        } else if (kind == LibLiFi.SwapKind.SingleNativeToERC20) {
            diamond.swapTokensSingleV3NativeToERC20{value: value}(txId, INTEGRATOR, INTEGRATOR, self, minOut, route[0]);
        } else if (kind == LibLiFi.SwapKind.MultipleERC20ToERC20) {
            diamond.swapTokensMultipleV3ERC20ToERC20(txId, INTEGRATOR, INTEGRATOR, self, minOut, route);
        } else if (kind == LibLiFi.SwapKind.MultipleERC20ToNative) {
            diamond.swapTokensMultipleV3ERC20ToNative(txId, INTEGRATOR, INTEGRATOR, self, minOut, route);
        } else {
            diamond.swapTokensMultipleV3NativeToERC20{value: value}(txId, INTEGRATOR, INTEGRATOR, self, minOut, route);
        }
    }

    function _balanceOf(address token) internal view returns (uint256) {
        return token == NATIVE ? address(this).balance : IERC20(token).balanceOf(address(this));
    }

    function _payOut(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (token == NATIVE) {
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    /// @dev calldata → memory, so `_run` can pin leg 0's amount.
    function _copy(LibSwap.SwapData[] calldata route) internal pure returns (LibSwap.SwapData[] memory out) {
        out = new LibSwap.SwapData[](route.length);
        for (uint256 i; i < route.length; ++i) {
            out[i] = route[i];
        }
    }

    /*//////////////////////////////////////////////////////////////
                                EMERGENCY
    //////////////////////////////////////////////////////////////*/

    /// @notice Rescue tokens accidentally sent to the adapter.
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice Rescue native MON stranded by a reverted or partially-filled leg.
    function rescueNative(address to, uint256 amount) external onlyOwner {
        _payOut(NATIVE, to, amount);
    }

    /*//////////////////////////////////////////////////////////////
                                  UUPS
    //////////////////////////////////////////////////////////////*/

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /*//////////////////////////////////////////////////////////////
                               STORAGE GAP
    //////////////////////////////////////////////////////////////*/

    /// @dev 49, not 50 — `isApprovedSwapSelector` consumed one slot.
    uint256[49] private __gap;
}
