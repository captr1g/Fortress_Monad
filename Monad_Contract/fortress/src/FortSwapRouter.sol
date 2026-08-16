// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "./interfaces/IFortVault.sol";
import "./interfaces/IFortProtocol.sol";
import "./interfaces/IFortProtocolEx.sol";
import "./interfaces/ILiFi.sol";

/// @title FortSwapRouter — swap any token to USDC via LiFi, then split-deposit across protocols
/// @notice Extracted from FortVault to reduce contract size (EIP-170 compliance).
///         Users approve this contract for input tokens. USDC approvals for deposit() still target FortVault.
contract FortSwapRouter is Ownable2StepUpgradeable, PausableUpgradeable, UUPSUpgradeable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    // ──────────── Immutables ────────────

    IERC20 public immutable usdc;
    address public immutable lifiDiamond;

    // ──────────── State ────────────

    mapping(address => bool) public isApprovedDex;
    address public vault;

    // ──────────── Structs ────────────

    struct SwapDepositEntry {
        bytes32 protocolKey;
        uint16 bps; // basis points, sum must = 10000
        uint256 minSharesOut; // slippage protection (ERC4626 only; 0 = no check)
        bytes data; // protocol-specific calldata
    }

    // ──────────── Events ────────────

    event SwapAndDeposited(
        address indexed user, address indexed inputToken, uint256 inputAmount, uint256 usdcReceived, uint256 entryCount
    );
    event DexApprovalUpdated(address indexed dex, bool approved);
    event VaultUpdated(address indexed oldVault, address indexed newVault);

    // ──────────── Errors ────────────

    error ZeroAddress();
    error ZeroAmount();
    error InvalidBps();
    error UnauthorizedCallTo(address target);
    error UnauthorizedApproveTo(address target);
    error DeadlineExpired();
    error InputTokenIsUsdc();
    error ProtocolNotFound(bytes32 key);
    error SlippageExceeded(uint256 received, uint256 minimum);

    // ──────────── Constructor / Initializer ────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _usdc, address _lifiDiamond) {
        if (_usdc == address(0) || _lifiDiamond == address(0)) revert ZeroAddress();
        usdc = IERC20(_usdc);
        lifiDiamond = _lifiDiamond;
        _disableInitializers();
    }

    function initialize(address _owner, address _vault) external initializer {
        if (_owner == address(0) || _vault == address(0)) revert ZeroAddress();
        __Ownable_init(_owner);
        __Ownable2Step_init();
        __Pausable_init();
        vault = _vault;
    }

    // ══════════════════════════════════════════════════════════════
    //                    OWNER: CONFIG
    // ══════════════════════════════════════════════════════════════

    function setApprovedDex(address dex, bool approved) external onlyOwner {
        isApprovedDex[dex] = approved;
        emit DexApprovalUpdated(dex, approved);
    }

    function setVault(address _vault) external onlyOwner {
        if (_vault == address(0)) revert ZeroAddress();
        address old = vault;
        vault = _vault;
        emit VaultUpdated(old, _vault);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ══════════════════════════════════════════════════════════════
    //                    USER: SWAP AND DEPOSIT
    // ══════════════════════════════════════════════════════════════

    /// @notice Swap any token to USDC via LiFi, then split-deposit across protocols.
    /// @param inputToken The ERC20 token to swap from (must not be USDC).
    /// @param inputAmount Amount of inputToken to pull from caller.
    /// @param minUsdcOut Minimum USDC output after swap (slippage protection).
    /// @param deadline Timestamp after which the tx reverts.
    /// @param swapData LiFi swap instructions.
    /// @param entries Protocol split using basis points (must sum to 10000).
    function swapAndDeposit(
        address inputToken,
        uint256 inputAmount,
        uint256 minUsdcOut,
        uint256 deadline,
        LibSwap.SwapData[] calldata swapData,
        SwapDepositEntry[] calldata entries
    ) external whenNotPaused nonReentrant {
        // Step 1: Validate inputs
        if (inputAmount == 0) revert ZeroAmount();
        if (inputToken == address(usdc)) revert InputTokenIsUsdc();
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (entries.length == 0) revert ZeroAmount();

        // Step 2: Validate BPS sum == 10000
        {
            uint256 totalBps;
            for (uint256 i; i < entries.length; i++) {
                totalBps += entries[i].bps;
            }
            if (totalBps != 10000) revert InvalidBps();
        }

        // Step 3: Copy swapData to memory + validate security
        LibSwap.SwapData[] memory _swaps = new LibSwap.SwapData[](swapData.length);
        for (uint256 i; i < swapData.length; i++) {
            _swaps[i] = swapData[i];
            if (!isApprovedDex[_swaps[i].callTo]) revert UnauthorizedCallTo(_swaps[i].callTo);
            if (_swaps[i].approveTo != lifiDiamond) revert UnauthorizedApproveTo(_swaps[i].approveTo);
        }
        _swaps[0].fromAmount = inputAmount;

        // Step 4: Pull input token from user
        IERC20(inputToken).safeTransferFrom(msg.sender, address(this), inputAmount);

        // Step 5: Approve LiFi + execute swap
        IERC20(inputToken).forceApprove(lifiDiamond, inputAmount);
        uint256 usdcBefore = usdc.balanceOf(address(this));

        ILiFiGenericSwapFacet(lifiDiamond).swapTokensGeneric(
            keccak256(abi.encodePacked(msg.sender, block.timestamp)),
            "fortress",
            "fortress",
            payable(address(this)),
            minUsdcOut,
            _swaps
        );

        uint256 usdcReceived = usdc.balanceOf(address(this)) - usdcBefore;
        if (usdcReceived < minUsdcOut) revert SlippageExceeded(usdcReceived, minUsdcOut);

        usdcReceived = _collectFee(usdcReceived);

        // Step 6: Clear residual input token approval + sweep residual
        IERC20(inputToken).forceApprove(lifiDiamond, 0);
        uint256 residual = IERC20(inputToken).balanceOf(address(this));
        if (residual > 0) IERC20(inputToken).safeTransfer(msg.sender, residual);

        // Step 7: Deposit USDC across protocols
        _depositToProtocols(usdcReceived, entries);

        // Step 8: Emit event
        emit SwapAndDeposited(msg.sender, inputToken, inputAmount, usdcReceived, entries.length);
    }

    // ══════════════════════════════════════════════════════════════
    //                    INTERNAL
    // ══════════════════════════════════════════════════════════════

    function _collectFee(uint256 amount) internal returns (uint256 netAmount) {
        IFortVault v = IFortVault(vault);
        uint16 feeBps = v.depositFeeBps();
        if (feeBps == 0) return amount;
        uint256 fee = (amount * feeBps) / 10000;
        if (fee > 0) {
            address recipient = v.feeRecipient();
            if (recipient == address(0)) recipient = v.owner();
            usdc.safeTransfer(recipient, fee);
        }
        return amount - fee;
    }

    function _depositToProtocols(uint256 usdcReceived, SwapDepositEntry[] calldata entries) internal {
        IFortVault v = IFortVault(vault);
        uint256 deposited;

        for (uint256 i; i < entries.length; i++) {
            (address pAddr, bool isERC4626) = v.protocols(entries[i].protocolKey);
            if (pAddr == address(0)) revert ProtocolNotFound(entries[i].protocolKey);

            uint256 amount;
            if (i == entries.length - 1) {
                amount = usdcReceived - deposited;
            } else {
                amount = (usdcReceived * entries[i].bps) / 10000;
            }
            deposited += amount;

            usdc.forceApprove(pAddr, amount);

            if (isERC4626) {
                uint256 sharesOut = IERC4626(pAddr).deposit(amount, msg.sender);
                if (entries[i].minSharesOut != 0 && sharesOut < entries[i].minSharesOut) {
                    revert SlippageExceeded(sharesOut, entries[i].minSharesOut);
                }
            } else if (entries[i].data.length > 0) {
                IFortProtocolEx(pAddr).depositFor(amount, msg.sender, entries[i].data);
            } else {
                IFortProtocol(pAddr).depositFor(amount, msg.sender);
            }

            usdc.forceApprove(pAddr, 0);
        }
    }

    // ══════════════════════════════════════════════════════════════
    //                    EMERGENCY
    // ══════════════════════════════════════════════════════════════

    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    // ══════════════════════════════════════════════════════════════
    //                    UUPS
    // ══════════════════════════════════════════════════════════════

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ══════════════════════════════════════════════════════════════
    //                    STORAGE GAP
    // ══════════════════════════════════════════════════════════════

    uint256[50] private __gap;
}
