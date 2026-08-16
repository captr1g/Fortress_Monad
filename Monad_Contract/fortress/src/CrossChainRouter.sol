// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "./interfaces/ICrossChainRouter.sol";

/// @title CrossChainRouter — standalone cross-chain deposit/withdraw for FORTRESS
/// @notice Completely separate from FortVault. FortVault stays stateless.
///         Deposits: pulls USDC, bridges via LiFi Diamond to destination chain.
///         Withdrawals: records intent, keeper fulfills, user claims.
/// @dev Uses raw LiFi calldata — frontend builds bridge params via LiFi API.
contract CrossChainRouter is ICrossChainRouter, Ownable2StepUpgradeable, PausableUpgradeable, UUPSUpgradeable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    // ──────────── Immutables ────────────

    IERC20 public immutable usdc;
    address public immutable lifiDiamond;

    // ──────────── State ────────────

    address public keeper;
    uint256 public constant REFUND_DELAY = 24 hours;

    mapping(bytes32 => DepositRequest) internal _depositRequests;
    mapping(bytes32 => WithdrawRequest) internal _withdrawRequests;
    mapping(address => uint256) public nonces;

    /// @notice Whitelisted LiFi bridge function selectors
    mapping(bytes4 => bool) public isApprovedBridgeSelector;

    /// @notice USDC reserved for fulfilled but unclaimed withdrawals
    uint256 public pendingWithdrawBalance;

    // ──────────── Events ────────────

    event CrossChainDepositInitiated(
        bytes32 indexed requestId, address indexed user, uint256 amount, uint256 destChainId
    );
    event CrossChainDepositCompleted(bytes32 indexed requestId);
    event CrossChainDepositFailed(bytes32 indexed requestId);
    event CrossChainDepositRefunded(bytes32 indexed requestId, uint256 amount);

    event WithdrawInitiated(
        bytes32 indexed requestId, address indexed user, uint256 expectedAmount, uint256 sourceChainId
    );
    event WithdrawFulfilled(bytes32 indexed requestId, uint256 actualAmount);
    event WithdrawClaimed(bytes32 indexed requestId, address indexed user, uint256 amount);
    event WithdrawCancelled(bytes32 indexed requestId);

    event KeeperUpdated(address indexed oldKeeper, address indexed newKeeper);
    event BridgeSelectorUpdated(bytes4 indexed selector, bool approved);

    // ──────────── Errors ────────────

    error ZeroAddress();
    error ZeroAmount();
    error DeadlineExpired();
    error InvalidRequestStatus();
    error RequestNotFound();
    error NotRequestOwner();
    error OnlyKeeper();
    error LiFiCallFailed();
    error UsdcNotConsumed();
    error InsufficientBalance();
    error SlippageTooHigh();
    error RefundTooEarly();
    error UnauthorizedSelector(bytes4 selector);

    // ──────────── Modifiers ────────────

    modifier onlyKeeper() {
        if (msg.sender != keeper && msg.sender != owner()) revert OnlyKeeper();
        _;
    }

    // ──────────── Constructor / Initializer ────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _usdc, address _lifiDiamond) {
        if (_usdc == address(0) || _lifiDiamond == address(0)) revert ZeroAddress();
        usdc = IERC20(_usdc);
        lifiDiamond = _lifiDiamond;
        _disableInitializers();
    }

    function initialize(address _keeper, address _owner) external initializer {
        __Ownable_init(_owner);
        __Ownable2Step_init();
        __Pausable_init();
        keeper = _keeper;
    }

    // ══════════════════════════════════════════════════════════════
    //                    OWNER: CONFIGURATION
    // ══════════════════════════════════════════════════════════════

    function setKeeper(address _keeper) external onlyOwner {
        if (_keeper == address(0)) revert ZeroAddress();
        emit KeeperUpdated(keeper, _keeper);
        keeper = _keeper;
    }

    function setApprovedBridgeSelector(bytes4 selector, bool approved) external onlyOwner {
        isApprovedBridgeSelector[selector] = approved;
        emit BridgeSelectorUpdated(selector, approved);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ══════════════════════════════════════════════════════════════
    //                    CROSS-CHAIN DEPOSIT
    // ══════════════════════════════════════════════════════════════

    /// @inheritdoc ICrossChainRouter
    function depositCrossChain(
        uint256 usdcAmount,
        uint256 destChainId,
        bytes calldata lifiData,
        uint256 deadline
    ) external whenNotPaused nonReentrant returns (bytes32 requestId) {
        if (usdcAmount == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert DeadlineExpired();

        // Generate unique request ID
        requestId = keccak256(abi.encodePacked(msg.sender, nonces[msg.sender]++, block.chainid));

        // Store request
        _depositRequests[requestId] = DepositRequest({
            user: msg.sender,
            amount: usdcAmount,
            destChainId: destChainId,
            timestamp: uint64(block.timestamp),
            status: RequestStatus.Pending
        });

        // Pull USDC from user
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Validate bridge function selector
        if (lifiData.length < 4) revert LiFiCallFailed();
        bytes4 selector = bytes4(lifiData[:4]);
        if (!isApprovedBridgeSelector[selector]) revert UnauthorizedSelector(selector);

        // Approve exactly the deposit amount to LiFi Diamond
        usdc.forceApprove(lifiDiamond, usdcAmount);

        // Balance delta check — verify USDC is consumed by LiFi
        uint256 balBefore = usdc.balanceOf(address(this));

        // Forward raw calldata to LiFi Diamond
        (bool success,) = lifiDiamond.call(lifiData);
        if (!success) revert LiFiCallFailed();

        uint256 balAfter = usdc.balanceOf(address(this));
        // Guard against underflow if LiFi sends USDC back during call
        if (balAfter > balBefore || balBefore - balAfter < usdcAmount) revert UsdcNotConsumed();

        // Clear any residual approval
        usdc.forceApprove(lifiDiamond, 0);

        emit CrossChainDepositInitiated(requestId, msg.sender, usdcAmount, destChainId);
    }

    // ══════════════════════════════════════════════════════════════
    //                    DEPOSIT: KEEPER ACTIONS
    // ══════════════════════════════════════════════════════════════

    /// @inheritdoc ICrossChainRouter
    function markDepositCompleted(bytes32 requestId) external onlyKeeper {
        DepositRequest storage req = _depositRequests[requestId];
        if (req.user == address(0)) revert RequestNotFound();
        if (req.status != RequestStatus.Pending) revert InvalidRequestStatus();

        req.status = RequestStatus.Completed;
        emit CrossChainDepositCompleted(requestId);
    }

    /// @inheritdoc ICrossChainRouter
    function markDepositFailed(bytes32 requestId) external onlyKeeper {
        DepositRequest storage req = _depositRequests[requestId];
        if (req.user == address(0)) revert RequestNotFound();
        if (req.status != RequestStatus.Pending) revert InvalidRequestStatus();

        req.status = RequestStatus.Failed;
        emit CrossChainDepositFailed(requestId);
    }

    /// @inheritdoc ICrossChainRouter
    /// @dev Keeper must send USDC to this contract before calling refund.
    ///      This covers the case where a bridge returns funds to the contract,
    ///      or the keeper manually covers the refund.
    function refundDeposit(bytes32 requestId) external onlyKeeper {
        DepositRequest storage req = _depositRequests[requestId];
        if (req.user == address(0)) revert RequestNotFound();
        if (req.status != RequestStatus.Failed) revert InvalidRequestStatus();
        if (block.timestamp < req.timestamp + REFUND_DELAY) revert RefundTooEarly();

        uint256 amount = req.amount;

        // Ensure contract has enough free USDC (not reserved for withdrawals)
        uint256 balance = usdc.balanceOf(address(this));
        if (balance < pendingWithdrawBalance || balance - pendingWithdrawBalance < amount) {
            revert InsufficientBalance();
        }

        req.status = RequestStatus.Refunded;
        usdc.safeTransfer(req.user, amount);

        emit CrossChainDepositRefunded(requestId, amount);
    }

    // ══════════════════════════════════════════════════════════════
    //                    CROSS-CHAIN WITHDRAW
    // ══════════════════════════════════════════════════════════════

    /// @inheritdoc ICrossChainRouter
    function initiateWithdraw(
        uint256 expectedUsdc,
        uint256 minAcceptableAmount,
        uint256 sourceChainId,
        uint256 deadline
    ) external whenNotPaused nonReentrant returns (bytes32 requestId) {
        if (expectedUsdc == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert DeadlineExpired();

        requestId = keccak256(abi.encodePacked(msg.sender, nonces[msg.sender]++, block.chainid));

        _withdrawRequests[requestId] = WithdrawRequest({
            user: msg.sender,
            expectedAmount: expectedUsdc,
            actualAmount: 0,
            minAcceptableAmount: minAcceptableAmount,
            sourceChainId: sourceChainId,
            timestamp: uint64(block.timestamp),
            status: RequestStatus.Pending
        });

        emit WithdrawInitiated(requestId, msg.sender, expectedUsdc, sourceChainId);
    }

    /// @inheritdoc ICrossChainRouter
    /// @dev Keeper must send USDC to this contract before calling fulfill.
    function fulfillWithdraw(bytes32 requestId, uint256 actualAmount) external onlyKeeper {
        WithdrawRequest storage req = _withdrawRequests[requestId];
        if (req.user == address(0)) revert RequestNotFound();
        if (req.status != RequestStatus.Pending) revert InvalidRequestStatus();
        if (actualAmount == 0) revert ZeroAmount();
        if (req.minAcceptableAmount != 0 && actualAmount < req.minAcceptableAmount) revert SlippageTooHigh();

        // Ensure contract has enough free USDC
        uint256 balance = usdc.balanceOf(address(this));
        if (balance < pendingWithdrawBalance || balance - pendingWithdrawBalance < actualAmount) {
            revert InsufficientBalance();
        }

        req.actualAmount = actualAmount;
        req.status = RequestStatus.Completed;
        pendingWithdrawBalance += actualAmount;

        emit WithdrawFulfilled(requestId, actualAmount);
    }

    /// @inheritdoc ICrossChainRouter
    function claimWithdraw(bytes32 requestId) external nonReentrant {
        WithdrawRequest storage req = _withdrawRequests[requestId];
        if (req.user == address(0)) revert RequestNotFound();
        if (req.user != msg.sender) revert NotRequestOwner();
        if (req.status != RequestStatus.Completed) revert InvalidRequestStatus();

        uint256 amount = req.actualAmount;
        req.status = RequestStatus.Claimed;
        pendingWithdrawBalance -= amount;

        usdc.safeTransfer(msg.sender, amount);

        emit WithdrawClaimed(requestId, msg.sender, amount);
    }

    /// @inheritdoc ICrossChainRouter
    /// @dev User can cancel a pending withdrawal (no funds at stake since withdraw
    ///      only records intent — no USDC was sent by user).
    function cancelWithdraw(bytes32 requestId) external {
        WithdrawRequest storage req = _withdrawRequests[requestId];
        if (req.user == address(0)) revert RequestNotFound();
        if (req.user != msg.sender) revert NotRequestOwner();
        if (req.status != RequestStatus.Pending) revert InvalidRequestStatus();

        req.status = RequestStatus.Cancelled;

        emit WithdrawCancelled(requestId);
    }

    // ══════════════════════════════════════════════════════════════
    //                    VIEW
    // ══════════════════════════════════════════════════════════════

    /// @inheritdoc ICrossChainRouter
    function getDepositRequest(bytes32 requestId) external view returns (DepositRequest memory) {
        return _depositRequests[requestId];
    }

    /// @inheritdoc ICrossChainRouter
    function getWithdrawRequest(bytes32 requestId) external view returns (WithdrawRequest memory) {
        return _withdrawRequests[requestId];
    }

    // ══════════════════════════════════════════════════════════════
    //                    EMERGENCY
    // ══════════════════════════════════════════════════════════════

    /// @notice Rescue tokens accidentally sent to router.
    ///         Cannot rescue USDC reserved for pending withdrawals.
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(usdc)) {
            uint256 balance = usdc.balanceOf(address(this));
            if (balance < pendingWithdrawBalance || amount > balance - pendingWithdrawBalance) {
                revert InsufficientBalance();
            }
        }
        IERC20(token).safeTransfer(to, amount);
    }

    // ──── UUPS ────

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ──── Storage Gap ────

    uint256[50] private __gap;
}
