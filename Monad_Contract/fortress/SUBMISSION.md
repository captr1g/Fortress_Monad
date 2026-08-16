# FORTRESS on Monad — submission summary

**Chain:** Monad mainnet, chain ID 143. **Pinned fork block:** 96,431,000.
**Toolchain:** Monad Foundry, solc 0.8.26 pinned, `evm_version = "cancun"`,
`network = "monad"`.

State at submission: **Phases 0–4 complete** (Phase 4 task 14 skipped by operator
instruction). Phases 5–9 not started — see [What is NOT done](#what-is-not-done).

```
623 tests pass, 0 fail          (unit + fuzz + invariant + gas)
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
| 5 | Executor / transient-storage hardening | ❌ not started |
| 6 | Cross-chain + keeper design | ❌ not started |
| 7 | Timelock ownership wiring | ❌ not started |
| 8 | Security pass, Slither triage | ❌ not started |
| 9 | Deployment + `VerifyDeployment.s.sol` | ❌ **blocked** — see §6 |

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

**Phases 5–9 are not started.** Realistic remaining effort: **10–15 hours.**

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

Three adapter slots stay **empty on purpose**: Compound V3, Aerodrome and YO have no
counterparty on Monad (verified against the 175-file canonical registry). `adapterId`
3/4/5 are reserved and must not be filled with substitutes — see `src/adapters/PENDING.md`.
Aave was added under explicit operator instruction and did **not** consume a reserved slot.

---

## 7. Reproducing the evidence

```bash
cd Monad_Contract/Fortress

# Correctness (no RPC needed)
forge test --no-match-path "test/fork/*"          # 623 pass

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

## 8. Where to read further

| Document | Contents |
|---|---|
| `RESEARCH.md` | Phase 0 findings, EVM feature probes, adapter matrix, open questions |
| `DECISIONS.md` | Every divergence from Base with evidence — D0-1 … D4-13 |
| `ADDRESSES.md` | Address book with per-address verification evidence |
| `docs/gas-model.md` | Measured cost curve, `MAX_STEPS` derivation, per-adapter envelopes |
| `src/adapters/PENDING.md` | The three empty slots and the bar any replacement must clear |
