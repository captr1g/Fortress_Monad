// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./ILiFi.sol";

/// @title IShMonad — FastLane shMONAD, an ERC-4626 whose asset is native MON
///
/// @notice shMONAD looks like a vault and mostly is one, with one difference that
///         breaks every generic integration: `asset()` returns the native-MON
///         sentinel `0xEeee…`, not an ERC-20.
///
/// @dev Verified live on chain 143 at the pinned block:
///
///        asset()          MonadAddresses.NATIVE (the 0xEeee sentinel)
///        symbol()         "shMON"      decimals() 18
///        totalAssets()    382,604,654 MON      totalSupply() 238,364,228 shMON
///        maxDeposit()     type(uint128).max — effectively uncapped
///
///      **`deposit` is payable and takes the MON as `msg.value`.** Calling it
///      without value reverts with the custom error `0x309a6b54`. That is the whole
///      reason `FortVault`'s `isERC4626` fast path cannot drive this venue: the fast
///      path does `IERC20(asset).transferFrom`, and the sentinel is not a contract.
///
///      **`redeem` settles immediately** — no unbonding queue, no cooldown. Probed
///      end to end: 10 MON in, 6.230354 shMON out, redeemed in the same transaction
///      for 9.934694 MON.
///
///      **There is a real exit haircut, and it is not rounding.** At the pinned
///      block `previewRedeem(s)` returned 9.934694 MON where `convertToAssets(s)`
///      returned 9.999245 — a **0.645% discount on the way out**, and a 0.653%
///      round-trip loss. `previewRedeem` matched the realised amount exactly, so it
///      is the number to quote against. Any caller sizing `minUsdcOut` off
///      `convertToAssets` will be wrong by roughly that much.
interface IShMonad is IERC20 {
    /// @return The native-MON sentinel, NOT an ERC-20 address.
    function asset() external view returns (address);

    /// @notice Mints shMON to `receiver`. `msg.value` must equal `assets`.
    function deposit(uint256 assets, address receiver) external payable returns (uint256 shares);

    /// @notice Burns `shares` from `owner` and sends native MON to `receiver`.
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);

    function maxDeposit(address receiver) external view returns (uint256);

    /// @notice MON actually obtainable for `shares`. Includes the exit haircut.
    /// @dev Use this, not `convertToAssets`, to size a minimum.
    function previewRedeem(uint256 shares) external view returns (uint256 assets);

    /// @notice MON that `shares` represents at the raw exchange rate.
    /// @dev Excludes the exit haircut — do NOT size a minimum off this.
    function convertToAssets(uint256 shares) external view returns (uint256 assets);
}

/// @title ILiFiSwapper — the `LiFiAdapter.swap` surface, as used by other adapters
///
/// @dev Declared so an adapter needing a swap leg can reuse `LiFiAdapter` rather
///      than re-implementing route validation. Everything I5 and I8 require — the
///      DEX address allowlist, the per-leg selector allowlist, the route end-asset
///      checks, the balance-delta verification — lives in `LiFiAdapter` and is
///      enforced on this call. Duplicating it would mean two allowlists to keep in
///      step, and the second one would eventually drift.
///
///      Output and any unspent input are returned to `msg.sender`, so the calling
///      adapter receives them and must be able to accept native MON.
interface ILiFiSwapper {
    function swap(
        address inputToken,
        uint256 inputAmount,
        address outputToken,
        uint256 minOutputAmount,
        uint256 deadline,
        uint8 kindRaw,
        LibSwap.SwapData[] calldata route
    ) external payable returns (uint256 received);

    function NATIVE() external view returns (address);
}
