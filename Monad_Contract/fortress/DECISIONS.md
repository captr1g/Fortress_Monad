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

---

## Phase 4

### D4-1 — `LiFiAdapter` supports all six GenericSwapFacetV3 variants
**Status:** accepted (operator decision, closes `RESEARCH.md` open question §13.4)
**Context:** §13.4 asked whether to support only the two USDC-centric ERC20↔ERC20
variants or all six including native-MON legs.
**Evidence:** `SHMONAD.asset()` returns the native-MON sentinel `0xEeee…`, not an
ERC-20. The shMonad adapter (Phase 4 task 13) therefore needs a USDC→MON entry leg and
a MON→USDC exit leg. The ERC20↔native variants are a hard dependency of remaining
Phase 4 work, not a nice-to-have.
**Decision:** all six. Dispatch is chosen by an explicit `LibLiFi.SwapKind` in the
payload, never inferred from the tokens, and the adapter rejects any request whose
declared tokens disagree with the variant's native/ERC20 shape (`KindMismatch`). The
adapter becomes `payable` with a `receive()` restricted to the diamond, and gains
native-balance delta measurement, a MON residual sweep and `rescueNative`.

### D4-2 — `approveTo` is allowlisted, not compared to the diamond
**Status:** accepted (bug fix, found during the D0-5 rewrite)
**Evidence:** the Base code required `swapData[i].approveTo == lifiDiamond`
(`LiFiAdapter.sol:101`, `FortSwapRouter.sol:142`). In LI.FI, `approveTo` is the spender
the diamond approves for a leg — the DEX, or a DEX's separate token-transfer proxy —
never the diamond itself. The rule rejected every live `li.quest` quote. It survived CI
only because `MockLiFiDiamond` doubled as both the diamond and the DEX, so the two
addresses were the same value in every test.
**Decision:** `callTo` and `approveTo` are each checked against `isApprovedDex`. One
list, checked twice by role, so an operator can allow a token-transfer proxy as a
spender without also making it callable. Tests now use a `dex` address distinct from
the diamond, and assert that naming the diamond as `approveTo` **reverts** — the exact
shape the old rule demanded.

### D4-3 — LI.FI leg selectors are allowlisted and ship empty
**Status:** accepted (I5 compliance)
**Evidence:** I5 requires any call into a user-supplied external target to be validated
by target address **and** function selector; an address allowlist alone was an audit
finding. `SwapStrategyAdapter`, `MorphoLeverageExecutor` and `MorphoExitExecutor`
already carry `isApprovedSwapSelector`. `LiFiAdapter` and `FortSwapRouter` did not, so
an allowlisted router could be entered through any function it exposes.
**Decision:** both gain `isApprovedSwapSelector` + `setApprovedSwapSelector`, checked
per leg. The map ships **empty**, so every swap reverts `UnauthorizedSelector` until an
operator populates it. `DeployMonad.s.sol` logs this as ACTION REQUIRED rather than
guessing values.
**Why not populate it now:** the selectors belong to the venues LI.FI routes *through*
(KyberSwap, OpenOcean, Eisen, Monorail, Kuru), not to the diamond. Each must be read
off a live chain-143 quote and verified. Writing plausible-looking values into a
deployment script is the failure the BaseSwap address collision already punished once.

### D4-4 — `MonadAddresses.NATIVE` is the 0xEeee… sentinel, not `address(0)`
**Status:** accepted
**Context:** the adapter needs a marker for "native MON" in its own API.
**Decision:** reuse the `0xEeee…` convention `SHMONAD.asset()` already returns, so the
shMonad adapter and the LI.FI legs speak one dialect, and `address(0)` keeps reverting
as a zero-address bug instead of silently meaning "native". It lives in
`MonadAddresses` only because CI forbids 40-hex literals elsewhere.
**Scope:** this is FORTRESS's marker. `LibSwap.SwapData` contents are passed to the
diamond byte-for-byte and never rewritten, so whatever sentinel LI.FI uses internally
is irrelevant to this codebase — and is deliberately not assumed anywhere.

### D4-5 — D0-5's evidence is pinned by a fork test, not by prose
**Status:** accepted
**Evidence:** `test/fork/FortVault.lifi.fork.t.sol` queries the live diamond's EIP-2535
loupe at the pinned block. `facetAddress(0x4630a0d8)` → `address(0)`: `swapTokensGeneric`
is not registered. All six V3 selectors → `LIFI_GENERIC_SWAP_FACET_V3`.
**Decision:** the central claim of D0-5 is a fact about a deployed selector table, so it
is asserted against that table. If LI.FI re-adds the v1 facet or moves the V3 one, CI
fails loudly instead of the adapter failing quietly in production.

### D4-6 — Aave V3 and Neverland integrated, under explicit instruction
**Status:** accepted (operator instruction, Phase 4 task 12)
**Context:** the port deliberately shipped with no Aave integration. Port prompt §3.4
requires an explicit instruction before integrating a protocol that merely exists on the
chain, and `RESEARCH.md` §10.3 listed `aave_v3` and `neverland` as "context only — NOT
permission to integrate". The operator gave that instruction.
**Decision:** one `AaveV3Adapter` (`IFortProtocol`, vault-side) serves both markets,
registered under the registry keys `"Aave"` and `"Neverland"` with `isERC4626 = false`.
**It does not fill a reserved adapter slot.** `PENDING.md` ids 3/4/5 stay empty and the
prohibition on substituting Aave for Compound V3 / Aerodrome / YO still stands — this
adapter takes no `adapterId` at all.
**Why it matters:** Aave V3 Monad is the largest USABLE USDC venue on the chain —
~$141.7M supplied against a 250M cap, leaving **109.9M of live capacity** measured on
fork, against Euler's ~6.6M and a Morpho V2 tier that is entirely at cap. Supply APR
3.07%.
**Neverland caveat:** same codebase, ~87.4M of headroom, but a **4000 bps reserve
factor** against Aave's 1000 — 40% of interest goes to its treasury, and the supply APR
is 1.91%. Registered so the operator can choose it, not because it is better.

### D4-7 — Two implementation deployments, not one shared implementation
**Status:** accepted
**Evidence:** `pool` and `aToken` are `immutable`, so they live in bytecode rather than
storage. The alternative — one implementation with the pool in storage, two proxies —
adds a cold SLOAD to every deposit and withdraw, and Monad prices a cold SLOAD at ~8,100
gas (D0-3).
**Decision:** deploy the implementation twice, once per market. The constructor proves
its own wiring on chain — it reads the aToken's `POOL()` and `UNDERLYING_ASSET_ADDRESS()`
and reverts `WiringMismatch` if the triple disagrees — so crossing the two markets is not
a deployable state. Asserted on fork in `test_fork_crossedWiring_reverts`.

### D4-8 — Read reserve state from the Pool's config bitmap, not the data provider
**Status:** accepted
**Evidence:** the two markets are **different Aave revisions**. Verified live:
`Aave V3 Monad` reports `POOL_REVISION() == 11`, `Neverland Market V3` reports `2`. The
`getReserveData` struct moved across that gap — v3.2 removed stable-rate borrowing, and
the markets disagree accordingly (Aave returns `address(0)` for the stable debt token,
Neverland returns a real one). Decoding it against one struct definition would silently
misread one of the two markets.
**Decision:** `IAaveV3Pool` declares only `supply`, `withdraw`, `getConfiguration` and
`getReserveNormalizedIncome` — the functions verified identical on both. Reserve state is
decoded from the configuration bitmap by `LibAaveReserve`. The claim that the bit layout
matches on both revisions is **asserted per market** in
`test_fork_configBitmapMatchesDataProvider`, which decodes the bitmap and compares every
field against that market's own data provider.
**Also:** the data provider is recorded for provenance but never called from `src/` — in
Aave V3 it is a plain contract that is REPLACED on upgrade, unlike the Pool and aToken
proxies.

### D4-9 — The scaled-balance rounding tolerance must scale with the liquidity index
**Status:** accepted (bug caught by fuzzing, before it shipped)
**Evidence:** Aave stores `amount.rayDiv(index)` and reports `scaled.rayMul(index)`. Both
round half-up, so a round trip lands within `0.5 × index/RAY + 0.5` units of `amount` —
an error that **grows with the index**, not a fixed 1 unit. The first implementation used
a hard-coded 1-unit tolerance. It passes at today's indices (Aave Monad 1.004 ray,
Neverland 1.023) and would begin reverting good deposits once an index passed ~2 ray.
`testFuzz_depositFor_anyIndex` found it at a 10-ray index: a 999,999-USDC supply came back
3 units light and reverted `SupplyCreditShortfall`.
**Decision:** derive the tolerance per call as
`getReserveNormalizedIncome(asset) / RAY + 1`, which covers both halves of the bound.
Applied to the supply credit check and the withdraw shortfall check alike.
**Note:** this is a liveness check on the credit — it catches a pool that takes the
underlying without crediting the position — not an accounting reconciliation.

### D4-10 — The supply-cap guard is approximate at the boundary, deliberately
**Status:** accepted, with the limitation recorded rather than hidden
**Evidence:** Aave compares
`scaledTotalSupply.rayMul(nextLiquidityIndex) + accruedToTreasury + amount` against the
cap. The adapter reads `aToken.totalSupply()`, which is the same product at the CURRENT
index and excludes `accruedToTreasury`, so it can report slightly MORE headroom than Aave
will allow.
**Decision:** accept the gap. Reproducing Aave's arithmetic exactly needs the
`ReserveData` struct that D4-8 rules out. The guard converts the overwhelmingly common cap
failure into an attributable `ProtocolAtCapacity`, and within a rounding-scale band of the
cap Aave's own check still backstops it. On the live reserves the gap is immaterial: Aave's
Monad USDC market carried ~38k of accrued treasury against ~109.9M of headroom.

### D4-11 — `ShMonadAdapter` reuses `LiFiAdapter` for its MON leg
**Status:** accepted (Phase 4 task 13)
**Context:** shMONAD is ERC-4626 shaped but its `asset()` is the native-MON sentinel and
its `deposit` is **payable**. `FortVault`'s `isERC4626` fast path does
`IERC20(asset).transferFrom`, which cannot work against a sentinel, so the venue needs an
adapter with a USDC↔MON swap leg on both sides.
**Decision:** the swap leg calls `LiFiAdapter.swap` rather than talking to the LI.FI
diamond directly. Everything I5 and I8 require — the DEX address allowlist, the per-leg
selector allowlist, the route end-asset checks, the balance-delta verification, the
deadline — already lives in `LiFiAdapter` and is enforced on the nested call. A second
copy would be a second allowlist to keep in step, and it would drift.
**Consequence, stated plainly:** shMONAD deposits stay closed until the `LiFiAdapter`
selector allowlist is populated (D4-3). One gate, not two.
**Dependency closed:** this is the caller D4-1 was written for. The `ERC20→native` and
`native→ERC20` GenericSwapFacetV3 variants exist because shMONAD needs them.

### D4-12 — shMONAD's exit haircut is real; quote `previewRedeem`, never `convertToAssets`
**Status:** accepted (measured, not assumed)
**Evidence:** probed end to end on fork at the pinned block. `deposit(uint256,address)` is
payable and reverts `0x309a6b54` without value. `redeem` settles in the SAME transaction —
there is no unbonding queue. But the exit is not free:

    convertToAssets(shares)   9.999245 MON      (raw exchange rate)
    previewRedeem(shares)     9.934694 MON      (what actually arrives)
    realised                  9.934694 MON      (exact match)

That is a **64 bps discount on the way out**, and a 0.653% round-trip loss on 10 MON.
Confirmed again through the full adapter path: 100 stand-in USDC → 62.303540 shMON →
99.346937 back.
**Decision:** the adapter exposes `previewRedeemMon`, and both the interface and the deploy
script tell callers to size `minMonOut` off it. Sizing off `convertToAssets` ignores the
haircut and reverts — asserted as an executable test, on mocks and on fork, rather than
left as a comment.
**Slippage is per leg, not end to end:** a single end-to-end minimum would let a bad swap
hide behind a good exchange rate, or the reverse. The MON leg and the token leg each carry
their own caller-supplied floor.

### D4-13 — The adapter is not a wallet: native MON is accepted from two addresses only
**Status:** accepted
**Context:** `ShMonadAdapter` handles three assets (USDC, native MON, shMON) across two
legs, so it must be able to receive MON mid-transaction.
**Decision:** `receive()` accepts only from shMONAD (redemption proceeds) and from the
swap adapter (an `ERC20→native` leg, or an unspent-input refund). Anything else reverts
`UnexpectedNative`. Unattributed MON would be indistinguishable from a leg's proceeds and
could be swept into the next caller's position. Every path ends in `_sweepAll`, returning
leftover USDC, MON and shMON to whoever supplied them (I1).
