# Gas model — FORTRESS on Monad

Phase 3 deliverable. Every number here is measured, not estimated. Where a number
is an estimate it says so.

---

## 1. Why gas is a correctness concern on Monad, not an optimisation

Monad charges on **`gas_limit`, not `gas_used`**:

```
gas_paid = gas_limit × price_per_gas
```

deducted up front. A user who submits a strategy with a wallet-padded 20M gas limit
**pays for 20M gas** even if the transaction consumes 4M. At the 100 gwei floor that
is 2.0 MON, gone, regardless of actual consumption. Reverting transactions still pay
in full.

Consequences that shape everything below:

- Every entry point needs a **measured** worst-case envelope (invariant I13).
- The SDK/frontend must set **tight explicit gas limits**, never a padded
  `eth_estimateGas`. This is a user-facing cost issue, not a footnote.
- `MAX_STEPS` is an economic bound, not just a DoS bound.

---

## 2. Measured Monad cost constants

Measured in Phase 0 by `eth_estimateGas` against Monad mainnet with state overrides,
compared against a local `anvil --hardfork cancun` (RESEARCH.md §3).

| Operation | Monad | Upstream (Ethereum schedule) | Ratio |
|---|---|---|---|
| Marginal cold `SLOAD` | **~8,300** | ~2,165 | **3.85×** |
| Repeated **warm** `balanceOf` on same ERC-20 | **2,170** | ~2,170 | 1.0× |
| **First-touch** (cold) `balanceOf` on a new ERC-20 | **~20,400 – 43,600** (avg ≈30,000) | ~7,000 | ~4× |

The warm case is *not* repriced. This matters: it means the shape of a curve driven by
repeated warm reads is toolchain-independent, even though its absolute height is not.

---

## 3. The measured curve — `FortStrategyExecutor.executeStrategy`

From `test/gas/FortStrategyExecutor.gas.t.sol`, worst case by construction: **every
step outputs a distinct token**, maximising the `prevOutSnaps` scan.

### 3.1 ⚠️ Installing Monad Foundry is NOT sufficient — the schedule must be selected

Monad Foundry (`forge 1.7.1-monad-v1.0.0`) still prices the **local** test EVM on
Ethereum's schedule unless the Monad network family is selected. Measured directly by
`test/gas/ColdSloadPricing.t.sol`:

| Configuration | marginal cold `SLOAD` | schedule |
|---|---:|---|
| Monad Foundry, no network selected | **2,162** | Ethereum (2,100) |
| Monad Foundry, `--network monad` | **8,162** | **Monad (8,100)** |
| Live Monad RPC (Phase 0, `eth_estimateGas`) | ~8,300 | Monad |

The `--network monad` figure matches the live-RPC measurement, so the local EVM is
faithful **once selected**. This is now pinned in `foundry.toml` as `network = "monad"`,
so no flag is needed. CI additionally asserts the schedule is live before trusting any
envelope — upstream Foundry silently *ignores* the unknown `network` key, so a
mis-provisioned runner would otherwise report Ethereum prices as if they were Monad's.

### 3.2 The curve, under true Monad pricing

Historical Base-priced (Ethereum-schedule) figures are kept alongside because the
`MAX_STEPS = 30` derivation was originally computed from them, and because the ratio is
itself informative.

| n steps | **Monad** gas | Ethereum-schedule gas | Monad / Ethereum |
|---:|---:|---:|---:|
| 1 | 354,374 | 234,948 | 1.51× |
| 2 | 344,730 | 308,282 | 1.12× |
| 4 | 634,476 | 567,585 | 1.12× |
| 8 | 1,234,098 | 1,106,775 | 1.12× |
| **10** (`MAX_STEPS`) | **1,892,775** | 1,495,103 | **1.27×** |

Marginal per step under Monad: **144,873** (n=4) → **149,905** (n=8), versus 129,651 →
134,797 on the Ethereum schedule. The superlinear term survives the reprice and widens:
the guarded marginal comparison reports **95,744** (lower half) → **148,002** (upper
half), a steeper climb than the Ethereum-schedule 113,276 → 136,083.

> **Measurement artefact, worth knowing.** Under Monad pricing gas(2) lands *below*
> gas(1) — 344,730 vs 354,374. The first measurement pays one-time cold-state warmup for
> the USDC balance/allowance slots that later measurements inherit warm, and at ~4× cold
> pricing that one-off exceeds the cost of a whole extra step. The harness reports a
> marginal of 0 there rather than underflowing. Only warm-state marginals are meaningful.

The 1..30 curve below was captured on the Ethereum schedule before `MAX_STEPS` was
reduced to 10, and cannot be reproduced at runtime now. It is retained because it is the
evidence identifying the O(n²) term:

| n | 1 | 2 | 4 | 8 | 12 | 16 | 20 | 25 | 30 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gas | 234,948 | 308,282 | 567,585 | 1,106,775 | 1,648,610 | 2,214,460 | 2,804,516 | 3,587,320 | 4,397,816 |
| marginal | — | 73,334 | 129,651 | 134,797 | 135,458 | 141,462 | 147,514 | 156,560 | 162,099 |

**Marginal cost per step rises with n** — 134,797 at n=8 to 162,099 at n=30. That rise,
≈ **+2,333 gas per step per step**, sits almost exactly on the measured warm `balanceOf`
cost of **2,170**. This is the O(n²) `prevOutSnaps` scan, identified empirically rather
than by inspection.

Asserted continuously by `test_perStepCost_growsWithStepCount`, comparing marginals
(steps 9–16: 139,290 → steps 17–24: 175,900) rather than averages, since averages are
swamped at low n by fixed per-call overhead.

---

## 4. An optimisation that was measured and rejected

Attempted: skip snapshotting entries that the two dedicated branches already resolve
(`tokenOut == inputToken`, `tokenOut == steps[i].tokenIn`), and skip duplicate tokens
since the resolution loop `break`s on first match.

**Result: 12.6% WORSE.** n=30 went 4,397,816 → 4,953,653.

Cause: detecting duplicates needs a nested scan over `tokenOuts[0..j]`, which is O(i²)
per step — O(n³) overall. On the all-distinct worst case it finds nothing and the
comparisons are pure overhead. The dedicated-branch skip saves only ~1 read per step.

Reverted, with the finding recorded inline in `FortStrategyExecutor.sol` so it is not
reintroduced. **Measurement rejected a change that reads as an obvious win.**

---

## 5. Why the O(n²) cannot be removed without an interface change

The delta check needs `tokenOut`'s balance from **before** the adapter call. `tokenOut`
is only known **after** `IStrategyAdapter.execute` returns. So every candidate must be
snapshotted up front, and the candidate set is every prior step's output.

The fix is for `Step` to declare its expected `tokenOut`, letting the executor snapshot
exactly one balance per step — O(1), turning the whole loop linear. That is an **ABI
change** affecting the SDK and frontend, so it is an operator decision, not one to make
inside a port phase.

What must **not** happen: replacing the delta check with an absolute-balance check. It
is cheaper and it is wrong — it breaks when `tokenOut == tokenIn` or when a token
repeats across steps, and it was an explicit finding in the Base audit.

---

## 6. Derivation of `MAX_STEPS`

The executor's own bookkeeping is not what binds. **Real adapter internals dominate.**

Calibration from a live quote (Phase 0): `li.quest` returned `gasLimit = 2,161,475`
for a **single** USDC→WMON swap on chain 143.

Worst-case total for an n-step strategy of real swaps:

```
total(n) ≈ executor_overhead(n) + n × adapter_cost
         ≈ (measured curve above)  + n × 2,160,000
```

Executor overhead below is now the **measured Monad** figure, not the Ethereum-schedule
estimate the original derivation used.

| n | executor overhead (Monad) | + real swaps @2.16M | total |
|---:|---:|---:|---:|
| 8 | 1,234,098 | 17,280,000 | **18.5M** |
| **10** (`MAX_STEPS`) | **1,892,775** | 21,600,000 | **23.5M** |
| 12 | ~2,150,000 (est.) | 25,920,000 | **28.1M** |
| 13 | ~2,300,000 (est.) | 28,080,000 | **30.4M — over a 30M cap** |
| 30 | ~5,600,000 (est.) | 64,800,000 | **70.4M** |

**The `MAX_STEPS = 10` choice survives re-measurement under true Monad pricing:** 23.5M
against a 30M cap is ~22% headroom, essentially unchanged from the 23.0M the
Ethereum-schedule estimate predicted. n=13 now crosses the cap outright (30.4M) where the
earlier estimate had it just under (29.9M), which makes 10 the more clearly correct call
rather than a marginal one.

Against the ceiling:

- **If the documented 30M per-transaction cap is real** (RESEARCH.md §8.2 — the Monad
  gas docs state it; the RPC accepts up to the 150M block limit and shows no 30M cap,
  and this is **UNRESOLVED**), then n=13 hits the cap exactly and **n=30 is a factor of
  2.3 over it**. The current `MAX_STEPS = 30` would let a caller build a transaction
  that cannot be included.
- **If only the 150M block limit applies**, n=30 fits on raw capacity — but at ~69M gas
  the user pays **6.9 MON up front** under gas-limit charging. Permitted, but not
  something to ship as a default bound.

**Decision: `MAX_STEPS = 10.`**

Rationale: safe under **both** readings of the ceiling. It leaves ~23% headroom under a
30M cap, keeps the worst-case user cost near 2.3 MON rather than 6.9, and sits in the
range Phase 0 predicted analytically (~10). Realistic strategies are 2–5 steps; this is
a safety bound, not a target.

Revisit if the 30M cap is disproven by a testnet broadcast — 12–13 becomes defensible
on capacity, though the gas-limit-charging cost argument still favours a lower bound.

### Other array caps

`DepositEntry[]`, `WithdrawEntry[]` and `sweepTokens[]` are **not** yet capped by
measurement. Monad's linear memory pricing (`w/2`, 8 MB cap) makes the arrays
themselves nearly free, so the binding cost is the per-entry external call, not the
array. Deriving those caps requires the same treatment applied to `FortVault` and is
outstanding — see §8.

---

## 7. Invariant I13 — bounded, measured gas

Asserted in `test/gas/FortStrategyExecutor.gas.t.sol`:

| Test | Property |
|---|---|
| `test_gasCurve_byStepCount` | emits the full curve; the record this derivation rests on |
| `test_perStepCost_growsWithStepCount` | detects the superlinear term; fails if a change makes it worse |
| `test_I13_worstCaseStrategy_withinPerTxGasCap` | worst case must keep ≥50% headroom under the 30M per-tx cap |
| `test_I13_sweepTokens_boundedCost` | cost must not explode with sweep-token count |

CI runs these only under Monad Foundry (`.github/workflows/ci.yml`, `gas-snapshot`
job). Upstream numbers are not accepted as evidence.

### 7.1 `LiFiAdapter` envelopes (Phase 4)

Asserted in `test/gas/LiFiAdapter.gas.t.sol`, same conditions (`network = "monad"`,
cold state, mock diamond). Measured:

| Entry point | Variant | Measured | Envelope |
|---|---|---|---|
| `depositFor` | single ERC20→ERC20 | 399,649 | 452,000 |
| `depositFor` | multiple (2 legs) ERC20→ERC20 | 426,110 | 482,000 |
| `depositFor` | single ERC20→native | 394,560 | 446,000 |
| `redeemFor` | single ERC20→ERC20 | 391,616 | 443,000 |
| `swap` | single ERC20→ERC20 | 384,142 | 434,000 |

**Marginal cost of one extra route leg: 18,461 gas**, measured cold-vs-cold across two
freshly deployed adapters (`test_gas_perLegSlope`). It is close to two cold SLOADs at
Monad's ~8,100 — the `callTo` and `approveTo` allowlist reads — plus the selector
lookup and the memory the extra `SwapData` occupies. A route is caller-supplied and
uncapped in leg count, so anyone sizing a limit for an n-hop route should budget
`single + 18.5k × (n − 1)` and then add whatever the real DEX legs cost.

These numbers cover only the part FORTRESS owns: validation, allowlist reads, approval
churn, the balance-delta snapshots, the payout. The mock simulates each leg instead of
executing `callData`, so a production swap costs this **plus** the live DEX legs. The
envelopes exist to catch regressions in FORTRESS's own overhead, not to predict a
mainnet swap's total.

Note how much of the cost is cold state: re-running `depositFor` warm on the same
adapter measures ~124k against ~400k cold. On a chain that prices cold SLOAD at ~8,100
that gap is the dominant term, which is why every number above is taken cold.

---

## 8. Outstanding

1. ~~Re-measure everything under Monad Foundry.~~ **DONE** (§3.1/§3.2). Absolute heights
   rose 12–27%; `MAX_STEPS = 10` survived re-derivation unchanged.
2. **Resolve the 30M per-transaction cap** by broadcasting a high-gas-limit transaction
   on testnet 10143. Needs a funded throwaway key. This is the single input the
   `MAX_STEPS` choice is most sensitive to.
3. **Derive caps for `DepositEntry[]` / `WithdrawEntry[]` / `sweepTokens[]`** against
   `FortVault` and `FortSwapRouter` with the same method.
4. **Decide on the `Step.expectedTokenOut` ABI change** (§5), which would make the
   executor linear and materially raise the defensible `MAX_STEPS`.
