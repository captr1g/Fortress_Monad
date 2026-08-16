// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "../interfaces/IFortProtocolEx.sol";
import "../interfaces/ILiFi.sol";

/// @title LiFiAdapter — stateless adapter routing USDC swaps through LiFi Diamond
/// @notice Implements IFortProtocolEx. Base depositFor/redeemFor (without data) revert.
contract LiFiAdapter is IFortProtocolEx, Ownable2StepUpgradeable, UUPSUpgradeable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public immutable lifiDiamond;

    /// @notice Whitelisted DEX routers that SwapData.callTo can target
    mapping(address => bool) public isApprovedDex;

    address public vault;

    error InvalidData();
    error OnlyVault();
    error UnauthorizedCallTo(address target);
    error UnauthorizedApproveTo(address target);
    error DeadlineExpired();
    error ZeroAmount();
    error ZeroAddress();
    error SlippageExceeded(uint256 received, uint256 minimum);
    error SameToken();

    event Swapped(
        address indexed user,
        address indexed inputToken,
        address indexed outputToken,
        uint256 inputAmount,
        uint256 outputAmount
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _usdc, address _lifiDiamond) {
        usdc = IERC20(_usdc);
        lifiDiamond = _lifiDiamond;
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

    // ──── Owner: DEX whitelist ────

    function setApprovedDex(address dex, bool approved) external onlyOwner {
        isApprovedDex[dex] = approved;
    }

    // ──── IFortProtocol (no-data) — revert ────

    function depositFor(uint256, address) external pure override {
        revert InvalidData();
    }

    function redeemFor(uint256, address, address) external view override onlyVault returns (uint256) {
        revert InvalidData();
    }

    // ──── IFortProtocolEx (with data) ────

    /// @notice Swap USDC via LiFi.
    ///         data = abi.encode(LibSwap.SwapData[], uint256 minOut, uint256 deadline)
    function depositFor(uint256 usdcAmount, address receiver, bytes calldata data) external override onlyVault nonReentrant {
        (LibSwap.SwapData[] memory swapData, uint256 minOut, uint256 deadline) =
            abi.decode(data, (LibSwap.SwapData[], uint256, uint256));

        // Fix #2: Deadline enforcement
        if (block.timestamp > deadline) revert DeadlineExpired();

        // Security: validate + override swap data
        for (uint256 i; i < swapData.length; i++) {
            // Fix #1: Whitelist callTo and approveTo targets
            if (!isApprovedDex[swapData[i].callTo]) revert UnauthorizedCallTo(swapData[i].callTo);
            if (swapData[i].approveTo != lifiDiamond) revert UnauthorizedApproveTo(swapData[i].approveTo);
            if (i == 0) {
                swapData[i].fromAmount = usdcAmount;
            }
        }

        // Pull USDC from caller (vault) and approve LiFi
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        usdc.forceApprove(lifiDiamond, usdcAmount);

        ILiFiGenericSwapFacet(lifiDiamond).swapTokensGeneric(
            keccak256(abi.encodePacked(block.timestamp, receiver, usdcAmount)),
            "FortVault",
            "FortVault",
            payable(receiver),
            minOut,
            swapData
        );

        // Clear residual approval
        usdc.forceApprove(lifiDiamond, 0);
    }

    /// @notice Swap back to USDC via LiFi.
    ///         data = abi.encode(address sourceToken, LibSwap.SwapData[], uint256 minUsdcOut, uint256 deadline)
    function redeemFor(uint256 shares, address receiver, address owner, bytes calldata data) external override onlyVault nonReentrant returns (uint256 usdcOut) {
        (address sourceToken, LibSwap.SwapData[] memory swapData, uint256 minUsdcOut, uint256 deadline) =
            abi.decode(data, (address, LibSwap.SwapData[], uint256, uint256));

        // Fix #2: Deadline enforcement
        if (block.timestamp > deadline) revert DeadlineExpired();

        // Pull source token from owner
        IERC20(sourceToken).safeTransferFrom(owner, address(this), shares);
        IERC20(sourceToken).forceApprove(lifiDiamond, shares);

        // Security: validate + override swap data
        for (uint256 i; i < swapData.length; i++) {
            // Fix #1: Whitelist callTo and approveTo targets
            if (!isApprovedDex[swapData[i].callTo]) revert UnauthorizedCallTo(swapData[i].callTo);
            if (swapData[i].approveTo != lifiDiamond) revert UnauthorizedApproveTo(swapData[i].approveTo);
            if (i == 0) {
                swapData[i].fromAmount = shares;
            }
        }

        // Fix #3: Route through adapter to avoid receiver manipulation
        uint256 balBefore = usdc.balanceOf(address(this));

        ILiFiGenericSwapFacet(lifiDiamond).swapTokensGeneric(
            keccak256(abi.encodePacked(block.timestamp, receiver, shares)),
            "FortVault",
            "FortVault",
            payable(address(this)),
            minUsdcOut,
            swapData
        );

        usdcOut = usdc.balanceOf(address(this)) - balBefore;

        // Clear residual approval from source token
        IERC20(sourceToken).forceApprove(lifiDiamond, 0);

        usdc.safeTransfer(receiver, usdcOut);
    }

    // ──── User: Generic Swap ────

    /// @notice Swap any token to any other token via LiFi. User-callable (no vault gate).
    /// @param inputToken Token to swap from
    /// @param inputAmount Amount to pull from caller (must be pre-approved)
    /// @param outputToken Token to receive
    /// @param minOutputAmount Minimum output after swap (slippage protection)
    /// @param deadline Timestamp after which the tx reverts
    /// @param swapData LiFi swap instructions (built by LiFi SDK)
    function swap(
        address inputToken,
        uint256 inputAmount,
        address outputToken,
        uint256 minOutputAmount,
        uint256 deadline,
        LibSwap.SwapData[] calldata swapData
    ) external nonReentrant {
        if (inputAmount == 0) revert ZeroAmount();
        if (inputToken == address(0) || outputToken == address(0)) revert ZeroAddress();
        if (inputToken == outputToken) revert SameToken();
        if (block.timestamp > deadline) revert DeadlineExpired();

        // Validate + copy swap data
        LibSwap.SwapData[] memory _swaps = new LibSwap.SwapData[](swapData.length);
        for (uint256 i; i < swapData.length; i++) {
            _swaps[i] = swapData[i];
            if (!isApprovedDex[_swaps[i].callTo]) revert UnauthorizedCallTo(_swaps[i].callTo);
            if (_swaps[i].approveTo != lifiDiamond) revert UnauthorizedApproveTo(_swaps[i].approveTo);
        }
        _swaps[0].fromAmount = inputAmount;

        // Pull input from user
        IERC20(inputToken).safeTransferFrom(msg.sender, address(this), inputAmount);
        IERC20(inputToken).forceApprove(lifiDiamond, inputAmount);

        // Track output balance before swap
        uint256 balBefore = IERC20(outputToken).balanceOf(address(this));

        ILiFiGenericSwapFacet(lifiDiamond).swapTokensGeneric(
            keccak256(abi.encodePacked(block.timestamp, msg.sender, inputAmount)),
            "Fortress",
            "Fortress",
            payable(address(this)),
            minOutputAmount,
            _swaps
        );

        uint256 received = IERC20(outputToken).balanceOf(address(this)) - balBefore;
        if (received < minOutputAmount) revert SlippageExceeded(received, minOutputAmount);

        // Clear residual input approval
        IERC20(inputToken).forceApprove(lifiDiamond, 0);

        // Send output to user
        IERC20(outputToken).safeTransfer(msg.sender, received);

        // Sweep residual input token back to user
        uint256 residual = IERC20(inputToken).balanceOf(address(this));
        if (residual > 0) IERC20(inputToken).safeTransfer(msg.sender, residual);

        emit Swapped(msg.sender, inputToken, outputToken, inputAmount, received);
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
