# FORTRESS — Monad mainnet deployment

**Chain:** Monad mainnet, **143**. **Deployed:** 2026-08-16.
**Deployer / current owner:** `0xd70b2a6fC3a5781EDB6d440fa39DbF5f58041D55`

Verified with `script/VerifyDeployment.s.sol` against the live chain immediately after
deploy: **all checks passed, 1 warning** (the selector allowlist, see §3).

---

## 1. Addresses

| Contract | Proxy |
|---|---|
| **FortVault** | `0x252709C4569E096BD4babe3be9175Ca2F49f152F` |
| LiFiAdapter | `0x1f2Bda259365BF10210AB6C8C0F4A211eE2be5FC` |
| AaveV3Adapter — **Aave V3 Monad** | `0x1493522095857A3e28e6573E8a1f6b612dd30B40` |
| AaveV3Adapter — **Neverland** | `0x34bce6998d3599B665Ec36b205ab1d91F23f2b4D` |
| ShMonadAdapter | `0x6f9eDe63115707bF01403f12f63Fa5e4616BB47A` |
| FortSwapRouter | `0x220C82bF47cD376f9B71d038Ca45aC6E98482CC0` |
| CrossChainRouter | `0x64b65CF8469bcdb81D8621Cbc4e2F2B36D4f39EE` |

Implementations are in `broadcast/DeployMonad.s.sol/143/run-latest.json`.
Deployment cost ≈ **4.0 MON** at 202 gwei (19,792,560 gas).

### Registered venues

| Registry key | Target | `isERC4626` |
|---|---|---|
| `Aave` | AaveV3Adapter (Aave V3 Monad) | false |
| `Neverland` | AaveV3Adapter (Neverland) | false |
| `shMONAD` | ShMonadAdapter | false |
| `LiFi` | LiFiAdapter | false |
| `Curvance` | `0x21aDBb60…` cUSDC | true |
| `Euler` | `0x1905EDDF…` eUSDC | true |
| `Morpho` | `0x78999cc9…` Hyperithm USDC Apex | true |

`Compound` and `Yearn` are **absent**, as verified — they have no counterparty on Monad.

---

## 2. Live proof the adapters read mainnet state

Called against the deployed proxies immediately after deploy:

```
Aave adapter      availableCapacity() = 108,248,697.748447 USDC
Neverland adapter availableCapacity() =  87,274,200.489985 USDC
ShMonad adapter   availableCapacity() = type(uint128).max   (uncapped)
FortVault         owner()             = 0xd70b2a6f…041D55
```

Those capacity figures are read live from Aave's and Neverland's configuration bitmaps
and aToken supplies — not constants. They track the earlier fork measurements
(109.9M / 87.4M) with the small drift expected from block progression.

---

## 3. What works right now, and what does not

### ✅ Testable immediately — no swap required

`FortVault.deposit()` pulls USDC and routes it straight to these:

| Venue | Path | Capacity |
|---|---|---|
| **Aave V3** | `AaveV3Adapter` | 108.2M |
| **Neverland** | `AaveV3Adapter` | 87.3M |
| **Euler eUSDC** | ERC-4626 fast path | ~6.58M |
| **Curvance cUSDC** | ERC-4626 fast path | uncapped |

**Aave is the best demonstration** — deepest capacity, 3.07% supply APR, and the adapter
already has 10 fork tests passing against this exact market including real supply and
withdraw round trips.

### ⚠️ Registered but at capacity

`Morpho` (Hyperithm USDC Apex) reports `maxDeposit() == 0`. A deposit reverts
`ProtocolAtCapacity` — that is the guard working, not a fault, and it is worth showing
deliberately: a named, attributable revert instead of an anonymous one from inside the
vault. It begins accepting automatically if the curator raises the cap; no redeploy.

### ❌ Blocked — the I5 selector allowlist ships empty

Every swap path reverts `UnauthorizedSelector` until an operator populates the allowlist
on **both** `LiFiAdapter` and `FortSwapRouter`:

- `LiFiAdapter` — all swaps
- `FortSwapRouter.swapAndDeposit`
- `ShMonadAdapter` — its MON leg routes through `LiFiAdapter` by design

This is deliberate and fails closed (`DECISIONS.md` D4-3). The selectors belong to the
venues LI.FI routes *through* (KyberSwap, OpenOcean, Eisen, Monorail, Kuru) and each must
be read off a live chain-143 quote and verified before it is trusted.

---

## 4. Outstanding before this should hold anyone else's money

1. **Ownership is still the deployer's EOA.** No timelock is deployed. That single key
   holds `_authorizeUpgrade` on every proxy above — it can replace any implementation at
   will. Run `DeployTimelock.s.sol` → `TransferOwnership.s.sol` → the timelock's
   `acceptOwnership()`, then re-run `VerifyDeployment.s.sol`, which fails loudly on the
   half-finished state.
2. **The deployer key is also the owner of the live Base FORTRESS deployment.** One key is
   currently the upgrade authority for both chains. This overrode port prompt rule 7 and
   `DECISIONS.md` D0-9, knowingly, under time pressure. Rotating to a Monad-only owner via
   the timelock handover closes it.
3. **No audit.** `Phase 8` delivered an executable access-control sweep, not a security
   review. Slither has not been run.
4. **Phase 5 is unproven on Monad.** The Morpho leverage/exit executors are not deployed
   here and their fork tests still revert on Base fixtures.
5. **Contracts are not source-verified** on an explorer — `MONAD_VERIFIER_URL` is recorded
   UNVERIFIED in `RESEARCH.md` §11.

---

## 5. Reproducing the verification

```bash
cd Monad_Contract/Fortress
export MONAD_RPC_URL=https://rpc.monad.xyz
export FORT_VAULT=0x252709C4569E096BD4babe3be9175Ca2F49f152F
export LIFI_ADAPTER=0x1f2Bda259365BF10210AB6C8C0F4A211eE2be5FC
export AAVE_ADAPTER=0x1493522095857A3e28e6573E8a1f6b612dd30B40
export NEVERLAND_ADAPTER=0x34bce6998d3599B665Ec36b205ab1d91F23f2b4D
export SHMONAD_ADAPTER=0x6f9eDe63115707bF01403f12f63Fa5e4616BB47A
export FORT_SWAP_ROUTER=0x220C82bF47cD376f9B71d038Ca45aC6E98482CC0
export CROSS_CHAIN_ROUTER=0x64b65CF8469bcdb81D8621Cbc4e2F2B36D4f39EE

forge script script/VerifyDeployment.s.sol --rpc-url https://rpc.monad.xyz
```

Read-only; never broadcasts; needs no key.
