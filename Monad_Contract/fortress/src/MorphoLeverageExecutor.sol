// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "./interfaces/IMorphoBlue.sol";

/// @title MorphoLeverageExecutor — one-signature flash-loan entry into a Morpho leverage position
/// @notice Opens a leveraged Morpho Blue position atomically using a free Morpho flash loan.
///         The caller supplies equity in the loan token and receives an exact-leverage position
///         in a single transaction, with the LTV never spiking during construction.
///
///         Flow inside the single tx:
///           1. pull `inputAssets` of loanToken from the caller (their equity)
///           2. flashLoan(loanToken, flashAssets)              — Morpho lends the leverage
///           3. swap (inputAssets + flashAssets) → collateral  — acquire the full leveraged size
///           4. supplyCollateral to the caller's position      — onBehalf(caller)
///           5. borrow flashAssets of loanToken                — onBehalf(caller)
///           6. Morpho pulls flashAssets back                  — loan settled
///           7. sweep any residual loan/collateral to the caller
///
///         For a multiplier L on equity E:
///           flashAssets = (L - 1) * E,  final debt = flashAssets,  final LTV = 1 - 1/L.
///         Because the full collateral is supplied before borrowing, the intermediate LTV
///         never exceeds the final LTV — there is no liquidation risk mid-construction.
///
///         Security model:
///           - The callback is reachable only by Morpho, and only for a loan THIS contract
///             initiated. A keccak256 commitment of the flash payload is written to transient
///             storage before the loan and verified inside the callback.
///           - DEX allowlist + a strictly-positive minCollateralOut floor on the entry swap.
///             Morpho's own health check is the final backstop: an over-leveraged borrow reverts
///             the whole transaction atomically.
///           - Pausable, ReentrancyGuard, approval hygiene.
contract MorphoLeverageExecutor is
    IMorphoFlashLoanCallback,
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardTransient
{
    using SafeERC20 for IERC20;

    IMorphoBlue public immutable morpho;
    mapping(address => bool) public isApprovedDex;
    mapping(bytes4 => bool) public isApprovedSwapSelector;

    /// @dev Transient-storage slot (EIP-1153) holding a keccak256 commitment to the in-flight
    ///      flash payload. Written before flashLoan, verified and cleared inside the callback;
    ///      auto-cleared at tx end so it cannot leak across txs.
    uint256 private constant _FLASH_COMMITMENT_SLOT = 0x464f52545f4c45565f464c415348; // FORT_LEV_FLASH

    struct LeverageParams {
        IMorphoBlue.MarketParams market;
        uint256 inputAssets; // loanToken equity pulled from the caller (must be > 0)
        uint256 flashAssets; // loanToken to flash-borrow = (L - 1) * inputAssets (must be > 0)
        uint256 minCollateralOut; // slippage floor on the loanToken → collateral swap (must be > 0)
        address dex;
        bytes swapCalldata; // loanToken → collateral swap
        uint256 deadline;
    }

    struct FlashData {
        address user;
        IMorphoBlue.MarketParams market;
        uint256 inputAssets;
        uint256 minCollateralOut;
        address dex;
        bytes swapCalldata;
    }

    error DeadlineExpired();
    error ZeroAddress();
    error ZeroInputAssets();
    error ZeroFlashAssets();
    error ZeroMinCollateralOut();
    error UnauthorizedDex(address dex);
    error OnlyMorpho();
    error NoActiveFlash();
    error FlashCommitmentMismatch();
    error SlippageExceeded(uint256 received, uint256 minimum);
    error SwapFailed();
    error UnauthorizedSelector(bytes4 selector);
    error InsufficientRepayment(uint256 have, uint256 need);

    event LeverageInitiated(address indexed user, bytes32 indexed marketId, uint256 inputAssets, uint256 flashAssets);

    event PositionLevered(
        address indexed user,
        bytes32 indexed marketId,
        uint256 collateralSupplied,
        uint256 debtOpened,
        uint256 loanReturnedToUser,
        uint256 collateralReturnedToUser
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _morpho) {
        if (_morpho == address(0)) revert ZeroAddress();
        morpho = IMorphoBlue(_morpho);
        _disableInitializers();
    }

    function initialize(address _owner) external initializer {
        __Ownable_init(_owner);
        __Ownable2Step_init();
        __Pausable_init();
    }

    function setApprovedDex(address dex, bool approved) external onlyOwner {
        if (dex == address(0)) revert ZeroAddress();
        isApprovedDex[dex] = approved;
    }

    function setApprovedSwapSelector(bytes4 selector, bool approved) external onlyOwner {
        isApprovedSwapSelector[selector] = approved;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Open a leveraged Morpho position in a single tx via a flash loan.
    /// @dev The caller must have approved `inputAssets` of the loan token to this contract
    ///      and called `setAuthorization(this, true)` on Morpho.
    function openLeverage(LeverageParams calldata p) external whenNotPaused nonReentrant {
        if (block.timestamp > p.deadline) revert DeadlineExpired();
        if (p.inputAssets == 0) revert ZeroInputAssets();
        if (p.flashAssets == 0) revert ZeroFlashAssets();
        if (p.minCollateralOut == 0) revert ZeroMinCollateralOut();
        if (!isApprovedDex[p.dex]) revert UnauthorizedDex(p.dex);

        bytes32 id = keccak256(abi.encode(p.market));

        // Pull the caller's equity up front so it is available for the entry swap.
        IERC20(p.market.loanToken).safeTransferFrom(msg.sender, address(this), p.inputAssets);

        FlashData memory fd = FlashData({
            user: msg.sender,
            market: p.market,
            inputAssets: p.inputAssets,
            minCollateralOut: p.minCollateralOut,
            dex: p.dex,
            swapCalldata: p.swapCalldata
        });

        bytes memory encoded = abi.encode(fd);
        _setFlashCommitment(keccak256(encoded));

        emit LeverageInitiated(msg.sender, id, p.inputAssets, p.flashAssets);

        morpho.flashLoan(p.market.loanToken, p.flashAssets, encoded);

        // The callback clears the commitment; if it survived, it never ran with our payload.
        if (_getFlashCommitment() != bytes32(0)) revert NoActiveFlash();
    }

    /// @inheritdoc IMorphoFlashLoanCallback
    function onMorphoFlashLoan(uint256 assets, bytes calldata data) external override {
        if (msg.sender != address(morpho)) revert OnlyMorpho();

        bytes32 commitment = _getFlashCommitment();
        if (commitment == bytes32(0)) revert NoActiveFlash();
        if (keccak256(data) != commitment) revert FlashCommitmentMismatch();
        _setFlashCommitment(bytes32(0));

        FlashData memory fd = abi.decode(data, (FlashData));
        bytes32 id = keccak256(abi.encode(fd.market));
        address loanToken = fd.market.loanToken;
        address collateralToken = fd.market.collateralToken;

        // Swap the full leveraged size (equity + flash) into collateral.
        _swap(loanToken, collateralToken, fd.inputAssets + assets, fd.minCollateralOut, fd.dex, fd.swapCalldata);

        // Supply everything received as collateral on behalf of the user.
        uint256 collateralSupplied = IERC20(collateralToken).balanceOf(address(this));
        IERC20(collateralToken).forceApprove(address(morpho), collateralSupplied);
        morpho.supplyCollateral(fd.market, collateralSupplied, fd.user, "");
        IERC20(collateralToken).forceApprove(address(morpho), 0);

        // Borrow exactly the flash amount to settle the loan. Morpho enforces that the
        // position stays healthy (LTV < LLTV); an over-leveraged borrow reverts here.
        morpho.borrow(fd.market, assets, 0, fd.user, address(this));

        uint256 loanBalance = IERC20(loanToken).balanceOf(address(this));
        if (loanBalance < assets) {
            revert InsufficientRepayment(loanBalance, assets);
        }

        // Morpho pulls `assets` back via transferFrom after this returns.
        IERC20(loanToken).forceApprove(address(morpho), assets);

        // Return any residuals (swap leftovers) to the user.
        uint256 loanToUser = loanBalance - assets;
        if (loanToUser > 0) IERC20(loanToken).safeTransfer(fd.user, loanToUser);

        uint256 collateralLeft = IERC20(collateralToken).balanceOf(address(this));
        if (collateralLeft > 0) {
            IERC20(collateralToken).safeTransfer(fd.user, collateralLeft);
        }

        emit PositionLevered(fd.user, id, collateralSupplied, assets, loanToUser, collateralLeft);
    }

    function _swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        address dex,
        bytes memory swapCalldata
    ) internal {
        if (!isApprovedDex[dex]) revert UnauthorizedDex(dex);
        if (swapCalldata.length < 4) revert ZeroAddress();
        bytes4 selector = bytes4(swapCalldata);
        if (!isApprovedSwapSelector[selector]) revert UnauthorizedSelector(selector);

        uint256 balBefore = IERC20(tokenOut).balanceOf(address(this));
        IERC20(tokenIn).forceApprove(dex, amountIn);

        (bool success,) = dex.call(swapCalldata);
        if (!success) revert SwapFailed();

        IERC20(tokenIn).forceApprove(dex, 0);

        uint256 received = IERC20(tokenOut).balanceOf(address(this)) - balBefore;
        if (received < minOut) revert SlippageExceeded(received, minOut);
    }

    function _setFlashCommitment(bytes32 value) internal {
        assembly {
            tstore(_FLASH_COMMITMENT_SLOT, value)
        }
    }

    function _getFlashCommitment() internal view returns (bytes32 value) {
        assembly {
            value := tload(_FLASH_COMMITMENT_SLOT)
        }
    }

    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    // ──── UUPS ────

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ──── Storage Gap ────

    uint256[50] private __gap;
}
