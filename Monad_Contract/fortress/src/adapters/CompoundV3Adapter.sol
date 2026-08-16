// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "../interfaces/IFortProtocol.sol";
import "../interfaces/IComet.sol";

/// @title CompoundV3Adapter — stateless adapter for Compound V3 (Comet)
/// @notice Implements IFortProtocol (no extra data needed).
///         Deposits USDC into Comet, mints cUSDCv3 (rebasing balance) to receiver.
///         Redeems cUSDCv3 from owner, returns USDC to receiver.
contract CompoundV3Adapter is IFortProtocol, Ownable2StepUpgradeable, UUPSUpgradeable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IComet public immutable comet;

    address public vault;

    error ZeroAmount();
    error OnlyVault();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _usdc, address _comet) {
        usdc = IERC20(_usdc);
        comet = IComet(_comet);
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

    /// @notice Deposit USDC into Compound V3, cUSDCv3 minted directly to receiver
    /// @param usdcAmount Amount of USDC to deposit
    /// @param receiver Address that receives cUSDCv3 balance
    function depositFor(uint256 usdcAmount, address receiver) external override onlyVault nonReentrant {
        if (usdcAmount == 0) revert ZeroAmount();

        // Pull USDC from caller (FortVault)
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Approve Comet
        usdc.forceApprove(address(comet), usdcAmount);

        // Supply directly to receiver — cUSDCv3 balance credited to receiver
        comet.supplyTo(receiver, address(usdc), usdcAmount);
    }

    /// @notice Redeem cUSDCv3 from owner, send USDC to receiver
    /// @dev Owner must call comet.allow(adapter, true) beforehand
    /// @param shares Amount of cUSDCv3 to redeem (rebasing balance units)
    /// @param receiver Address that receives USDC
    /// @param owner Address that owns cUSDCv3 balance
    /// @return usdcOut Amount of USDC sent to receiver
    function redeemFor(uint256 shares, address receiver, address owner) external override onlyVault nonReentrant returns (uint256 usdcOut) {
        if (shares == 0) revert ZeroAmount();

        // Withdraw from owner's Comet balance to receiver
        // Owner must have called comet.allow(address(this), true)
        uint256 balBefore = usdc.balanceOf(receiver);
        comet.withdrawFrom(owner, receiver, address(usdc), shares);
        usdcOut = usdc.balanceOf(receiver) - balBefore;
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
