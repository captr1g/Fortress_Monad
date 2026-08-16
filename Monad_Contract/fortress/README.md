# FORTRESS Protocol

Stateless deposit router for USDC yield on Base. Users split deposits across multiple DeFi protocols in a single transaction. All output tokens (shares, LP tokens) go directly to the user — the vault never custodies funds beyond a single tx.

## Architecture

```
                          +------------------+
                          |     User EOA     |
                          +--------+---------+
                                   |
                          deposit / withdraw / rebalance / swapAndDeposit
                                   |
                          +--------v---------+
                          |  ERC1967 Proxy   |
                          |  (UUPS pattern)  |
                          +--------+---------+
                                   |
                          +--------v---------+
                          |    FortVault     |
                          |  (Implementation)|
                          +--------+---------+
                                   |
                 +-----------------+-----------------+
                 |                 |                 |
         +-------v------+  +------v-------+  +------v-------+
         |   ERC-4626   |  | IFortProtocol|  |IFortProtocolEx|
         |  (direct)    |  |  (adapter)   |  | (adapter+data)|
         +--------------+  +--------------+  +--------------+
                 |                 |                 |
         +-------v------+  +------v-------+  +------v-------+
         |    Morpho    |  | CompoundV3   |  | LiFiAdapter  |
         |  Moonwell    |  |   Adapter    |  |      |       |
         |    Aave      |  +--------------+  +------v-------+
         |    Fluid     |  +------v-------+  | LiFi Diamond |
         |    Euler     |  | PendleAdapter|  +--------------+
         +--------------+  |  (with data) |
                           +--------------+

                          +------------------+
                          |     User EOA     |
                          +--------+---------+
                                   |
                     depositCrossChain / initiateWithdraw / claimWithdraw
                                   |
                          +--------v---------+
                          | CrossChainRouter |
                          |  (standalone)    |
                          +--------+---------+
                                   |
                    +--------------+--------------+
                    |                             |
           +--------v---------+          +--------v---------+
           |   LiFi Diamond   |          |     Keeper       |
           | (bridge to dest) |          | (fulfill/refund) |
           +------------------+          +------------------+
```

## Deposit Flow

```
User                    FortVault                Protocol / Adapter
 |                          |                          |
 |-- deposit(entries[]) --->|                          |
 |                          |-- transferFrom(USDC) --->|  (pull total USDC from user)
 |                          |                          |
 |                          |  for each entry:         |
 |                          |                          |
 |                          |  [ERC-4626]              |
 |                          |-- approve + deposit() -->|  Morpho / Aave / etc.
 |                          |          shares -------->|  (minted to user directly)
 |                          |                          |
 |                          |  [Adapter, no data]      |
 |                          |-- approve + depositFor ->|  IFortProtocol adapter
 |                          |          tokens -------->|  (sent to user directly)
 |                          |                          |
 |                          |  [Adapter, with data]    |
 |                          |-- approve + depositFor ->|  IFortProtocolEx adapter
 |                          |    (amount, user, data)  |  (e.g. LiFi swap routes)
 |                          |          tokens -------->|  (sent to user directly)
 |                          |                          |
 |                          |  vault USDC balance = 0  |
 |<--- Deposited event -----|                          |
```

## Swap and Deposit Flow

For users holding non-USDC tokens (WETH, WBTC, etc.). Swaps to USDC via LiFi then split-deposits across protocols in a single transaction. Uses basis points (BPS) instead of absolute amounts since swap output is non-deterministic. Last entry gets the remainder to eliminate dust.

```
User                    FortVault                LiFi Diamond         Protocol / Adapter
 |                          |                        |                      |
 |-- swapAndDeposit() ----->|                        |                      |
 |   (inputToken, amount,   |                        |                      |
 |    minUsdcOut, deadline,  |                        |                      |
 |    swapData[], entries[]) |                        |                      |
 |                          |                        |                      |
 |                          |  validate: lifi set,   |                      |
 |                          |  amount > 0,           |                      |
 |                          |  token != USDC,        |                      |
 |                          |  deadline, BPS = 10000 |                      |
 |                          |                        |                      |
 |                          |  validate swapData:    |                      |
 |                          |  callTo in approvedDex |                      |
 |                          |  approveTo == lifi     |                      |
 |                          |  override fromAmount   |                      |
 |                          |                        |                      |
 |                          |-- transferFrom(token)->|  (pull input token)  |
 |                          |-- approve + swap() --->|                      |
 |                          |<-- USDC to vault ------|                      |
 |                          |                        |                      |
 |                          |  slippage check        |                      |
 |                          |  clear token approval  |                      |
 |                          |                        |                      |
 |                          |  for each entry (BPS split):                  |
 |                          |-- approve + deposit -->|                      |
 |                          |          tokens ------>|               (to user)
 |                          |                        |                      |
 |                          |  vault balance = 0     |                      |
 |<-- SwapAndDeposited -----|                        |                      |
```

## Rebalance Flow

```
User                    FortVault              Source Protocol    Target Protocol
 |                          |                       |                   |
 |-- rebalance(entries[]) ->|                       |                   |
 |                          |                       |                   |
 |                          |-- redeem/redeemFor -->|                   |
 |                          |<-- USDC (to vault) ---|                   |
 |                          |                       |                   |
 |                          |-- approve + deposit/depositFor --------->|
 |                          |                       |    shares ------->| (to user)
 |                          |                       |                   |
 |                          |  vault USDC balance = 0                   |
 |<--- Rebalanced event ----|                       |                   |
```

## Protocol Dispatch Logic

```
entry.data empty?
    |
    +-- YES --> protocol.isERC4626?
    |               |
    |               +-- YES --> IERC4626.deposit(amount, user)
    |               +-- NO  --> IFortProtocol.depositFor(amount, user)
    |
    +-- NO  --> IFortProtocolEx.depositFor(amount, user, data)
```

## Contract Overview

| Contract | Description |
|---|---|
| `FortVault` | Core router. UUPS upgradeable, Ownable2Step, Pausable, ReentrancyGuard. Manages protocol registry and dispatches deposits/withdrawals/rebalances/swapAndDeposits. Integrates LiFi for token swaps with DEX allowlisting. |
| `CrossChainRouter` | Standalone cross-chain deposit/withdraw router. Bridges USDC via LiFi to destination chains. Async model: deposit initiates bridge, keeper tracks status, withdrawals use intent-fulfill-claim pattern. |
| `IFortProtocol` | Adapter interface for non-ERC4626 protocols. `depositFor(amount, receiver)` and `redeemFor(shares, receiver, owner)`. |
| `IFortProtocolEx` | Extended adapter interface. Adds `bytes calldata data` parameter for protocols needing dynamic routing data (swap routes, bridge params). |
| `ICrossChainRouter` | Cross-chain router interface. Defines `DepositRequest`/`WithdrawRequest` structs, `RequestStatus` enum, and deposit/withdraw/claim/refund functions. |
| `ILiFi` | LiFi Diamond types. `LibSwap.SwapData` struct and `ILiFiGenericSwapFacet` interface. |
| `LiFiAdapter` | Stateless adapter for LiFi Diamond. Encodes/decodes swap data, overrides `fromAmount` for security, provides `rescueToken` for emergencies. |
| `CompoundV3Adapter` | Adapter for Compound V3 (Comet). Wraps supply/withdraw calls to the Comet contract via IFortProtocol interface. |
| `PendleAdapter` | Adapter for Pendle PT operations. Buys PT on deposit via `swapExactTokenForPt`, sells/redeems PT on withdraw. Market whitelist via `setApprovedMarket`. Implements IFortProtocolEx (requires `bytes data`). |

## Deployed Contracts (Base Mainnet)

| Contract | Address | Verified |
|---|---|---|
| FortVault (Proxy) | [`0x1d19D3421a5a277201bEc3F596d61FB866284506`](https://basescan.org/address/0x1d19D3421a5a277201bEc3F596d61FB866284506) | [BaseScan](https://basescan.org/address/0x364fbbe0cE0f0828c3D2CAEa284d6fcD85De25F9#code) |
| FortVault (Impl) | [`0x364fbbe0cE0f0828c3D2CAEa284d6fcD85De25F9`](https://basescan.org/address/0x364fbbe0cE0f0828c3D2CAEa284d6fcD85De25F9) | [BaseScan](https://basescan.org/address/0x364fbbe0cE0f0828c3D2CAEa284d6fcD85De25F9#code) |
| LiFiAdapter | [`0x5460286d8C0B7d50Dd422c12De34944Eb081C138`](https://basescan.org/address/0x5460286d8C0B7d50Dd422c12De34944Eb081C138) | [BaseScan](https://basescan.org/address/0x5460286d8C0B7d50Dd422c12De34944Eb081C138#code) |
| CrossChainRouter | [`0x7D15b7fe74810EBBA1a153A4Bf732d8Ee85B3739`](https://basescan.org/address/0x7D15b7fe74810EBBA1a153A4Bf732d8Ee85B3739) | [BaseScan](https://basescan.org/address/0x7D15b7fe74810EBBA1a153A4Bf732d8Ee85B3739#code) |
| CompoundV3Adapter | [`0xC161A7A56124c45430CB52A2Ef27Cd9BD991688d`](https://basescan.org/address/0xC161A7A56124c45430CB52A2Ef27Cd9BD991688d) | [BaseScan](https://basescan.org/address/0xC161A7A56124c45430CB52A2Ef27Cd9BD991688d#code) |
| PendleAdapter | [`0x43Cb307003f9A9E069dF9741dA59F1e462774014`](https://basescan.org/address/0x43Cb307003f9A9E069dF9741dA59F1e462774014) | [BaseScan](https://basescan.org/address/0x43Cb307003f9A9E069dF9741dA59F1e462774014#code) |

### Registered Protocols

| Protocol | Address | Type |
|---|---|---|
| Morpho Moonwell USDC | `0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca` | ERC-4626 |
| Aave V3 StataTokenV2 USDC | `0xC768c589647798a6EE01A91FdE98EF2ed046DBD6` | ERC-4626 |
| Fluid fUSDC | `0xf42f5795D9ac7e9D757dB633D693cD548Cfd9169` | ERC-4626 |
| Euler Earn USDC | `0x67f062a12f82c3b42d4CA7a35fb26CbAac28008B` | ERC-4626 |
| LiFi (via LiFiAdapter) | `0x5460286d8C0B7d50Dd422c12De34944Eb081C138` | Adapter |
| CompoundV3 (via CompoundV3Adapter) | [`0xC161A7A56124c45430CB52A2Ef27Cd9BD991688d`](https://basescan.org/address/0xC161A7A56124c45430CB52A2Ef27Cd9BD991688d) | Adapter |
| Pendle (via PendleAdapter) | [`0x43Cb307003f9A9E069dF9741dA59F1e462774014`](https://basescan.org/address/0x43Cb307003f9A9E069dF9741dA59F1e462774014) | Adapter |

### Pendle Whitelisted Markets

| Market | Address | Expiry |
|---|---|---|
| yoUSD | `0x250c15e59a7572195e248f668636723cca20a2b8` | 2026-09-24 |
| 40acresUSDC | `0x87e9a352d50146fa03373c52b9b21a32402a9597` | 2026-08-27 |
| USDC (Morpho cbBTC) | `0xa97bb0de338b23c088dba9bf8c948da726e49033` | 2026-09-17 |

### External Dependencies

| Name | Address | Type |
|---|---|---|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | ERC-20 |
| LiFi Diamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | Diamond proxy |
| Compound V3 Comet (USDC) | `0xb125E6687d4313864e53df431d5425969c15Eb2F` | Comet proxy |
| Pendle Router V4 | `0x888888888889758F76e7103c6CbF23ABbF58F946` | Router |
| Fluid fUSDC Vault | `0xf42f5795D9ac7e9D757dB633D693cD548Cfd9169` | ERC-4626 |
| Euler Earn USDC Vault | `0x67f062a12f82c3b42d4CA7a35fb26CbAac28008B` | ERC-4626 |

## Adding Protocols Post-Deploy

No upgrade required. Owner calls `registerProtocol` on the proxy:

```solidity
// ERC-4626 protocol — register address directly
vault.registerProtocol("Morpho", 0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca, true);

// Non-ERC4626 protocol — deploy adapter, register adapter address
LiFiAdapter adapter = new LiFiAdapter(USDC, LIFI_DIAMOND, owner);
vault.registerProtocol("LiFi", address(adapter), false);

// Remove a protocol
vault.removeProtocol("Morpho");
```

## Configuring LiFi (for swapAndDeposit)

Owner sets the LiFi Diamond address and approves DEXes that LiFi may route swaps through:

```solidity
// Set LiFi Diamond
vault.setLiFiDiamond(0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE);

// Approve DEXes that LiFi routes through
vault.setApprovedDex(0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE, true); // LiFi itself
vault.setApprovedDex(0xDEF1ABE..., true); // e.g. 0x Exchange Proxy

// Revoke a DEX
vault.setApprovedDex(0xDEF1ABE..., false);
```

## Cross-Chain Deposit Flow

```
User                  CrossChainRouter            LiFi Diamond          Destination
 |                          |                          |                    |
 |-- depositCrossChain() -->|                          |                    |
 |   (amount, destChain,    |                          |                    |
 |    lifiData, deadline)   |                          |                    |
 |                          |-- transferFrom(USDC) --->|                    |
 |                          |-- forceApprove(LiFi) --->|                    |
 |                          |-- lifiDiamond.call() --->|                    |
 |                          |   (raw bridge calldata)  |--- bridge USDC --->|
 |                          |   balance delta check    |                    |
 |                          |                          |         shares --> user on dest
 |<-- requestId (Pending) --|                          |                    |
 |                          |                          |                    |
 |        ... async bridge completes ...               |                    |
 |                          |                          |                    |
 |  Keeper: markDepositCompleted(requestId)            |                    |
```

## Cross-Chain Withdraw Flow

```
User                  CrossChainRouter            Keeper
 |                          |                       |
 |-- initiateWithdraw() --->|                       |
 |   (expectedUsdc,         |                       |
 |    sourceChain, deadline) |                       |
 |<-- requestId (Pending) --|                       |
 |                          |                       |
 |    ... keeper redeems shares on dest chain ...   |
 |    ... keeper bridges USDC back to router ...    |
 |                          |                       |
 |                          |<-- fulfillWithdraw() -|
 |                          |   (requestId, amount) |
 |                          |   status → Completed  |
 |                          |                       |
 |-- claimWithdraw() ------>|                       |
 |<-- USDC transferred -----|                       |
 |                          |   status → Claimed    |
```

## Security Model

### FortVault (Same-Chain)
- **Stateless**: Vault USDC balance = 0 after every tx. No custodied funds.
- **UUPS Upgradeable**: Only owner can upgrade implementation.
- **Ownable2Step**: Ownership transfer requires explicit acceptance.
- **Pausable**: Owner can pause all user operations in emergencies.
- **ReentrancyGuard**: Prevents reentrancy on deposit/withdraw/rebalance.
- **fromAmount Override**: LiFiAdapter forces `swapData[0].fromAmount` to match the vault-provided amount, preventing user-submitted data from inflating swap amounts.
- **DEX Allowlist**: `swapAndDeposit` validates every `swapData[].callTo` against `isApprovedDex` mapping. `approveTo` must equal `lifiDiamond`. Prevents routing through malicious contracts.
- **BPS Split (No Dust)**: Swap output split using basis points (sum = 10000). Last entry receives remainder, eliminating rounding dust.
- **Approval Hygiene**: Input token approval to LiFi Diamond cleared to zero after every swap.
- **rescueToken**: Owner-only emergency recovery on adapters.

### CrossChainRouter (Cross-Chain)
- **Standalone**: Completely separate from FortVault. No shared state, no regression risk.
- **Balance Delta Check**: Verifies LiFi consumed the deposited USDC. Reverts with `UsdcNotConsumed` if USDC stays in or returns to the router.
- **Pending Withdraw Accounting**: `pendingWithdrawBalance` tracks USDC reserved for fulfilled withdrawals. Rescue and refund functions cannot touch reserved funds.
- **Underflow Protection**: All balance-minus-pending calculations guard against underflow with explicit checks.
- **Keeper + Owner Dual Access**: Keeper manages status transitions; owner retains override access.
- **Approval Hygiene**: Residual LiFi approval cleared to zero after every deposit.
- **Pausable**: Owner can pause deposits and withdrawal initiations.

## Project Structure

```
src/
  FortVault.sol                    # Core vault (UUPS proxy implementation)
  CrossChainRouter.sol             # Standalone cross-chain deposit/withdraw router
  interfaces/
    IFortProtocol.sol              # Base adapter interface
    IFortProtocolEx.sol            # Extended interface (bytes data)
    ICrossChainRouter.sol          # Cross-chain router interface
    ILiFi.sol                      # LiFi Diamond types
    IComet.sol                     # Compound V3 Comet interface
    IPendleRouter.sol              # Pendle V2 Router interface (PT operations)
  adapters/
    LiFiAdapter.sol                # Stateless LiFi adapter
    CompoundV3Adapter.sol          # Compound V3 (Comet) adapter
    PendleAdapter.sol              # Pendle PT adapter (market-whitelisted)
  strategies/
    DiversifiedYieldStrategy.sol   # Multi-protocol yield strategy

script/
  DeployBase.s.sol                 # Full deployment: vault + adapter + router + config
  DeployNewProtocols.s.sol         # Deploy Fluid, Euler, CompoundV3, Pendle on existing vault
  PostDeploy.s.sol                 # Post-deploy verification + optional configuration

test/
  helpers/
    FortVaultTestBase.sol          # Shared test setup (proxy deploy, MockUSDC)
  mocks/
    MockUSDC.sol                   # ERC20, 6 decimals, public mint/burn
    MockERC4626Vault.sol           # OZ ERC4626, 1:1 share ratio
    MockFortProtocol.sol           # IFortProtocol mock with call recording
    MockFortProtocolEx.sol         # IFortProtocolEx mock with data recording
    MockLiFiDiamond.sol            # LiFi swap simulator with configurable rate
    MockLiFiBridge.sol             # LiFi cross-chain bridge simulator
    MockComet.sol                  # Compound V3 Comet mock
    MockPendleRouter.sol           # Pendle Router mock
  unit/
    FortVault.registry.t.sol       # Protocol registry tests
    FortVault.deposit.t.sol        # Deposit dispatch tests
    FortVault.withdraw.t.sol       # Withdraw dispatch tests
    FortVault.rebalance.t.sol      # Rebalance flow tests
    FortVault.access.t.sol         # Access control tests
    FortVault.swapAndDeposit.t.sol # Swap+deposit: happy path, reverts, admin (22 tests)
    LiFiAdapter.t.sol              # Adapter unit tests
    CompoundV3Adapter.t.sol        # CompoundV3 adapter unit tests
    PendleAdapter.t.sol            # Pendle adapter unit tests
    CrossChainRouter.t.sol         # Cross-chain router tests (76 tests)
  fork/
    FortVault.morpho.fork.t.sol    # Morpho on Base mainnet
    FortVault.lifi.fork.t.sol      # LiFi on Base mainnet
    CompoundV3Fork.t.sol           # CompoundV3 on Base mainnet
    PendleFork.t.sol               # Pendle on Base mainnet
    FluidFork.t.sol                # Fluid on Base mainnet
    EulerFork.t.sol                # Euler on Base mainnet
  fuzz/
    FortVault.fuzz.t.sol           # Fuzz: amounts, roundtrips, value preservation
    FortVault.swapAndDeposit.fuzz.t.sol # Fuzz: swap amounts, BPS split proportions
    LiFiAdapter.fuzz.t.sol         # Fuzz: amount override, slippage
```

## Usage

### Build

```shell
forge build
```

### Test (Unit + Fuzz)

```shell
forge test --match-path "test/unit/*" -vvv
forge test --match-path "test/fuzz/*" -vvv
```

### Test (Fork — requires Base RPC)

```shell
BASE_RPC_URL=https://mainnet.base.org forge test --match-path "test/fork/*" -vvv
```

### Run All Tests

```shell
BASE_RPC_URL=https://mainnet.base.org forge test -vvv
```

### Deploy (Base Mainnet)

```shell
# Set environment variables
cp .env.example .env
# Edit .env with your PRIVATE_KEY (with 0x prefix), BASE_RPC_URL, BASESCAN_API_KEY

# Dry run (simulation only)
source .env && forge script script/DeployBase.s.sol:DeployBase --rpc-url base -vvvv

# Live deployment
source .env && forge script script/DeployBase.s.sol:DeployBase --rpc-url base --broadcast -vvvv
```

### Post-Deploy Verification

```shell
# Add deployed addresses to .env:
#   VAULT_PROXY=0x...
#   LIFI_ADAPTER=0x...
#   CROSS_CHAIN_ROUTER=0x...

source .env && forge script script/PostDeploy.s.sol:PostDeploy --rpc-url base -vvvv
```

### Verify Contracts on BaseScan

```shell
source .env && forge verify-contract <IMPL_ADDRESS> src/FortVault.sol:FortVault \
  --chain base --etherscan-api-key $BASESCAN_API_KEY --watch

source .env && forge verify-contract <ADAPTER_ADDRESS> src/adapters/LiFiAdapter.sol:LiFiAdapter \
  --chain base --etherscan-api-key $BASESCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address,address,address)" $USDC $LIFI $DEPLOYER) --watch

source .env && forge verify-contract <ROUTER_ADDRESS> src/CrossChainRouter.sol:CrossChainRouter \
  --chain base --etherscan-api-key $BASESCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address,address,address,address)" $USDC $LIFI $DEPLOYER $KEEPER) --watch
```

## Dependencies

- [OpenZeppelin Contracts v5](https://github.com/OpenZeppelin/openzeppelin-contracts)
- [OpenZeppelin Contracts Upgradeable v5](https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable)
- [Forge Std](https://github.com/foundry-rs/forge-std)

## License

MIT

Strategy: BalancedStrategy                                                                              
  Address: 0x39359f714D5C845c92b754512214217F6684a1A0                                                     
  USDC Invested: 2 USDC                                                                                   
  Split: 1 Morpho / 1 Aave                                                                                
  ────────────────────────────────────────                                                                
  Strategy: DynamicYieldStrategy                                                                          
  Address: 0xfa8ae2567Aec041d5EB473570C5AaA10C2DE9231                                                     
  USDC Invested: 2 USDC
  Split: 1 Morpho / 1 Aave
