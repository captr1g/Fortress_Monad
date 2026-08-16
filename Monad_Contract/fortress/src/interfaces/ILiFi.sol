// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ILiFi — LI.FI GenericSwapFacetV3 interface for the Monad diamond
///
/// @notice REWRITE, not a re-point (DECISIONS.md D0-5). The Base-era interface
///         declared exactly one function, `swapTokensGeneric` (`0x4630a0d8`), and
///         that selector is **not registered** on the Monad LI.FI diamond
///         (`MonadAddresses.LIFI_DIAMOND`). Monad ships **GenericSwapFacetV3**
///         (`MonadAddresses.LIFI_GENERIC_SWAP_FACET_V3`) with six replacement
///         functions, split by swap count (single / multiple) and by asset kind
///         (ERC20 / native) on each side.
///
/// @dev Every selector below was computed locally from the signature and matches
///      the values recorded in `src/config/MonadAddresses.sol` byte for byte:
///
///        swapTokensSingleV3ERC20ToERC20      0x4666fc80
///        swapTokensSingleV3ERC20ToNative     0x733214a3
///        swapTokensSingleV3NativeToERC20     0xaf7060fd
///        swapTokensMultipleV3ERC20ToERC20    0x5fd9ae2e
///        swapTokensMultipleV3ERC20ToNative   0x2c57e884
///        swapTokensMultipleV3NativeToERC20   0x736eac0b
///
///      A live `li.quest` quote on chain 143 (USDC→WMON) returns `0x5fd9ae2e`,
///      confirming the multiple-ERC20 variant is the default production path.
library LibSwap {
    /// @notice One DEX leg. Passed through to the diamond byte-for-byte; FORTRESS
    ///         never rewrites `callData`, only validates it and pins leg 0's amount.
    /// @param callTo Contract the diamond `call`s to perform the leg (the DEX).
    /// @param approveTo Spender the diamond approves for `sendingAssetId`. Usually
    ///        equal to `callTo`, but not always — Paraswap-style routers approve a
    ///        separate token-transfer proxy. Callers must allowlist both.
    /// @param sendingAssetId Input asset of this leg.
    /// @param receivingAssetId Output asset of this leg.
    /// @param fromAmount Input amount. For leg 0 FORTRESS overwrites this with the
    ///        protocol-computed amount (invariant I6).
    /// @param callData Raw DEX calldata. Its 4-byte selector is allowlisted (I5).
    /// @param requiresDeposit Whether the diamond must pull the asset for this leg.
    struct SwapData {
        address callTo;
        address approveTo;
        address sendingAssetId;
        address receivingAssetId;
        uint256 fromAmount;
        bytes callData;
        bool requiresDeposit;
    }
}

/// @notice Namespaces the variant selector shared by `LiFiAdapter` and its tests.
library LibLiFi {
    /// @notice Which of the six GenericSwapFacetV3 entry points to dispatch to.
    /// @dev Ordinals 0–2 are the single-leg variants, 3–5 the multi-leg ones;
    ///      `LiFiAdapter` relies on that ordering to derive `isSingle`. Casting an
    ///      out-of-range `uint8` to this enum reverts, which is the bounds check.
    enum SwapKind {
        SingleERC20ToERC20, // 0 -> 0x4666fc80
        SingleERC20ToNative, // 1 -> 0x733214a3
        SingleNativeToERC20, // 2 -> 0xaf7060fd
        MultipleERC20ToERC20, // 3 -> 0x5fd9ae2e
        MultipleERC20ToNative, // 4 -> 0x2c57e884
        MultipleNativeToERC20 // 5 -> 0x736eac0b
    }

    /// @notice First multi-leg ordinal. Anything below it takes a single `SwapData`.
    uint8 internal constant FIRST_MULTIPLE = uint8(SwapKind.MultipleERC20ToERC20);

    function isSingle(SwapKind kind) internal pure returns (bool) {
        return uint8(kind) < FIRST_MULTIPLE;
    }

    function isNativeIn(SwapKind kind) internal pure returns (bool) {
        return kind == SwapKind.SingleNativeToERC20 || kind == SwapKind.MultipleNativeToERC20;
    }

    function isNativeOut(SwapKind kind) internal pure returns (bool) {
        return kind == SwapKind.SingleERC20ToNative || kind == SwapKind.MultipleERC20ToNative;
    }
}

/// @notice EIP-2535 loupe, used by the fork tests to prove which selectors the live
///         Monad diamond actually routes.
interface ILiFiDiamondLoupe {
    /// @return facetAddress_ The facet serving `_functionSelector`, or `address(0)`
    ///         if the diamond does not register it at all.
    function facetAddress(bytes4 _functionSelector) external view returns (address facetAddress_);
}

/// @notice The six functions GenericSwapFacetV3 registers on the Monad diamond.
/// @dev Each enforces `_minAmountOut` internally against the receiver's balance
///      delta. FORTRESS re-checks the delta itself anyway — the diamond's check is
///      not treated as sufficient evidence (adapter requirement 10).
interface ILiFiGenericSwapFacetV3 {
    function swapTokensSingleV3ERC20ToERC20(
        bytes32 _transactionId,
        string calldata _integrator,
        string calldata _referrer,
        address payable _receiver,
        uint256 _minAmountOut,
        LibSwap.SwapData calldata _swapData
    ) external;

    function swapTokensSingleV3ERC20ToNative(
        bytes32 _transactionId,
        string calldata _integrator,
        string calldata _referrer,
        address payable _receiver,
        uint256 _minAmountOut,
        LibSwap.SwapData calldata _swapData
    ) external;

    function swapTokensSingleV3NativeToERC20(
        bytes32 _transactionId,
        string calldata _integrator,
        string calldata _referrer,
        address payable _receiver,
        uint256 _minAmountOut,
        LibSwap.SwapData calldata _swapData
    ) external payable;

    function swapTokensMultipleV3ERC20ToERC20(
        bytes32 _transactionId,
        string calldata _integrator,
        string calldata _referrer,
        address payable _receiver,
        uint256 _minAmountOut,
        LibSwap.SwapData[] calldata _swapData
    ) external;

    function swapTokensMultipleV3ERC20ToNative(
        bytes32 _transactionId,
        string calldata _integrator,
        string calldata _referrer,
        address payable _receiver,
        uint256 _minAmountOut,
        LibSwap.SwapData[] calldata _swapData
    ) external;

    function swapTokensMultipleV3NativeToERC20(
        bytes32 _transactionId,
        string calldata _integrator,
        string calldata _referrer,
        address payable _receiver,
        uint256 _minAmountOut,
        LibSwap.SwapData[] calldata _swapData
    ) external payable;
}
