// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "./interfaces/IFortProtocol.sol";
import "./interfaces/IFortProtocolEx.sol";
/// @title FortVault — stateless deposit router for FORTRESS protocol
/// @notice Users specify how to split USDC across protocols in a single transaction.
///         All protocol tokens (shares, LP, NFTs) go directly to the user.
///         Vault never holds any tokens beyond a single transaction.

contract FortVault is Ownable2StepUpgradeable, PausableUpgradeable, UUPSUpgradeable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    // ──────────── State ────────────

    IERC20 public usdc;

    struct ProtocolInfo {
        address addr; // protocol or adapter address
        bool isERC4626; // true = call IERC4626 directly, false = call IFortProtocol
    }

    mapping(bytes32 => ProtocolInfo) public protocols;
    bytes32[] public protocolKeys;

    address private __deprecated_lifiDiamond;
    mapping(address => bool) private __deprecated_isApprovedDex;

    uint16 public depositFeeBps; // 0-500 (0%-5%)
    uint16 public constant MAX_DEPOSIT_FEE_BPS = 500;

    uint48 public feeTimelockDelay; // configurable delay in seconds
    uint48 public constant MIN_FEE_TIMELOCK_DELAY = 12 hours;
    uint48 public constant MAX_FEE_TIMELOCK_DELAY = 7 days;
    uint48 public constant DEFAULT_FEE_TIMELOCK_DELAY = 48 hours;

    struct PendingFeeChange {
        uint16 newFeeBps;
        uint48 executeAfter; // timestamp when executable
    }

    PendingFeeChange public pendingFeeChange;

    address public feeRecipient;
    uint256 private __deprecated_pendingFees;

    // ──────────── Structs ────────────

    struct DepositEntry {
        bytes32 protocolKey;
        uint256 amount;
        uint256 minSharesOut; // slippage protection (ERC4626 only; 0 = no check)
        bytes data;
    }

    struct WithdrawEntry {
        bytes32 protocolKey;
        uint256 shares;
        uint256 minUsdcOut; // slippage protection (0 = no check)
        bytes data;
    }

    struct RebalanceEntry {
        bytes32 fromProtocol;
        bytes32 toProtocol;
        uint256 shares;
        uint256 minUsdcOut; // slippage on redeem leg (0 = no check)
        uint256 minSharesOut; // slippage on deposit leg (ERC4626 only; 0 = no check)
        bytes fromData;
        bytes toData;
    }

    // ──────────── Events ────────────

    event ProtocolRegistered(bytes32 indexed key, string name, address addr, bool isERC4626);
    event ProtocolRemoved(bytes32 indexed key);
    event Deposited(address indexed user, uint256 totalUsdc, uint256 entryCount);
    event Withdrawn(address indexed user, uint256 entryCount);
    event Rebalanced(address indexed user, uint256 entryCount);
    event DepositFeeUpdated(uint16 oldFeeBps, uint16 newFeeBps);
    event DepositFeeTaken(address indexed user, uint256 feeAmount);
    event DepositFeeChangeQueued(uint16 newFeeBps, uint48 executeAfter);
    event DepositFeeChangeCancelled(uint16 cancelledFeeBps);
    event FeeTimelockDelayUpdated(uint48 oldDelay, uint48 newDelay);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    // ──────────── Errors ────────────

    error ZeroAddress();
    error ZeroAmount();
    error ProtocolExists(bytes32 key);
    error ProtocolNotFound(bytes32 key);
    error SlippageExceeded(uint256 received, uint256 minimum);
    /// @notice An ERC-4626 target cannot accept this deposit because it is at its cap.
    /// @dev Phase 4 (Monad): every sizeable MetaMorpho V2 USDC vault on Monad currently
    ///      reports `maxDeposit() == 0` (at cap, not gated — all four gate slots are
    ///      address(0)). Without this check the vault's own revert would bubble up with
    ///      no indication of WHICH entry failed, and would take the entire multi-protocol
    ///      deposit down with it. This names the offender so the caller can retry without
    ///      that entry.
    error ProtocolAtCapacity(bytes32 key, uint256 requested, uint256 capacity);
    error FeeTooHigh();
    error NoFeeChangeQueued();
    error FeeChangeNotReady(uint48 executeAfter);
    error FeeChangeExpired();
    error FeeChangeAlreadyQueued();
    error InvalidTimelockDelay();

    // ──────────── Constructor / Initializer ────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _usdc) external initializer {
        if (_usdc == address(0)) revert ZeroAddress();

        __Ownable_init(msg.sender);
        __Ownable2Step_init();
        __Pausable_init();
        // Note: __UUPSUpgradeable_init() removed in OZ 5.x (was no-op)

        usdc = IERC20(_usdc);
        feeTimelockDelay = DEFAULT_FEE_TIMELOCK_DELAY;
        feeRecipient = msg.sender;
    }

    // ══════════════════════════════════════════════════════════════
    //                    OWNER: PROTOCOL REGISTRY
    // ══════════════════════════════════════════════════════════════

    function registerProtocol(string calldata name, address addr, bool isERC4626) external onlyOwner {
        if (addr == address(0)) revert ZeroAddress();
        bytes32 key = keccak256(bytes(name));
        if (protocols[key].addr != address(0)) revert ProtocolExists(key);

        protocols[key] = ProtocolInfo(addr, isERC4626);
        protocolKeys.push(key);
        emit ProtocolRegistered(key, name, addr, isERC4626);
    }

    function removeProtocol(string calldata name) external onlyOwner {
        bytes32 key = keccak256(bytes(name));
        if (protocols[key].addr == address(0)) revert ProtocolNotFound(key);

        delete protocols[key];

        for (uint256 i; i < protocolKeys.length; i++) {
            if (protocolKeys[i] == key) {
                protocolKeys[i] = protocolKeys[protocolKeys.length - 1];
                protocolKeys.pop();
                break;
            }
        }
        emit ProtocolRemoved(key);
    }

    function protocolCount() external view returns (uint256) {
        return protocolKeys.length;
    }

    // ══════════════════════════════════════════════════════════════
    //                    OWNER: DEPOSIT FEE
    // ══════════════════════════════════════════════════════════════

    function queueDepositFeeBps(uint16 _feeBps) external onlyOwner {
        if (_feeBps > MAX_DEPOSIT_FEE_BPS) revert FeeTooHigh();
        if (pendingFeeChange.executeAfter != 0) revert FeeChangeAlreadyQueued();

        uint48 delay = feeTimelockDelay;
        if (delay == 0) delay = DEFAULT_FEE_TIMELOCK_DELAY; // safe for upgrades
        uint48 executeAfter = uint48(block.timestamp) + delay;

        pendingFeeChange = PendingFeeChange(_feeBps, executeAfter);
        emit DepositFeeChangeQueued(_feeBps, executeAfter);
    }

    function executeDepositFeeBps() external onlyOwner {
        PendingFeeChange memory pending = pendingFeeChange;
        if (pending.executeAfter == 0) revert NoFeeChangeQueued();
        if (block.timestamp < pending.executeAfter) revert FeeChangeNotReady(pending.executeAfter);
        if (block.timestamp > pending.executeAfter + 48 hours) revert FeeChangeExpired();

        uint16 old = depositFeeBps;
        depositFeeBps = pending.newFeeBps;
        delete pendingFeeChange;
        emit DepositFeeUpdated(old, pending.newFeeBps);
    }

    function cancelDepositFeeBps() external onlyOwner {
        PendingFeeChange memory pending = pendingFeeChange;
        if (pending.executeAfter == 0) revert NoFeeChangeQueued();

        uint16 cancelled = pending.newFeeBps;
        delete pendingFeeChange;
        emit DepositFeeChangeCancelled(cancelled);
    }

    function setFeeTimelockDelay(uint48 _delay) external onlyOwner {
        if (_delay < MIN_FEE_TIMELOCK_DELAY || _delay > MAX_FEE_TIMELOCK_DELAY) revert InvalidTimelockDelay();
        uint48 old = feeTimelockDelay;
        feeTimelockDelay = _delay;
        emit FeeTimelockDelayUpdated(old, _delay);
    }

    function setFeeRecipient(address _recipient) external onlyOwner {
        if (_recipient == address(0)) revert ZeroAddress();
        address old = feeRecipient;
        feeRecipient = _recipient;
        emit FeeRecipientUpdated(old, _recipient);
    }

    function _collectFee(uint256 amount) internal returns (uint256 netAmount) {
        uint16 feeBps = depositFeeBps;
        if (feeBps == 0) return amount;
        uint256 fee = (amount * feeBps) / 10000;
        if (fee > 0) {
            address recipient = feeRecipient;
            if (recipient == address(0)) recipient = owner();
            usdc.safeTransfer(recipient, fee);
            emit DepositFeeTaken(msg.sender, fee);
        }
        return amount - fee;
    }

    // ══════════════════════════════════════════════════════════════
    //                    USER: DEPOSIT
    // ══════════════════════════════════════════════════════════════

    /// @notice Deposit USDC split across protocols. All output tokens go to msg.sender.
    function deposit(DepositEntry[] calldata entries) external whenNotPaused nonReentrant {
        uint256 total;
        for (uint256 i; i < entries.length; i++) {
            total += entries[i].amount;
        }
        if (total == 0) revert ZeroAmount();

        usdc.safeTransferFrom(msg.sender, address(this), total);
        uint256 netTotal = _collectFee(total);

        uint256 deposited;
        for (uint256 i; i < entries.length; i++) {
            ProtocolInfo memory p = protocols[entries[i].protocolKey];
            if (p.addr == address(0)) revert ProtocolNotFound(entries[i].protocolKey);

            uint256 entryAmount;
            if (i == entries.length - 1) {
                entryAmount = netTotal - deposited;
            } else {
                entryAmount = (entries[i].amount * netTotal) / total;
                deposited += entryAmount;
            }

            usdc.forceApprove(p.addr, entryAmount);

            if (p.isERC4626) {
                // Capacity guard: fail with a precise, attributable error instead of
                // letting the vault's own revert bubble up anonymously.
                uint256 capacity = IERC4626(p.addr).maxDeposit(msg.sender);
                if (entryAmount > capacity) {
                    revert ProtocolAtCapacity(entries[i].protocolKey, entryAmount, capacity);
                }
                uint256 sharesOut = IERC4626(p.addr).deposit(entryAmount, msg.sender);
                if (entries[i].minSharesOut != 0 && sharesOut < entries[i].minSharesOut) {
                    revert SlippageExceeded(sharesOut, entries[i].minSharesOut);
                }
            } else if (entries[i].data.length > 0) {
                IFortProtocolEx(p.addr).depositFor(entryAmount, msg.sender, entries[i].data);
            } else {
                IFortProtocol(p.addr).depositFor(entryAmount, msg.sender);
            }

            usdc.forceApprove(p.addr, 0);
        }

        emit Deposited(msg.sender, total, entries.length);
    }

    // ══════════════════════════════════════════════════════════════
    //                    USER: WITHDRAW
    // ══════════════════════════════════════════════════════════════

    /// @notice Redeem shares from protocols. USDC goes directly to msg.sender.
    /// @dev User must have approved vault on each protocol's share token.
    function withdraw(WithdrawEntry[] calldata entries) external whenNotPaused nonReentrant {
        for (uint256 i; i < entries.length; i++) {
            ProtocolInfo memory p = protocols[entries[i].protocolKey];
            if (p.addr == address(0)) revert ProtocolNotFound(entries[i].protocolKey);

            uint256 usdcOut;
            if (p.isERC4626) {
                usdcOut = IERC4626(p.addr).redeem(entries[i].shares, msg.sender, msg.sender);
            } else if (entries[i].data.length > 0) {
                usdcOut = IFortProtocolEx(p.addr).redeemFor(entries[i].shares, msg.sender, msg.sender, entries[i].data);
            } else {
                usdcOut = IFortProtocol(p.addr).redeemFor(entries[i].shares, msg.sender, msg.sender);
            }

            if (entries[i].minUsdcOut != 0 && usdcOut < entries[i].minUsdcOut) {
                revert SlippageExceeded(usdcOut, entries[i].minUsdcOut);
            }
        }

        emit Withdrawn(msg.sender, entries.length);
    }

    // ══════════════════════════════════════════════════════════════
    //                    USER: REBALANCE
    // ══════════════════════════════════════════════════════════════

    /// @notice Move positions between protocols atomically.
    ///         Redeems from source → USDC to vault (temporary) → deposits into target → tokens to user.
    /// @dev User must have approved vault on source protocol's share token.
    function rebalance(RebalanceEntry[] calldata entries) external whenNotPaused nonReentrant {
        for (uint256 i; i < entries.length; i++) {
            ProtocolInfo memory pFrom = protocols[entries[i].fromProtocol];
            ProtocolInfo memory pTo = protocols[entries[i].toProtocol];
            if (pFrom.addr == address(0)) revert ProtocolNotFound(entries[i].fromProtocol);
            if (pTo.addr == address(0)) revert ProtocolNotFound(entries[i].toProtocol);

            // Redeem from source → USDC to vault (temporary within tx)
            uint256 usdcOut;
            if (pFrom.isERC4626) {
                usdcOut = IERC4626(pFrom.addr).redeem(entries[i].shares, address(this), msg.sender);
            } else if (entries[i].fromData.length > 0) {
                usdcOut = IFortProtocolEx(pFrom.addr)
                    .redeemFor(entries[i].shares, address(this), msg.sender, entries[i].fromData);
            } else {
                usdcOut = IFortProtocol(pFrom.addr).redeemFor(entries[i].shares, address(this), msg.sender);
            }

            if (entries[i].minUsdcOut != 0 && usdcOut < entries[i].minUsdcOut) {
                revert SlippageExceeded(usdcOut, entries[i].minUsdcOut);
            }

            // Deposit into target → tokens to user
            usdc.forceApprove(pTo.addr, usdcOut);
            if (pTo.isERC4626) {
                // Same capacity guard as deposit(): a rebalance INTO a capped vault
                // would otherwise redeem the source position and then revert, which is
                // atomic and therefore safe, but opaque about which leg failed.
                uint256 toCapacity = IERC4626(pTo.addr).maxDeposit(msg.sender);
                if (usdcOut > toCapacity) {
                    revert ProtocolAtCapacity(entries[i].toProtocol, usdcOut, toCapacity);
                }
                uint256 sharesOut = IERC4626(pTo.addr).deposit(usdcOut, msg.sender);
                if (entries[i].minSharesOut != 0 && sharesOut < entries[i].minSharesOut) {
                    revert SlippageExceeded(sharesOut, entries[i].minSharesOut);
                }
            } else if (entries[i].toData.length > 0) {
                IFortProtocolEx(pTo.addr).depositFor(usdcOut, msg.sender, entries[i].toData);
            } else {
                IFortProtocol(pTo.addr).depositFor(usdcOut, msg.sender);
            }

            usdc.forceApprove(pTo.addr, 0);
        }

        emit Rebalanced(msg.sender, entries.length);
    }

    // ══════════════════════════════════════════════════════════════
    //                    OWNER: EMERGENCY
    // ══════════════════════════════════════════════════════════════

    /// @notice Rescue tokens accidentally sent to vault
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    // ══════════════════════════════════════════════════════════════
    //                    OWNER: PAUSE
    // ══════════════════════════════════════════════════════════════

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
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
