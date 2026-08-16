// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../src/interfaces/ILiFi.sol";

/// @notice Mock of the Monad LI.FI diamond's GenericSwapFacetV3.
///
/// @dev Implements all six V3 entry points and records which one was hit, so tests
///      can assert that `LiFiAdapter` dispatched to the variant its `SwapKind`
///      named rather than merely producing the right balance change.
///
///      `swapTokensGeneric` is deliberately absent — it is not registered on the
///      real Monad diamond either, so a regression back to it fails here too.
///
///      Swaps are simulated at a configurable rate; `callData` is not executed.
contract MockLiFiDiamond {
    using SafeERC20 for IERC20;

    /// @notice outputAmount = inputAmount * rate / 1e6. 1e6 == 1:1.
    uint256 public rate;

    uint256 public swapCallCount;
    bytes32 public lastTransactionId;
    address public lastReceiver;
    uint256 public lastMinAmount;
    /// @notice `LibLiFi.SwapKind` ordinal of the last variant invoked.
    uint8 public lastKind;
    /// @notice Legs in the last route.
    uint256 public lastLegCount;
    /// @notice `msg.value` on the last call.
    uint256 public lastValue;

    /// @notice When true the mock under-delivers without reverting.
    /// @dev Models a diamond whose own `_minAmountOut` check is absent, wrong, or
    ///      upgraded out from under us. It exists so the adapter's INDEPENDENT
    ///      delta check is provable rather than shadowed by the mock's.
    bool public ignoreMinAmount;

    /// @notice Share of a native input refunded to the caller, in basis points.
    /// @dev Models a partially-filled native leg, so the adapter's MON residual
    ///      sweep has something to sweep.
    uint256 public nativeRefundBps;

    error MockSlippage(uint256 received, uint256 minimum);
    error MockNativeSendFailed();

    constructor(uint256 _rate) {
        rate = _rate;
    }

    receive() external payable {}

    function setRate(uint256 _rate) external {
        rate = _rate;
    }

    function setIgnoreMinAmount(bool _ignore) external {
        ignoreMinAmount = _ignore;
    }

    function setNativeRefundBps(uint256 _bps) external {
        nativeRefundBps = _bps;
    }

    /*//////////////////////////////////////////////////////////////
                                 SINGLE
    //////////////////////////////////////////////////////////////*/

    function swapTokensSingleV3ERC20ToERC20(
        bytes32 _transactionId,
        string calldata,
        string calldata,
        address payable _receiver,
        uint256 _minAmountOut,
        LibSwap.SwapData calldata _swapData
    ) external {
        LibSwap.SwapData[] memory route = _one(_swapData);
        _record(0, _transactionId, _receiver, _minAmountOut, 1, 0);
        _erc20In(route);
        _erc20Out(route, _receiver, _minAmountOut);
    }

    function swapTokensSingleV3ERC20ToNative(
        bytes32 _transactionId,
        string calldata,
        string calldata,
        address payable _receiver,
        uint256 _minAmountOut,
        LibSwap.SwapData calldata _swapData
    ) external {
        LibSwap.SwapData[] memory route = _one(_swapData);
        _record(1, _transactionId, _receiver, _minAmountOut, 1, 0);
        _erc20In(route);
        _nativeOut(route, _receiver, _minAmountOut);
    }

    function swapTokensSingleV3NativeToERC20(
        bytes32 _transactionId,
        string calldata,
        string calldata,
        address payable _receiver,
        uint256 _minAmountOut,
        LibSwap.SwapData calldata _swapData
    ) external payable {
        LibSwap.SwapData[] memory route = _one(_swapData);
        _record(2, _transactionId, _receiver, _minAmountOut, 1, msg.value);
        _erc20Out(route, _receiver, _minAmountOut);
        _refundNative();
    }

    /*//////////////////////////////////////////////////////////////
                                MULTIPLE
    //////////////////////////////////////////////////////////////*/

    function swapTokensMultipleV3ERC20ToERC20(
        bytes32 _transactionId,
        string calldata,
        string calldata,
        address payable _receiver,
        uint256 _minAmountOut,
        LibSwap.SwapData[] calldata _swapData
    ) external {
        _record(3, _transactionId, _receiver, _minAmountOut, _swapData.length, 0);
        _erc20In(_swapData);
        _erc20Out(_swapData, _receiver, _minAmountOut);
    }

    function swapTokensMultipleV3ERC20ToNative(
        bytes32 _transactionId,
        string calldata,
        string calldata,
        address payable _receiver,
        uint256 _minAmountOut,
        LibSwap.SwapData[] calldata _swapData
    ) external {
        _record(4, _transactionId, _receiver, _minAmountOut, _swapData.length, 0);
        _erc20In(_swapData);
        _nativeOut(_swapData, _receiver, _minAmountOut);
    }

    function swapTokensMultipleV3NativeToERC20(
        bytes32 _transactionId,
        string calldata,
        string calldata,
        address payable _receiver,
        uint256 _minAmountOut,
        LibSwap.SwapData[] calldata _swapData
    ) external payable {
        _record(5, _transactionId, _receiver, _minAmountOut, _swapData.length, msg.value);
        _erc20Out(_swapData, _receiver, _minAmountOut);
        _refundNative();
    }

    /// @dev Returns the unfilled share of a native input to the caller.
    function _refundNative() internal {
        if (nativeRefundBps == 0) return;
        uint256 refund = (msg.value * nativeRefundBps) / 10000;
        if (refund == 0) return;
        (bool ok,) = payable(msg.sender).call{value: refund}("");
        if (!ok) revert MockNativeSendFailed();
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNAL
    //////////////////////////////////////////////////////////////*/

    function _one(LibSwap.SwapData calldata leg) internal pure returns (LibSwap.SwapData[] memory route) {
        route = new LibSwap.SwapData[](1);
        route[0] = leg;
    }

    function _record(uint8 kind, bytes32 txId, address receiver, uint256 minAmount, uint256 legs, uint256 value)
        internal
    {
        swapCallCount++;
        lastKind = kind;
        lastTransactionId = txId;
        lastReceiver = receiver;
        lastMinAmount = minAmount;
        lastLegCount = legs;
        lastValue = value;
    }

    /// @dev Input side is always leg 0.
    function _erc20In(LibSwap.SwapData[] memory route) internal {
        IERC20(route[0].sendingAssetId).safeTransferFrom(msg.sender, address(this), route[0].fromAmount);
    }

    /// @dev Leg 0's `fromAmount` is the input on every variant — `LiFiAdapter` pins
    ///      it to the protocol-computed amount before dispatch, native included.
    function _amountOut(LibSwap.SwapData[] memory route) internal view returns (uint256) {
        return (route[0].fromAmount * rate) / 1e6;
    }

    /// @dev Output side is always the last leg.
    function _erc20Out(LibSwap.SwapData[] memory route, address receiver, uint256 minAmountOut) internal {
        uint256 out = _amountOut(route);
        if (!ignoreMinAmount && out < minAmountOut) revert MockSlippage(out, minAmountOut);
        IERC20(route[route.length - 1].receivingAssetId).safeTransfer(receiver, out);
    }

    function _nativeOut(LibSwap.SwapData[] memory route, address receiver, uint256 minAmountOut) internal {
        uint256 out = _amountOut(route);
        if (!ignoreMinAmount && out < minAmountOut) revert MockSlippage(out, minAmountOut);
        (bool ok,) = payable(receiver).call{value: out}("");
        if (!ok) revert MockNativeSendFailed();
    }
}
