// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/IMorphoBlue.sol";

/// @title MorphoExitExecutor — one-signature flash-loan unwind of a Morpho leverage position
/// @notice Closes or deleverages a Morpho Blue position atomically using a free Morpho flash loan.
///         The caller must `setAuthorization(this, true)` on Morpho (same as entry) so this
///         contract can repay and withdraw on their behalf.
///
///         Flow inside the single tx:
///           1. flashLoan(loanToken, flashAssets)              — Morpho lends the debt
///           2. repay the caller's debt                        — frees the collateral
///           3. withdrawCollateral to this contract            — collateral now liquid
///           4. swap collateral → loanToken (allowlisted DEX)  — produce repayment + surplus
///           5. Morpho pulls flashAssets back                  — loan settled
///           6. sweep surplus loanToken and any leftover collateral to the caller
///
///         Security model:
///           - The callback is reachable only by Morpho, and only for a loan THIS contract
///             initiated. A keccak256 commitment of the flash payload is written to transient
///             storage before the loan and verified inside the callback
///           - All execution amounts (debt, collateral, repay, withdraw, swap input) are
///             validated against the live position before the loan — fail fast, small blast radius.
///           - DEX allowlist + a strictly-positive minLoanOut slippage floor on the unwind swap.
///           - Full-exit repays by SHARES so debt zeroes exactly with no rounding dust.
///           - Pausable, ReentrancyGuard, approval hygiene.
contract MorphoExitExecutor is
    IMorphoFlashLoanCallback,
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardTransient
{
    using SafeERC20 for IERC20;

    uint256 internal constant VIRTUAL_SHARES = 1e6;
    uint256 internal constant VIRTUAL_ASSETS = 1;

    enum ExitMode {
        FULL_TO_LOAN,
        FULL_TO_COLLATERAL,
        DELEVERAGE
    }

    IMorphoBlue public immutable morpho;
    mapping(address => bool) public isApprovedDex;
    mapping(bytes4 => bool) public isApprovedSwapSelector;

    /// @dev Transient-storage slot (EIP-1153) holding a keccak256 commitment to the in-flight
    ///      flash payload. Written before flashLoan, verified and cleared inside the callback.
    ///       auto-cleared at tx end so it cannot leak across txs.
    uint256 private constant _FLASH_COMMITMENT_SLOT =
        0x464f52545f455849545f464c415348; // FORT_EXIT_FLASH

    struct ExitParams {
        IMorphoBlue.MarketParams market;
        ExitMode mode;
        uint256 repayAssets; // DELEVERAGE only: assets to repay (≤ current debt)
        uint256 withdrawAssets; // DELEVERAGE only: collateral to withdraw (≤ collateral)
        uint256 swapCollateralIn; // collateral to sell (≤ withdrawn); 0 = sell all withdrawn
        uint256 minLoanOut; // slippage floor on the unwind swap (must be > 0)
        address dex;
        bytes swapCalldata;
        uint256 deadline;
    }

    struct FlashData {
        address user;
        IMorphoBlue.MarketParams market;
        ExitMode mode;
        uint256 withdrawAssets;
        uint256 swapCollateralIn;
        uint256 minLoanOut;
        address dex;
        bytes swapCalldata;
    }

    error DeadlineExpired();
    error ZeroAddress();
    error ZeroMinLoanOut();
    error UnauthorizedDex(address dex);
    error OnlyMorpho();
    error NoActiveFlash();
    error FlashCommitmentMismatch();
    error NoDebt();
    error NoCollateral();
    error RepayExceedsDebt(uint256 requested, uint256 debt);
    error WithdrawExceedsCollateral(uint256 requested, uint256 collateral);
    error SwapInputExceedsWithdrawn(uint256 swapIn, uint256 withdrawn);
    error SlippageExceeded(uint256 received, uint256 minimum);
    error SwapFailed();
    error UnauthorizedSelector(bytes4 selector);
    error InsufficientRepayment(uint256 have, uint256 need);

    event ExitInitiated(
        address indexed user,
        bytes32 indexed marketId,
        ExitMode mode,
        uint256 flashAssets,
        uint256 withdrawAssets
    );

    event PositionExited(
        address indexed user,
        bytes32 indexed marketId,
        ExitMode mode,
        uint256 debtRepaid,
        uint256 collateralWithdrawn,
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

    /// @notice Unwind the caller's Morpho position in a single tx via a flash loan.
    /// @dev FULL_* modes read debt and collateral on-chain; `repayAssets`/`withdrawAssets`
    ///      are ignored. DELEVERAGE uses them as supplied, validated against the live position.
    function exitPosition(
        ExitParams calldata p
    ) external whenNotPaused nonReentrant {
        if (block.timestamp > p.deadline) revert DeadlineExpired();
        if (p.minLoanOut == 0) revert ZeroMinLoanOut();
        if (!isApprovedDex[p.dex]) revert UnauthorizedDex(p.dex);

        bytes32 id = keccak256(abi.encode(p.market));
        morpho.accrueInterest(p.market);
        (, uint128 borrowShares, uint128 collateral) = morpho.position(
            id,
            msg.sender
        );
        if (borrowShares == 0) revert NoDebt();
        if (collateral == 0) revert NoCollateral();

        uint256 currentDebt = _currentDebtAssets(id, borrowShares);

        uint256 flashAssets;
        uint256 withdrawAssets;
        if (p.mode == ExitMode.DELEVERAGE) {
            if (p.repayAssets > currentDebt)
                revert RepayExceedsDebt(p.repayAssets, currentDebt);
            if (p.withdrawAssets > collateral)
                revert WithdrawExceedsCollateral(p.withdrawAssets, collateral);
            flashAssets = p.repayAssets;
            withdrawAssets = p.withdrawAssets;
        } else {
            flashAssets = currentDebt;
            withdrawAssets = uint256(collateral);
        }

        // Swap input must not exceed what we will actually withdraw this tx.
        if (p.swapCollateralIn > withdrawAssets)
            revert SwapInputExceedsWithdrawn(
                p.swapCollateralIn,
                withdrawAssets
            );

        FlashData memory fd = FlashData({
            user: msg.sender,
            market: p.market,
            mode: p.mode,
            withdrawAssets: withdrawAssets,
            swapCollateralIn: p.swapCollateralIn,
            minLoanOut: p.minLoanOut,
            dex: p.dex,
            swapCalldata: p.swapCalldata
        });

        bytes memory encoded = abi.encode(fd);
        _setFlashCommitment(keccak256(encoded));

        emit ExitInitiated(msg.sender, id, p.mode, flashAssets, withdrawAssets);

        morpho.flashLoan(p.market.loanToken, flashAssets, encoded);

        // The callback clears the commitment; if it survived, the callback never ran with our payload
        if (_getFlashCommitment() != bytes32(0)) revert NoActiveFlash();
    }

    /// @inheritdoc IMorphoFlashLoanCallback
    function onMorphoFlashLoan(
        uint256 assets,
        bytes calldata data
    ) external override {
        if (msg.sender != address(morpho)) revert OnlyMorpho();

        bytes32 commitment = _getFlashCommitment();
        if (commitment == bytes32(0)) revert NoActiveFlash();
        if (keccak256(data) != commitment) revert FlashCommitmentMismatch();
        _setFlashCommitment(bytes32(0));

        FlashData memory fd = abi.decode(data, (FlashData));
        bytes32 id = keccak256(abi.encode(fd.market));
        address loanToken = fd.market.loanToken;
        address collateralToken = fd.market.collateralToken;

        uint256 debtRepaid;
        if (fd.mode == ExitMode.DELEVERAGE) {
            IERC20(loanToken).forceApprove(address(morpho), assets);
            (debtRepaid, ) = morpho.repay(fd.market, assets, 0, fd.user, "");
            IERC20(loanToken).forceApprove(address(morpho), 0);
        } else {
            (, uint128 borrowShares, ) = morpho.position(id, fd.user);
            IERC20(loanToken).forceApprove(address(morpho), assets);
            (debtRepaid, ) = morpho.repay(
                fd.market,
                0,
                borrowShares,
                fd.user,
                ""
            );
            IERC20(loanToken).forceApprove(address(morpho), 0);
        }

        morpho.withdrawCollateral(
            fd.market,
            fd.withdrawAssets,
            fd.user,
            address(this)
        );

        uint256 swapIn = fd.swapCollateralIn == 0
            ? IERC20(collateralToken).balanceOf(address(this))
            : fd.swapCollateralIn;
        _swap(
            collateralToken,
            loanToken,
            swapIn,
            fd.minLoanOut,
            fd.dex,
            fd.swapCalldata
        );

        uint256 loanBalance = IERC20(loanToken).balanceOf(address(this));
        if (loanBalance < assets)
            revert InsufficientRepayment(loanBalance, assets);

        // Morpho pulls `assets` back via transferFrom after this returns.
        IERC20(loanToken).forceApprove(address(morpho), assets);

        uint256 loanToUser = loanBalance - assets;
        if (loanToUser > 0) IERC20(loanToken).safeTransfer(fd.user, loanToUser);

        uint256 collateralLeft = IERC20(collateralToken).balanceOf(
            address(this)
        );
        if (collateralLeft > 0)
            IERC20(collateralToken).safeTransfer(fd.user, collateralLeft);

        emit PositionExited(
            fd.user,
            id,
            fd.mode,
            debtRepaid,
            fd.withdrawAssets,
            loanToUser,
            collateralLeft
        );
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

        (bool success, ) = dex.call(swapCalldata);
        if (!success) revert SwapFailed();

        IERC20(tokenIn).forceApprove(dex, 0);

        uint256 received = IERC20(tokenOut).balanceOf(address(this)) -
            balBefore;
        if (received < minOut) revert SlippageExceeded(received, minOut);
    }

    function _currentDebtAssets(
        bytes32 id,
        uint128 borrowShares
    ) internal view returns (uint256) {
        if (borrowShares == 0) return 0;
        (, , uint128 totalBorrowAssets, uint128 totalBorrowShares, , ) = morpho
            .market(id);
        return
            Math.mulDiv(
                uint256(borrowShares),
                uint256(totalBorrowAssets) + VIRTUAL_ASSETS,
                uint256(totalBorrowShares) + VIRTUAL_SHARES,
                Math.Rounding.Ceil
            );
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

    function rescueToken(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    // ──── UUPS ────

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ──── Storage Gap ────

    uint256[50] private __gap;
}
