// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "../interfaces/IFortProtocolEx.sol";
import "../interfaces/IPendleRouter.sol";

/// @title PendleAdapter — stateless adapter for Pendle PT operations
/// @notice Implements IFortProtocolEx. Buys PT tokens on deposit, sells/redeems PT on redeem.
///         Base depositFor/redeemFor (without data) revert.
contract PendleAdapter is IFortProtocolEx, Ownable2StepUpgradeable, UUPSUpgradeable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IPendleRouter public immutable router;

    /// @notice Whitelisted Pendle markets
    mapping(address => bool) public isApprovedMarket;

    address public vault;

    error InvalidData();
    error OnlyVault();
    error UnauthorizedMarket(address market);
    error DeadlineExpired();
    error ZeroAmount();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _usdc, address _router) {
        usdc = IERC20(_usdc);
        router = IPendleRouter(_router);
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

    // ──── Owner: Market whitelist ────

    function setApprovedMarket(address market, bool approved) external onlyOwner {
        isApprovedMarket[market] = approved;
    }

    // ──── IFortProtocol (no-data) — revert ────

    function depositFor(uint256, address) external pure override {
        revert InvalidData();
    }

    function redeemFor(uint256, address, address) external view override onlyVault returns (uint256) {
        revert InvalidData();
    }

    // ──── IFortProtocolEx (with data) ────

    /// @notice Buy PT tokens via Pendle router
    /// @dev data = abi.encode(address market, uint256 minPtOut, ApproxParams guessPtOut, uint256 deadline)
    function depositFor(uint256 usdcAmount, address receiver, bytes calldata data) external override onlyVault nonReentrant {
        if (usdcAmount == 0) revert ZeroAmount();

        (
            address market,
            uint256 minPtOut,
            IPendleRouter.ApproxParams memory guessPtOut,
            uint256 deadline
        ) = abi.decode(data, (address, uint256, IPendleRouter.ApproxParams, uint256));

        if (block.timestamp > deadline) revert DeadlineExpired();
        if (!isApprovedMarket[market]) revert UnauthorizedMarket(market);

        // Pull USDC from caller (FortVault)
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Approve Pendle router
        usdc.forceApprove(address(router), usdcAmount);

        // Build token input
        IPendleRouter.TokenInput memory input = IPendleRouter.TokenInput({
            tokenIn: address(usdc),
            netTokenIn: usdcAmount,
            tokenMintSy: address(usdc),
            pendleSwap: address(0),
            swapData: IPendleRouter.SwapData({
                swapType: IPendleRouter.SwapType.NONE,
                extRouter: address(0),
                extCalldata: "",
                needScale: false
            })
        });

        // Empty limit order data
        IPendleRouter.LimitOrderData memory limit = _emptyLimitOrder();

        // Swap USDC for PT — PT minted directly to receiver
        router.swapExactTokenForPt(receiver, market, minPtOut, guessPtOut, input, limit);
    }

    /// @notice Sell or redeem PT tokens back to USDC
    /// @dev data = abi.encode(address market, address ptToken, uint256 minTokenOut, bool postMaturity, uint256 deadline)
    ///      For postMaturity: also needs YT address encoded as 6th param:
    ///      abi.encode(market, ptToken, minTokenOut, true, deadline, ytToken)
    function redeemFor(uint256 shares, address receiver, address owner, bytes calldata data) external override onlyVault nonReentrant returns (uint256 usdcOut) {
        if (shares == 0) revert ZeroAmount();

        (
            address market,
            address ptToken,
            uint256 minTokenOut,
            bool postMaturity,
            uint256 deadline
        ) = abi.decode(data, (address, address, uint256, bool, uint256));

        if (block.timestamp > deadline) revert DeadlineExpired();
        if (!isApprovedMarket[market]) revert UnauthorizedMarket(market);

        // Pull PT from owner
        IERC20(ptToken).safeTransferFrom(owner, address(this), shares);

        // Build token output
        IPendleRouter.TokenOutput memory output = IPendleRouter.TokenOutput({
            tokenOut: address(usdc),
            minTokenOut: minTokenOut,
            tokenRedeemSy: address(usdc),
            pendleSwap: address(0),
            swapData: IPendleRouter.SwapData({
                swapType: IPendleRouter.SwapType.NONE,
                extRouter: address(0),
                extCalldata: "",
                needScale: false
            })
        });

        // Balance-delta pattern for accounting
        uint256 balBefore = usdc.balanceOf(address(this));

        if (postMaturity) {
            // Decode YT address from extended data
            (, , , , , address ytToken) = abi.decode(data, (address, address, uint256, bool, uint256, address));

            // Approve router for PT
            IERC20(ptToken).forceApprove(address(router), shares);

            router.redeemPyToToken(address(this), ytToken, shares, output);
        } else {
            // Approve router for PT
            IERC20(ptToken).forceApprove(address(router), shares);

            IPendleRouter.LimitOrderData memory limit = _emptyLimitOrder();
            router.swapExactPtForToken(address(this), market, shares, output, limit);
        }

        usdcOut = usdc.balanceOf(address(this)) - balBefore;
        usdc.safeTransfer(receiver, usdcOut);
    }

    // ──── Internal ────

    function _emptyLimitOrder() internal pure returns (IPendleRouter.LimitOrderData memory) {
        IPendleRouter.FillOrderParams[] memory empty = new IPendleRouter.FillOrderParams[](0);
        return IPendleRouter.LimitOrderData({
            limitRouter: address(0),
            epsSkipMarket: 0,
            normalFills: empty,
            flashFills: empty,
            optData: ""
        });
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
