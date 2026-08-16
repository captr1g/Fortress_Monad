# RESEARCH.md — FORTRESS on Monad, Phase 0 ground truth

Living document. Every phase appends. Facts here were verified in-session against
live RPC, live protocol APIs, and the canonical `monad-crypto/protocols` registry.
Anything not verified is in [§11 UNVERIFIED](#11-unverified).

Session date: **2026-08-16**. Mainnet reference block ≈ **96,415,816**.

> **Recorded divergence from the port prompt (§4).** The prompt requires a clean
> `fortress-monad/` repo separate from the Base source. The operator instructed:
> *"do all the fixing in the fortress. Do not create any other folder."* Work therefore
> proceeds **in-place** in `Monad_Contract/Fortress`. Consequence: the Base repo's
> 539-test baseline is no longer an untouched regression oracle. Mitigation proposed
> in [§12](#12-consequences-of-in-place-porting).

---

## 1. Network facts

Confirmed against docs **and** live RPC.

| Item | Mainnet | Testnet |
|---|---|---|
| Chain ID | **143** | **10143** |
| RPC used | `https://rpc.monad.xyz` | `https://testnet-rpc.monad.xyz` |
| Client version | `Monad/0.15.1` | `Monad/0.16.0` |
| Block gas limit | **150,000,000** | 150,000,000 |
| Base fee | **100 gwei** (= min base fee) | 100 gwei |
| `eth_gasPrice` | 102 gwei | — |
| `eth_maxPriorityFeePerGas` | 2 gwei | — |
| Block time (measured) | **0.30 s** over 100 blocks | — |
| Finality lag (measured) | **2 blocks ≈ 0.6 s** | — |

Finality measured in a **single batched RPC call** so the tags are mutually
consistent: `latest` 96415894 / `safe` 96415893 / `finalized` 96415892. (Measuring
them with sequential calls produces a nonsense result where `finalized > latest`.)

**Testnet runs a newer client than mainnet (0.16.0 vs 0.15.1).** Testnet results are
not automatically valid for mainnet. Re-probe on mainnet before Phase 9.

### 1.1 Timelock / deadline constants

Block time 0.30 s and finality 0.6 s. All FORTRESS timelocks and deadlines are
expressed in **seconds** (`MAX_FEE_TIMELOCK_DELAY = 7 days`, `12h` minimum), so they
port unchanged and still express the intended operational windows. No block-count
assumptions were found in `src/`.

---

## 2. EVM feature probe — **TSTORE/TLOAD AVAILABLE, PHASE 5 NOT BLOCKED**

Method: raw-bytecode probes executed against the **live Monad EVM** via `eth_call`
(contract-creation form), plus a compiled Solidity probe injected with an
`eth_call` state override. A deliberately invalid opcode (`0x0C`) was used as a
negative control to prove the method actually discriminates.

| Feature | Opcode | Testnet 10143 | Mainnet 143 |
|---|---|---|---|
| control (no new opcodes) | — | returns `0x42` | returns `0x42` |
| `PUSH0` | `0x5F` | returns `0x42` | returns `0x42` |
| `MCOPY` | `0x5E` | returns `0x42` | returns `0x42` |
| **`TSTORE`/`TLOAD`** | `0x5D`/`0x5C` | **returns `0x42`** | **returns `0x42`** |
| `CREATE2` | `0xF5` | deployed child `0xce09…bd67` | deployed child `0xce09…bd67` |
| *negative control* | `0x0C` | reverts | reverts |

### 2.1 Transient-storage reentrancy-guard semantics

A Solidity probe mirroring OZ `ReentrancyGuardTransient`'s mechanism was run on both chains:

| Probe | Expectation | Testnet | Mainnet |
|---|---|---|---|
| `roundTrip(0xABCD)` — TSTORE then TLOAD same slot | returns `0xABCD` | **`0xabcd`** | **`0xabcd`** |
| `guardBlocksReentry()` — nested self-call must be rejected | `true` | **`true`** | **`true`** |
| `readsZeroAtTxStart()` — slot must not leak across txs | `0` | **`0`** | **`0`** |

⇒ `MorphoLeverageExecutor` / `MorphoExitExecutor` transient commitment-hash guards
and every adapter's `ReentrancyGuardTransient` inheritance work on Monad as on Base.
**No redesign needed. No scope change.**

### 2.2 `evm_version`

`PUSH0`, `MCOPY`, `TSTORE`/`TLOAD` all present ⇒ **Cancun feature set confirmed available**.
Recommendation: pin `evm_version = "cancun"` in `foundry.toml`. The repo currently pins
**nothing**, which silently lets the compiler's default drift. This is the single
highest-value one-line fix in Phase 1.

---

## 3. Toolchain — **upstream Foundry MIS-PRICES Monad gas (proven, not assumed)**

Installed locally: `forge`/`cast` **1.3.5-stable** — upstream, *not* the Monad fork.

Empirical test: a probe performing `n` **distinct** cold `SLOAD`s, measured by
`eth_estimateGas` with an identical state override on both Monad mainnet and a local
upstream `anvil --hardfork cancun`.

| n | Monad gas | upstream anvil gas |
|---|---|---|
| 1 | 30,301 | 23,964 |
| 2 | 38,482 | 26,129 |
| 5 | 63,442 | 32,624 |
| 10 | 104,429 | 43,449 |
| 20 | **187,722** | **65,099** |

Marginal cost per additional cold `SLOAD`:

| | marginal gas | implied schedule |
|---|---|---|
| **Monad** | **~8,180 – 8,330** | **8,100** ✔ matches documented repricing |
| **upstream Foundry** | **~2,165** | 2,100 (Ethereum) |

**Ratio 3.85×.** At n=20 upstream under-reports by **65%**.

⇒ **Every gas assertion (Phase 3 `test/gas/`, I13 envelopes, CI `forge snapshot --diff`)
must run under Monad Foundry.** Upstream numbers are not merely imprecise, they are
wrong by ~4× on the exact operation FORTRESS does most.

**NOT DONE — needs operator approval.** Installing Monad Foundry
(`curl -L https://foundry.category.xyz | bash && foundryup --network monad`) replaces
the global `forge`/`cast` binaries. The existing Base test suite (539 tests) depends on
the current toolchain. I did not run it unilaterally. See [§13 open questions](#13-open-questions-for-the-operator).

### 3.1 Measured Monad cost constants (for Phase 3)

| Operation | Monad measured | Base/Ethereum equivalent |
|---|---|---|
| Cold `SLOAD` (marginal) | **~8,300** | ~2,165 |
| Repeated **warm** `balanceOf` on same ERC-20 | **2,170** | ~2,170 (unchanged — warm access is not repriced) |
| **First-touch** (cold) `balanceOf` on a new ERC-20 | **~20,400 – 43,600** (avg ≈ 30,000) | ~7,000 |

The cold/warm spread is what matters: on Monad the *first* touch of a token costs
~14× a subsequent touch. Caching and de-duplicating token reads is now the dominant
optimization, exactly as prompt §2 predicted.

---

## 4. Address book

Full detail with per-address verification method: **[`ADDRESSES.md`](./ADDRESSES.md)**.

Headline results:

- All 7 tokens verified by `symbol()` + `decimals()`. **USDC decimals = 6, same as Base** ⇒ BPS math ports unchanged.
- Morpho cluster self-consistent: 4 periphery contracts each return the same core from `MORPHO()`; core `owner()` matches the registry's Safe entry.
- **LI.FI Base diamond `0x1231DEB6…` has NO CODE on Monad** — all 6 repo occurrences are dead.
- Prompt §3.1's claim that Pendle Router V4 is "the same well-known singleton as on Base"
  was treated as suspect per prompt §7 and **verified anyway** — it holds, and all three
  of our router selectors are routed.

---

## 5. Morpho feasibility — **GO**

- `flashLoan(address,uint256,bytes)` (`0xe0232b42`) present in Morpho Blue runtime code.
- Callback `onMorphoFlashLoan(uint256,bytes)` (`0x31f57072`) present, and **identical**
  to `IMorphoFlashLoanCallback` in `src/interfaces/IMorphoBlue.sol`.
- `MorphoLeverageExecutor.sol:179` and `MorphoExitExecutor.sol:216` both implement exactly this shape.

**60 markets** live on chain 143 (`blue-api.morpho.org`, `chainId_in:[143]`).
Proposed initial supported set — USDC-denominated with real liquidity:

| Loan | Collateral | LLTV | Supply USD | Liquidity USD | marketId |
|---|---|---|---|---|---|
| USDC | aHYPER | 77.0% | 41,870,775 | 3,977,452 | `0x9e8441e7af65860feac831ebc117473e3033321abf528ebc8fbde1eeaaa3a626` |
| USDC | PT-USDat-27AUG2026 | 91.5% | 10,721,136 | 1,082,494 | `0xc0ae288f2cf8b3057afc1e898faed145acc2b88b0286e61ccbf456eb40a116fa` |
| USDC | PT-AUSD-8OCT2026 | 91.5% | 5,192,919 | 408,187 | `0x93a7a013b5501cee5d9bee0d29bb3fca790196134c4c7058365e5bc6d2ad80a2` |
| USDC | earnAUSD | 91.5% | 3,368,843 | 424,202 | `0xc4504d2bf84ff1f6ff015afe00086226425dd5a626e096283504154a71821ec1` |
| USDC | wstETH | 86.0% | 107,587 | 10,259 | `0xbc3e3ac4b896a999b2943273f3ed121238a4da4218d4e48533739c0f4b43253e` |
| USDC | WMON | 77.0% | 73,790 | 6,677 | `0xcaa68590c9fd1815f5f2e9f61c2001061813f6e346f07505b9e9b3d228b4aa13` |
| USDC | WBTC | 86.0% | 45,743 | 4,574 | `0xe35c5abc6418b6319b014e07aa3c86163a870a957284128f03cf7a9e414f8899` |

**Do not allowlist:** the registry contains obvious test markets (`TEST/stTEST`,
`testWETH/testwstETH`, `TUSD/TETH`) and markets whose assets resolve to `UNKNOWN`,
all with zero liquidity. Also note `USDC/cbBTC` shows **100% utilization with $2
liquidity** — technically live, economically unusable; excluded.

⚠️ **`PT-USDat-27AUG2026` expires 2026-08-27 — 11 days from this session.** It carries
the 2nd-largest supply on the chain but must not enter a long-lived allowlist without
an expiry policy. See [§13](#13-open-questions-for-the-operator).

---

## 6. Pendle feasibility — **GO, with an expiry caveat**

`IPendleRouter.sol` ABI **matches** Monad Router V4 — all three selectors routed,
negative control rejected. No interface change required. (Detail in `ADDRESSES.md` §4.1.)

**7 active markets** on chain 143 (`api-v2.pendle.finance/core/v1/143/markets/active`):

| Underlying | Market | Expiry | PT |
|---|---|---|---|
| AUSD | `0x6f99cf00ee7290ae78a072bb6910ef72d1129fe7` | 2026-10-08 | `0x9fc74f8ed616b5baf52a170caa97d6d3898602d1` |
| earnAUSD | `0x475b98c83aedbfdd0a0abaa930ec8cb501ac93b1` | 2026-10-08 | `0xdaf216939826acaba0c2312f7e30a890213845cd` |
| **USDat** | `0x1519fb0d8885020387fcd6a67bc888a168a40afa` | **2026-08-27 ⚠️** | `0xf104c6cd68f81579c6a1d85849cb12fcc64bd72a` |
| sUSDe | `0x2142267022ecde6745de9f577e3ba4549ad23abc` | 2026-10-22 | `0xd236e83c563f888f540ca997c3ddf00e82d68c45` |
| USDat | `0x88c5d8a908834e44b421cb67aec9a931782f9538` | 2027-01-14 | `0xa08a69ab9dd3b04d0992bc7afb2c0b907bbdc147` |
| sUSDat | `0x22c2967cc989c313c8c3f205468a11f40f0a95f7` | 2027-01-14 | `0x2e570a44909df47c4cad13c626626f59d056e9da` |
| srUSDat | `0xc945210f85b55946eb970f427e4b9150fff600de` | 2027-01-14 | `0x355e82c60d51d6942bdfd0f2b95a204acd068963` |

Proposed initial allowlist: the **six** markets expiring 2026-10-08 or later.
Exclude `0x1519fb0d…` (expires in 11 days).

**All Base PT/YT/market addresses must be discarded — zero carryover.**

---

## 7. LI.FI feasibility — **GO, but `LiFiAdapter` REQUIRES A REWRITE**

This is the most consequential finding of Phase 0.

- Monad diamond `0x026F252016A7C47CDEf1F05a3Fc9E20C92a49C37` confirmed three ways:
  on-chain code + `owner()`, the canonical registry, and a live `li.quest` quote.
- Diamond exposes **21 facets / 87 selectors**.
- **`swapTokensGeneric` (`0x4630a0d8`) — the ONLY function `src/interfaces/ILiFi.sol`
  declares and the one `LiFiAdapter` calls — is NOT REGISTERED on the Monad diamond.**
- Monad ships **GenericSwapFacetV3** (facet `0xe850dad9b442b1a7df8fbbd397dbb7466379a9e8`)
  with six replacement functions, split by single/multiple and ERC20/native.
- A live `li.quest` quote (USDC→WMON, 1000 USDC, chain 143) returns selector
  **`0x5fd9ae2e`** = `swapTokensMultipleV3ERC20ToERC20`. LI.FI's own router confirms it.

**Impact:** this is *not* an address swap. `ILiFi.sol` and `LiFiAdapter.sol` need new
function signatures and new dispatch logic (choosing among 6 variants by input/output
token type and swap count). Scope moves from Phase 2 (de-Base) into **Phase 4**, and
`LiFiAdapter`'s unit/fuzz tests must be rewritten, not just re-pointed.

Bridging works (Monad→Base USDC quote returns `polymerStandard`, selector `0x17917a4e`).
12 bridges and 7 DEX aggregators are advertised for chain 143 — full facet→name mapping
deferred to Phase 6.

---

## 8. Gas re-derivation — **prediction only, to be measured in Phase 3**

### 8.1 The dominant term is an O(n²) loop already in the code

`src/FortStrategyExecutor.sol:138-144`:

```solidity
uint256[] memory prevOutSnaps = new uint256[](i);
for (uint256 j; j < i; j++) {
    if (tokenOuts[j] != address(0)) {
        prevOutSnaps[j] = IERC20(tokenOuts[j]).balanceOf(address(this));
    }
}
```

This runs **inside** the per-step loop, so across `n` steps it performs
`n(n-1)/2` extra external `balanceOf` calls.

Per-step fixed external reads (from `src/FortStrategyExecutor.sol:114-175`): registry
`SLOAD` of `adapters[id]`, `balanceOf(tokenIn)` for bps sizing, `safeTransfer`,
`balanceOf(inputToken)`, `balanceOf(tokenIn)`, `adapter.execute`, `balanceOf(tokenOut)`.

Total `balanceOf` calls ≈ `4n + n(n-1)/2`.

At the measured Monad warm cost of **2,170 gas** per repeated `balanceOf`:

| n | total balanceOf | gas | of which the O(n²) loop |
|---|---|---|---|
| 5 | 30 | 65,100 | 21,700 (33%) |
| 10 | 85 | 184,450 | 97,650 (53%) |
| 15 | 165 | 358,050 | 227,850 (64%) |
| 20 | 270 | 585,900 | 412,300 (70%) |
| **30 (current `MAX_STEPS`)** | **555** | **1,204,350** | **943,950 (78%)** |

At the current `MAX_STEPS = 30` (`src/FortStrategyExecutor.sol:26`), **78% of the
executor's own bookkeeping gas is the quadratic snapshot loop.**

### 8.2 What actually binds

> ⚠️ **UNRESOLVED CONFLICT — added Phase 2, affects the MAX_STEPS derivation.**
> The `monskills` `gas` skill documents **block gas limit 200M** and a
> **per-transaction gas limit of 30M**. My measurements disagree:
>
> | Source | Block limit | Per-tx limit |
> |---|---|---|
> | monskills `gas` skill | 200,000,000 (target 160M = 80%) | **30,000,000** |
> | Measured `eth_getBlockByNumber(latest).gasLimit` | **150,000,000** | — |
> | Measured RPC ceiling (binary-searched) | 150,000,000 accepted, 150,000,001 rejected `gas limit too high` | no 30M cap observable |
>
> `eth_call` and `eth_estimateGas` both accept up to exactly 150,000,000 and reject
> above it. **No 30M cap is observable through the RPC simulation path.** These are
> reconcilable — a per-tx cap would be enforced at transaction validation/inclusion,
> not during simulation — but I could not confirm it without broadcasting a funded
> transaction, which needs the testnet key requested in §13.2.
>
> **This is load-bearing.** If a 30M per-tx cap is real, it — not the block limit —
> is the hard ceiling, and a 30-step strategy at an estimated 15–20M gas sits
> uncomfortably close to it. `MAX_STEPS` must then be derived against 30M.
> **Phase 3 must resolve this by broadcasting a high-gas-limit transaction on
> testnet before deriving any final constant.**

- **Neither observed limit binds on raw capacity today.** A 30-step strategy with
  realistic adapter internals lands around 15–20M gas — inside both 150M and, more
  narrowly, a hypothetical 30M per-tx cap.
- **The binding constraint is economic**, because Monad charges on `gas_limit`, not
  `gas_used`. At the 100 gwei floor, a 20M-gas limit costs the user **2.0 MON up front,
  whether or not the strategy uses it** — and wallet padding of `eth_estimateGas` makes
  it worse. For calibration, LI.FI's own quote for a *single* swap on 143 returned
  `gasLimit = 2,161,475`.
- **Memory does not bind.** Monad's linear `w/2` pricing with an 8 MB cap makes the
  `Step[]` / `sweepTokens[]` arrays effectively free relative to cold access. Prompt §2's
  prediction that the constraint moves from memory to cold-access cost is confirmed.
- **Contract size does not bind.** `FortStrategyExecutor` deploys at **14,497 bytes** —
  under even Base's 24 KB limit, far under Monad's 128 KB. ⇒ `via_ir = true` in
  `foundry.toml` was **not** forced by the size limit and can be re-justified on its
  merits in Phase 1 rather than inherited.

### 8.3 Predicted `MAX_STEPS`

| Scenario | Predicted `MAX_STEPS` | Rationale |
|---|---|---|
| Keep the O(n²) loop as-is | **~10** | beyond this the snapshot loop alone exceeds ~200k gas and grows quadratically |
| Rewrite the loop to O(n) (Phase 3) | **~20–25** | overhead at n=30 falls from ~1.20M to ~260k |

**Recommendation for Phase 3:** replace the linear scan over `tokenOuts[j]` with a
`mapping(address => uint256)` of token → snapshot (or a de-duplicated token list built
once before the step loop). This preserves the delta-based check exactly — it must
**not** be traded for a cheaper absolute-balance check, which was an explicit audit
finding (prompt §1.3).

These are predictions derived from measured opcode costs, **not** measurements of the
real contract. Phase 3 measures them under Monad Foundry and derives the final number.

---

## 9. `CREATE2` audit (EIP-7702 exposure)

EIP-7702-delegated EOAs on Monad **cannot use `CREATE`/`CREATE2`** when called as a
smart contract, and must hold ≥10 MON.

**Result: FORTRESS `src/` contains no `CREATE` or `CREATE2`.**

Every `new` in `src/` is a memory-array allocation, not contract creation:

| Location | Expression | Verdict |
|---|---|---|
| `src/FortSwapRouter.sol:136` | `new LibSwap.SwapData[](...)` | memory array |
| `src/adapters/LiFiAdapter.sol:185` | `new LibSwap.SwapData[](...)` | memory array |
| `src/adapters/PendleAdapter.sol:175` | `new IPendleRouter.FillOrderParams[](0)` | memory array |
| `src/adapters/AerodromeAdapter.sol:125,229` | `new IAerodromeRouter.Route[](1)` | memory array (adapter is dropped anyway) |
| `src/FortStrategyExecutor.sol:116,138` | `new address[]`, `new uint256[]` | memory array |

⇒ No FORTRESS-owned code path breaks for a 7702-delegated caller. Third-party call-graph
`CREATE2` remains unproven — see [§11](#11-unverified).

---

## 10. Adapter matrix — verified independently

Checked against the canonical registry `monad-crypto/protocols/mainnet` (**175 protocol
files**), not taken from the prompt on faith.

### 10.1 PRESENT — port these

| Component | Status | Evidence |
|---|---|---|
| `LiFiAdapter` | ✅ live, **but needs rewrite** (§7) | `li_fi.jsonc` → `"Li.Fi": 0x026F25…9C37`, matches on-chain + live quote |
| `MorphoStrategyAdapter`, `MorphoLeverageExecutor`, `MorphoExitExecutor` | ✅ live, flash loans confirmed | `morpho.jsonc`; on-chain cluster self-consistent |
| `PendleAdapter`, `PendleStrategyAdapter` | ✅ live, ABI matches | `pendle.jsonc`; 7 active markets |
| `SwapStrategyAdapter` | ✅ portable | venue-agnostic; only allowlist contents change |
| ERC-4626 fast path in `FortVault` | ✅ live targets | `hyperUSDCa`, `bbqAUSD` confirmed funded |

### 10.2 ABSENT — leave EMPTY, no substitutes (prompt §3.3)

| Adapter | Registry check | Verdict |
|---|---|---|
| `CompoundV3Adapter` | no `compound*` file among 175 | ❌ **confirmed absent** |
| `AerodromeAdapter` | no `aerodrome*`, no `velodrome*` | ❌ **confirmed absent** |
| `YoAdapter` | no YO Protocol file (only false-positive substring hits `dyorswap`, `enjoyoors`) | ❌ **confirmed absent** |

Prompt §3.2 is **confirmed correct**. None of the three has appeared on Monad since the
prompt was written.

**Three adapter slots remain empty, awaiting operator.** No substitute was selected,
proposed, or implemented.

### 10.3 Context only — NOT permission to integrate

Registry confirms `aave_v3`, `euler`, `curvance`, `gearbox_protocol`, `neverland`,
`townsquare`, `uniswap`, `curve`, `balancer`, `pancakeswap`, `kuru`, `beefy`, `mellow`,
`lagoon`, `upshift`, `circle_cctp`, `across`, `layerzero`, `axelar`, `debridge`,
`hyperlane_nexus`, `mayan`, `gas_zip` and others are present. Integrating any of them
requires explicit operator instruction.

---

## 11. UNVERIFIED

1. **On-chain broadcast probes.** All EVM feature verification ran against the live
   Monad EVM through `eth_call` / `eth_estimateGas` with state overrides — the same
   interpreter, but **not** a broadcast deployment. The prompt asked for deployed probe
   contracts. Not done because it needs a funded testnet key, and the only key present
   (`.env` `PRIVATE_KEY`) is the **Base deployer**, which prompt rule 7 forbids using.
2. **Monad Foundry not installed.** The mispricing is proven; the corrected toolchain is
   not yet in place. Requires operator approval (global binary replacement).
3. **Third-party `CREATE2`.** FORTRESS is clean; LI.FI's routed DEXs are not statically provable.
4. **Safe `0x69f4D1788e…2938`** — contract confirmed (22,958 B), exact role not proven.
5. **Bridge facet selector→name mapping** — only `polymerStandard` confirmed by live
   quote. `openchain.xyz` signature DB returned HTTP 500 throughout the session, so bulk
   selector resolution failed. Phase 6 work.
6. **Pendle `RouterStatic`, `PendleSwap`, `PYLPOracle`** — code confirmed, no successful
   identity call; identity rests on registry + router association.
7. **Reserve-balance mechanism** — not yet studied; required before Phase 6 keeper design.
8. **Monad opcode/gas docs** — the numeric schedule was confirmed **empirically by
   measurement** (cold SLOAD 8,100). Individual documented precompile reprices
   (`ecRecover` 6000, `ecPairing` 225000, etc.) were **not** independently measured.

---

## 12. Consequences of in-place porting

The operator directed in-place work in `Monad_Contract/Fortress` rather than a separate
repo. Recorded implications:

1. The Base regression baseline (**539 tests passing, 0 failed**, measured this session)
   lives in the same tree being modified. Once Base addresses are removed in Phase 2,
   the Base fork tests can no longer run — the oracle is consumed by the port.
2. Tests for the three dropped adapters (`CompoundV3Adapter`, `AerodromeAdapter`,
   `YoAdapter` — unit + fuzz + mocks) must be deleted rather than simply not-copied.
3. `script/DeployBase.s.sol` and the Base-specific ops scripts become dead code in-tree.
4. Git history will interleave Base and Monad states.

**Mitigation proposed (needs operator approval):** before Phase 1 mutates anything, tag
or branch the current tree (e.g. `git tag base-baseline-539`) so the Base state stays
recoverable. The repository currently has **zero commits**, so this must happen first.

---

## 13. Open questions for the operator

1. **Install Monad Foundry?** Required for any trustworthy gas number. It replaces the
   global `forge`/`cast`. Confirm before I run it.
2. **Testnet key.** Supply a funded, throwaway **testnet-only** key so probes and Phase 9
   can actually broadcast. I will not use `.env`'s Base `PRIVATE_KEY`.
3. **Pendle/Morpho expiry policy.** `PT-USDat-27AUG2026` expires in 11 days but holds the
   2nd-largest Morpho supply on the chain. Should near-expiry markets be excluded by a
   hard rule (e.g. ≥90 days remaining), or curated manually?
4. **`LiFiAdapter` rewrite scope** (§7). Six V3 variants exist. Support only
   `swapTokensSingleV3ERC20ToERC20` + `swapTokensMultipleV3ERC20ToERC20` (the USDC-centric
   path FORTRESS actually needs), or all six including native-MON legs?
5. **Baseline tag** before Phase 1 mutates the tree (§12).
6. **Hardcoded private key** `0x20832bda…79dd` at `Monad_frontend/tests/pendle-e2e.ts:34`
   and `pendle-standalone-buy.ts:27` — not a standard Anvil key. Repo has zero commits,
   so nothing is published yet. Confirm it is throwaway before the first commit.
