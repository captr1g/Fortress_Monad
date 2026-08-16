# FORTRESS on Monad — submission summary

**Chain:** Monad mainnet, chain ID 143. **Pinned fork block:** 96,431,000.
**Toolchain:** Monad Foundry, solc 0.8.26 pinned, `evm_version = "cancun"`,
`network = "monad"`.

State at submission: **Phases 0–4 complete** (Phase 4 task 14 skipped by operator
instruction). **Phase 6 skipped** by operator instruction. **Phases 7–9 partially
delivered** — written and tested, but not exercised against a live deployment (§10).
**Phase 5 partially delivered**, **Phase 10 not started**.
See [What is NOT done](#6-what-is-not-done-and-what-blocks-it).

The plan this port follows is `FORTRESS_MONAD_PORT_PROMPT.md` at the repository root,
which defines **Phases 0–10**.

```
632 tests pass, 0 fail          (unit + fuzz + invariant + gas)
 26 fork tests pass             against live Monad at the pinned block
     forge fmt --check          clean
     address-literal CI gate    green
```

---

## 1. What this port is, and what it is not

This is **not** a re-point of the Base deployment with the addresses swapped. Every
third-party address was re-verified on chain before use, and that decision paid for
itself immediately:

> The Base BaseSwap router address `0x20F6ee51…` **has 8,679 bytes of code on Monad,
> and it is not BaseSwap.** `name()`, `symbol()`, `factory()` and `WETH()` all revert;
> only `owner()` responds. Carrying the Base DEX allowlist over unchanged would have
> allowlisted an unknown contract as a swap target.

That collision is recorded permanently in `src/config/MonadAddresses.sol` so it cannot
be reintroduced.

**Every 40-hex address literal lives in exactly one file** — `MonadAddresses.sol` —
and CI fails the build if one appears anywhere else in `src/` or `script/`
(`script/ci/check-address-literals.sh`). The gate scans comments too; it caught two
literals in doc comments during Phase 4.

---

## 2. Phase-by-phase

| Phase | Scope | State |
|---|---|---|
| 0 | Research, on-chain verification of every address and EVM feature | ✅ |
| 1 | Repo bootstrap, pinned toolchain, CI gates | ✅ |
| 2 | De-Base the codebase | ✅ |
| 3 | Measured gas envelopes, `MAX_STEPS` re-derived 30 → 10 | ✅ |
| 4 | Adapters — LI.FI rewrite, Aave V3 + Neverland, shMONAD | ✅ |
| 5 | Leverage + exit executors (Morpho flash loans) | 🟡 ported + guarded; **no live fork test** — see §7 |
| 6 | `CrossChainRouter` | ⏭️ **skipped by operator** |
| 7 | Upgrade timelock + full test matrix | 🟡 scripted + tested, not exercised live |
| 8 | Security audit | 🟡 access-control sweep executable; Slither not run |
| 9 | Deployment, configuration, operations | 🟡 verification script written; broadcast blocked — see §6 |
| 10 | Documentation and handoff | ❌ not started |

Full rationale for every divergence from Base is in `DECISIONS.md` (D0-1 … D4-13).

---

## 3. The three findings that mattered most

### 3.1 The toolchain was lying about gas (D0-3, Phase 3)

Monad charges on `gas_limit`, not `gas_used`, so gas is a correctness concern here, not
an optimisation. Upstream Foundry prices a cold SLOAD at **2,162**; Monad prices it at
**8,162** — a 3.85× under-report on the operation FORTRESS does most.

Installing Monad Foundry was **not sufficient**. Without `network = "monad"` in
`foundry.toml`, `forge test` silently keeps the Ethereum schedule. This is asserted in
CI by `test/gas/ColdSloadPricing.t.sol`, which fails the build if the marginal cold
SLOAD reads below 7,000.

Consequence: `MAX_STEPS` was re-derived from measured numbers and cut **30 → 10**.

### 3.2 The LI.FI adapter was dead on arrival (D0-5, Phase 4 task 11)

`swapTokensGeneric` (`0x4630a0d8`) — the only function the Base `ILiFi.sol` declared —
**is not registered on the Monad LI.FI diamond**. Every swap path in the protocol
reverted. Monad ships GenericSwapFacetV3 instead.

Asserted, not argued: `test/fork/FortVault.lifi.fork.t.sol` queries the live diamond's
EIP-2535 loupe. `facetAddress(0x4630a0d8)` → `address(0)`; all six V3 selectors →
`LIFI_GENERIC_SWAP_FACET_V3`.

The rewrite also fixed three defects the selector change exposed:

- **`approveTo` was checked against the wrong address.** The rule required
  `approveTo == lifiDiamond`, but in LI.FI `approveTo` is the spender the diamond
  approves — the DEX, or a DEX's transfer proxy — never the diamond. It rejected every
  live quote, and survived CI only because the mock doubled as both.
- **No selector allowlist** on `SwapData.callData` (I5 violation).
- **`depositFor` had no delta verification** — it trusted the diamond's own minimum.

### 3.3 Aave V3 is the largest usable USDC venue on Monad (D4-6, Phase 4 task 12)

Measured on fork, not read off a dashboard:

| Venue | Open USDC capacity | Supply APR |
|---|---|---|
| **Aave V3 Monad** | **109.9M** | 3.07% |
| Neverland | 87.4M | 1.91% (4000 bps reserve factor) |
| Euler eVaults | ~6.6M / ~36M | — |
| Morpho V2 tier | **0 — entirely at cap** | 8.6% |

A Phase 0 error was also corrected here: raw `totalAssets()` integers had been read as
USD magnitudes. The MetaMorpho V1.1 vaults named as "live targets" are dust —
`hyperUSDCa` is **$23.26**, not $23M.

---

## 4. What was built in Phase 4

| Contract | Venue | Interface | Runtime size |
|---|---|---|---|
| `LiFiAdapter` | LI.FI GenericSwapFacetV3, all six variants | `IFortProtocolEx` | 8,774 B |
| `AaveV3Adapter` | Aave V3 Monad **and** Neverland | `IFortProtocol` | 6,908 B |
| `ShMonadAdapter` | FastLane shMONAD | `IFortProtocolEx` | 7,788 B |

All far under Monad's 128 KB code-size cap.

### Non-obvious properties, each measured

- **Two Aave revisions.** `Aave V3 Monad` is `POOL_REVISION 11`; Neverland is `2`. The
  `getReserveData` struct moved across that gap, so the adapter reads reserve state from
  the Pool's configuration bitmap instead — and `test_fork_configBitmapMatchesDataProvider`
  asserts, per market, that every bit it reads agrees with that market's own data provider.
- **A fuzz test caught a live bug before it shipped.** The scaled-balance rounding
  tolerance cannot be a fixed 1 unit: Aave's `rayDiv`/`rayMul` round trip errs by
  `0.5 × index/RAY + 0.5`, which **grows with the index**. It is now derived per call.
  Harmless at today's indices; would have started refusing good deposits past ~2 ray.
- **shMONAD charges a 64 bps exit haircut.** `previewRedeem` sat 0.645% below
  `convertToAssets` and matched the realised payout to the wei. Sizing a minimum off
  `convertToAssets` reverts — asserted as an executable test on mocks *and* fork.

---

## 5. Deliberately closed: the LI.FI selector allowlist

`LiFiAdapter` and `FortSwapRouter` validate each swap leg by **target address AND
function selector** (invariant I5 — address alone was an audit finding). The selector
map **ships empty and fails closed**, so every swap reverts `UnauthorizedSelector` until
an operator populates it.

This is not an oversight. Those selectors belong to the venues LI.FI routes *through*
(KyberSwap, OpenOcean, Eisen, Monorail, Kuru), not to the diamond, and each must be read
off a live chain-143 quote and verified. Writing plausible-looking values into a
deployment script is precisely the failure the BaseSwap collision already punished once.

`DeployMonad.s.sol` prints this as **ACTION REQUIRED**. It currently gates three
adapters: `LiFiAdapter`, `FortSwapRouter`, and `ShMonadAdapter` (whose MON leg routes
through `LiFiAdapter` by design, so there is one allowlist to maintain rather than two).

---

## 6. What is NOT done, and what blocks it

**Phase 6 was skipped by instruction. Phase 10 has not been started. Phases 5 and 7–9
are written and tested but never run against a live deployment** — see §7 and §10 for
exactly what that means.

Realistic remaining effort: **8–13 hours**, most of it Phase 5's live fork tests, a real
audit pass, and the Phase 10 handoff docs.

Two items have been open since Phase 0 and need the operator, not the implementer:

1. **A funded, throwaway testnet-only key.** `.env`'s `PRIVATE_KEY` is the **Base
   deployer** and was never used for any Monad probe or deploy (D0-9). Phase 9 cannot
   broadcast without a separate key.
2. **`MONAD_VERIFIER_URL` is recorded UNVERIFIED** (`RESEARCH.md` §11). Contract
   verification must be confirmed before a Phase 9 deploy.

Also outstanding, from `docs/gas-model.md` §8:

- The **30M per-transaction gas cap** is assumed, not proven. Confirming it needs a
  high-gas-limit broadcast on testnet 10143 — the single input `MAX_STEPS` is most
  sensitive to.
- Caps for `DepositEntry[]` / `WithdrawEntry[]` / `sweepTokens[]` have not been derived.

**Phase 10 (documentation and handoff) has not been started.** The plan asks for
`docs/monad-differences.md`, one doc per contract, a final `ADDRESSES.md`, and an
operator handoff covering the three empty adapter slots. `DECISIONS.md`, `ADDRESSES.md`,
`docs/gas-model.md` and `src/adapters/PENDING.md` already cover much of that ground, but
they were written as working records, not as the handoff the plan specifies.

Three adapter slots stay **empty on purpose**: Compound V3, Aerodrome and YO have no
counterparty on Monad (verified against the 175-file canonical registry). `adapterId`
3/4/5 are reserved and must not be filled with substitutes — see `src/adapters/PENDING.md`.
Aave was added under explicit operator instruction and did **not** consume a reserved slot.

---

## 7. Phase 5 — what is actually done, and what is not

The plan defines Phase 5 as **leverage and exit executors**: leveraged looping built on
Morpho flash loans — borrow, swap, re-supply — and the unwind. Its precondition was
satisfied in Phase 0, which confirmed both Morpho `flashLoan` and `TSTORE`/`TLOAD` on
Monad.

| Plan item | State |
|---|---|
| Port `MorphoLeverageExecutor` / `MorphoExitExecutor` unchanged in logic | ✅ in `src/`, with unit + fuzz tests |
| Callback guard: spoofed non-Morpho caller reverts | ✅ `testCallbackRejectsNonMorphoCaller` |
| Callback guard: mismatched transient commitment reverts | ✅ `testCallbackRejectsWhenNoActiveFlash` |
| Rebuild the swap leg's DEX target **and selector** allowlist from Monad venues | ❌ mechanism exists, never populated — the same gap as §5 |
| **Fork test: open and close a real leveraged position on a live Monad Morpho market** | ❌ `setUp()` reverts — still on Phase 2 Base fixtures |
| Assert I1 and I3 on **failure** paths, not just success paths | ❓ not verified |

The contracts and their callback guards are real and tested. What is missing is the part
that would prove they work against Monad: both executor fork suites fail at `setUp()`
because their fixtures are still Base addresses, the same category as the Euler / Fluid /
Morpho / PendleStrategyAdapter suites noted in §8.

**Estimated 2–4 hours**, dominated by rebuilding the fixtures against a live Monad Morpho
market. Do not treat the passing unit tests as evidence the leverage loop works on Monad —
they run entirely against `MockMorphoBlue`.

---

## 8. Reproducing the evidence

```bash
cd Monad_Contract/Fortress

# Correctness (no RPC needed)
forge test --no-match-path "test/fork/*"          # 632 pass

# Live-chain evidence
export MONAD_RPC_URL=https://rpc.monad.xyz
forge test --match-path "test/fork/*"             # LiFi 8, Aave 10, shMonad 8

# Gas envelopes — REQUIRES Monad Foundry
foundryup --network monad
forge test --match-path "test/gas/*" -vv

# Address-book integrity gate
./script/ci/check-address-literals.sh
```

Pre-existing fork suites for Euler / Fluid / Morpho / PendleStrategyAdapter still carry
Phase 2 Base fixtures and fail; they are excluded from CI and were not in Phase 4 scope.

## 9. Where to read further

| Document | Contents |
|---|---|
| `RESEARCH.md` | Phase 0 findings, EVM feature probes, adapter matrix, open questions |
| `DECISIONS.md` | Every divergence from Base with evidence — D0-1 … D4-13 |
| `ADDRESSES.md` | Address book with per-address verification evidence |
| `docs/gas-model.md` | Measured cost curve, `MAX_STEPS` derivation, per-adapter envelopes |
| `src/adapters/PENDING.md` | The three empty slots and the bar any replacement must clear |
| `../../FORTRESS_MONAD_PORT_PROMPT.md` | The master plan this port follows — Phases 0–10, invariants I1–I13, standing rules |


---

## 10. Phases 7–9, partially delivered

Added after the main body above, under an explicit "skip cross-chain, do the rest fast"
instruction. These are **written and tested but not exercised against a live
deployment**, because that needs the funded key from §6.

### Phase 7 — ownership handover

`script/TransferOwnership.s.sol` starts the transfer of every FORTRESS contract to the
timelock deployed by `DeployTimelock.s.sol` (48h delay, self-governed, admin
`address(0)`).

Every contract is `Ownable2Step`, and that is load-bearing rather than incidental: the
owner holds `_authorizeUpgrade` on every UUPS proxy — the right to replace the
implementation behind the vault and every adapter. A one-step transfer to a wrong
address would be an unrecoverable loss of the protocol; the pending-owner step makes a
typo a no-op. The script asserts `pendingOwner` after each call and states plainly that
the handover is **not complete** until the timelock executes `acceptOwnership()`.

`test_ownershipTransferIsTwoStep` proves the whole sequence on all three Phase 4
adapters, including that the old owner is powerless afterwards.

### Phase 8 — access-control sweep

Slither is not installed in this environment, so the security pass is expressed as
`test/unit/AccessControl.sweep.t.sol` — 9 tests asserting, for every Phase 4 adapter:

- every `onlyOwner` configuration and rescue function rejects a stranger
- every value-moving `onlyVault` entry point rejects a stranger (these pull tokens via
  allowances the vault holds, so an unguarded one is drainable by anyone)
- `upgradeToAndCall` — the single most dangerous function — is owner-gated
- implementations cannot be initialized, and proxies cannot be re-initialized
- `LiFiAdapter.swap` is *deliberately* public, recorded so its openness reads as a
  decision rather than an oversight sitting next to the gated functions

A scanner tells you a modifier is missing today; these tell you the day someone removes
one. **This is not a substitute for a Slither run or an audit** — it is the slice that
was verifiable in the time available.

### Phase 9 — deployment verification

`script/VerifyDeployment.s.sol` is read-only and never broadcasts, so it is safe to run
against mainnet with no key. It checks the four things a deployment can silently get
wrong:

1. **Reserved adapter slots 3/4/5 are still empty** — a registration there is a policy
   breach that nothing else in the system would notice.
2. **Every third-party address matches the verified address book** — a proxy wired to
   the wrong pool or diamond behaves normally right up until it does not.
3. **Ownership actually reached the timelock** — it explicitly catches the dangerous
   middle state where `transferOwnership` ran but `acceptOwnership` never did, leaving
   the deployer holding the upgrade key.
4. **The I5 selector allowlist is populated** — reported as a WARNING, not a failure,
   because an empty allowlist is a correct deployment with dead swap paths.

It also asserts the Base-era keys `"Compound"` and `"Yearn"` are absent, which is how a
substitute adapter slipped into a reserved role would be caught.

**Not done:** no broadcast has ever been made. Phase 9 is complete only when this script
runs green against a real deployment.
