# DECISIONS.md — Architecture Decision Log

Every divergence from the Base deployment, with rationale. Appended each phase.

---

## Phase 0

### D0-1 — Port in-place in `Monad_Contract/Fortress`, not a separate repo
**Status:** accepted (operator directive, overrides prompt §4)
**Context:** Prompt §4 requires a clean `fortress-monad/` tree, keeping the Base repo
untouched as reference. Operator instructed: *"do all the fixing in the fortress. Do not
create any other folder."*
**Decision:** work in-place.
**Consequence:** the 539-test Base baseline is consumed by the port rather than preserved
as an independent oracle; dropped-adapter tests must be deleted rather than not-copied;
git history interleaves Base and Monad states. Mitigation (a baseline tag before Phase 1)
proposed in `RESEARCH.md` §12 and awaiting approval.

### D0-2 — Pin `evm_version = "cancun"`
**Status:** proposed (Phase 1)
**Context:** `foundry.toml` pins neither `evm_version` nor a solc version; `src/` mixes
`pragma ^0.8.20` and `^0.8.26`. Prompt §2 flags unpinned `evm_version` as silently
changing emitted opcodes.
**Evidence:** `PUSH0`, `MCOPY`, `TSTORE`/`TLOAD` all confirmed present on Monad mainnet
and testnet (`RESEARCH.md` §2).
**Decision:** pin `evm_version = "cancun"` and a fixed solc version in Phase 1.

### D0-3 — All gas assertions must run under Monad Foundry
**Status:** accepted in principle; **installation pending operator approval**
**Evidence:** measured marginal cold `SLOAD` — Monad ~8,300 vs upstream Foundry ~2,165
(**3.85×**); at n=20 upstream under-reports total gas by 65% (`RESEARCH.md` §3).
**Decision:** Phase 3 `test/gas/`, I13 envelopes and CI `forge snapshot --diff` run under
Monad Foundry. Upstream numbers are rejected as evidence.
**Why not done yet:** `foundryup --network monad` replaces the global `forge`/`cast`
binaries that the existing Base suite depends on. Not run unilaterally.

### D0-4 — `via_ir = true` to be re-justified, not inherited
**Status:** proposed (Phase 1)
**Context:** `foundry.toml` sets `via_ir = true`. Prompt §2 suggests such settings were
often forced by Base's 24 KB code limit, which Monad raises to 128 KB.
**Evidence:** `FortStrategyExecutor` deploys at **14,497 bytes** — under even Base's
limit. So `via_ir` was **not** forced by contract size.
**Decision:** keep or drop `via_ir` on compile-time/optimization merits in Phase 1; do not
justify it by the size limit.

### D0-5 — `LiFiAdapter` requires a rewrite, not a re-point
**Status:** accepted; scope moves Phase 2 → Phase 4
**Evidence:** `swapTokensGeneric` (`0x4630a0d8`), the only function `src/interfaces/ILiFi.sol`
declares, is **not registered** on the Monad LI.FI diamond. Monad ships GenericSwapFacetV3
(6 functions). A live `li.quest` quote on chain 143 returns selector `0x5fd9ae2e`
(`swapTokensMultipleV3ERC20ToERC20`). See `RESEARCH.md` §7.
**Decision:** `ILiFi.sol` and `LiFiAdapter.sol` get new signatures and new dispatch logic;
their unit/fuzz tests are rewritten, not re-pointed. Variant scope is open question §13.4.

### D0-6 — `MAX_STEPS` reduced pending an O(n) rewrite of the snapshot loop
**Status:** proposed (Phase 3 measures and finalises)
**Evidence:** `FortStrategyExecutor.sol:138-144` runs a `balanceOf` scan over prior
`tokenOuts` *inside* the per-step loop ⇒ `n(n-1)/2` extra external reads. At the measured
Monad warm cost of 2,170 gas each, that is **943,950 gas at `MAX_STEPS = 30` — 78% of the
executor's bookkeeping gas** (`RESEARCH.md` §8).
**Decision (predicted):** `MAX_STEPS ≈ 10` if the loop stays quadratic; `≈ 20–25` if
rewritten to O(n) via a `mapping(address => uint256)` token→snapshot.
**Constraint:** the delta-based check must be preserved exactly. It must **not** be traded
for a cheaper absolute-balance check — that was an explicit audit finding (prompt §1.3).

### D0-7 — Exclude near-expiry and test markets from initial allowlists
**Status:** proposed, needs operator policy (open question §13.3)
**Evidence:** Pendle market `0x1519fb0d…` (USDat) expires **2026-08-27**, 11 days after
this session, yet the corresponding `PT-USDat-27AUG2026` Morpho market holds the
2nd-largest supply on chain 143 ($10.7M). The Morpho registry also contains obvious test
markets (`TEST/stTEST`, `testWETH/testwstETH`) and `UNKNOWN`-asset markets at zero liquidity.
**Decision:** initial allowlists exclude near-expiry markets, test markets, and markets
with unusable liquidity (e.g. `USDC/cbBTC`: 100% utilisation, $2 liquidity).

### D0-8 — Three adapter slots stay empty
**Status:** accepted (prompt §3.3, independently re-verified)
**Evidence:** the canonical `monad-crypto/protocols/mainnet` registry (175 protocol files)
contains no Compound, no Aerodrome/Velodrome, and no YO Protocol entry (`RESEARCH.md` §10.2).
**Decision:** `CompoundV3Adapter`, `AerodromeAdapter`, `YoAdapter` are not ported, not
deployed, not registered. No substitute selected or proposed. Reserved `adapterId`s to be
documented in `src/adapters/PENDING.md` in Phase 1.

### D0-9 — Do not use `.env` `PRIVATE_KEY`
**Status:** accepted
**Context:** `Monad_Contract/Fortress/.env` contains `PRIVATE_KEY` — the Base deployer.
**Decision:** never used for Monad probes or deploys. Prompt rule 7 forbids touching a
mainnet key, and reusing a production deployer on a new chain is poor hygiene regardless.
A separate funded testnet-only key is requested (open question §13.2).
