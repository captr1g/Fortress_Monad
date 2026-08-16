// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "../interfaces/IFortProtocol.sol";

/// @title YoAdapter — stateless adapter for YO Protocol (yoUSD ERC-4626 vault)
/// @notice Wraps yoUSD vault with maxRedeem safety check for async redemption risk.
contract YoAdapter is IFortProtocol, Ownable2StepUpgradeable, UUPSUpgradeable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IERC4626 public immutable yoVault;

    address public vault;

    error ZeroAmount();
    error OnlyVault();
    error InsufficientLiquidity(uint256 available, uint256 requested);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _usdc, address _yoVault) {
        usdc = IERC20(_usdc);
        yoVault = IERC4626(_yoVault);
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

    // ──── IFortProtocol ────

    /// @notice Deposit USDC into yoUSD vault, shares minted to receiver
    function depositFor(uint256 usdcAmount, address receiver) external override onlyVault nonReentrant {
        if (usdcAmount == 0) revert ZeroAmount();

        // Pull USDC from caller (FortVault)
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Approve yoVault
        usdc.forceApprove(address(yoVault), usdcAmount);

        // Deposit — shares go to receiver
        yoVault.deposit(usdcAmount, receiver);
    }

    /// @notice Redeem yoUSD shares for USDC, checking maxRedeem for async liquidity
    /// @dev Owner must have approved this adapter for yoUSD transfer
    function redeemFor(uint256 shares, address receiver, address owner) external override onlyVault nonReentrant returns (uint256 usdcOut) {
        if (shares == 0) revert ZeroAmount();

        // Check synchronous liquidity
        uint256 maxRedeemable = yoVault.maxRedeem(owner);
        if (maxRedeemable < shares) {
            revert InsufficientLiquidity(maxRedeemable, shares);
        }

        // Pull yoUSD shares from owner
        IERC20(address(yoVault)).safeTransferFrom(owner, address(this), shares);

        // Redeem — USDC goes to receiver
        usdcOut = yoVault.redeem(shares, receiver, address(this));
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
