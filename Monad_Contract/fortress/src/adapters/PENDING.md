# PENDING ADAPTER SLOTS

Three FORTRESS adapters from the Base deployment have **no counterparty on Monad**.
Their slots are deliberately **empty** and reserved for the operator.

> **Do not fill these with a substitute protocol.** Not Aave V3, not Euler V2, not
> Curvance, not Beefy, not Uniswap V4, not anything. Supplying a replacement is a new
> instruction from the operator and becomes its own phase, with its own research,
> adapter, tests and audit pass (port prompt §3.3).

---

## The three empty slots

| Slot | Base contract (not ported) | Why absent on Monad | Interface a replacement must implement |
|---|---|---|---|
| **Lending — Compound V3** | `CompoundV3Adapter.sol` | Compound V3 (Comet) is deployed on Ethereum, Arbitrum, Base, Optimism, Polygon, Mantle, Unichain, Scroll and Ronin only. No `compound*` entry among the 175 protocol files in `monad-crypto/protocols/mainnet`. No Comet market with any base asset on chain 143. | `IFortProtocol` |
| **DEX LP + gauge — Aerodrome** | `AerodromeAdapter.sol` | Aerodrome is Base-exclusive by design (Velodrome's Base sister deployment); Velodrome itself is Optimism/Superchain-only. No `aerodrome*` or `velodrome*` entry in the registry. No ve(3,3) Dromos deployment on Monad. | `IFortProtocolEx` |
| **Yield vault — YO** | `YoAdapter.sol` | YO Protocol vaults (yoUSD/yoETH/yoBTC/yoEUR/yoGOLD) are on Base, Ethereum, Arbitrum, Solana, HyperEVM, Katana and X-Layer. No YO entry in the registry. YO's own docs list exactly one Monad address — a `YoMorphoAdapter`, which is an *internal* YO strategy adapter reaching into Monad's Morpho, **not** a yoVault that `FortVault` can deposit into. There is no yo-token on Monad to route to. | `IFortProtocol` |

Absence was **re-verified in Phase 0**, not taken from the prompt on faith: the canonical
registry `monad-crypto/protocols/mainnet` (175 protocol files) contains no Compound, no
Aerodrome, no Velodrome and no YO Protocol entry. The only substring hits for "yo" are
`dyorswap` and `enjoyoors`, which are unrelated. See `RESEARCH.md` §10.2.

Also removed alongside them (dead interfaces, no Monad counterparty):
`IComet.sol`, `IAerodromeRouter.sol`, `IAerodromeGauge.sol`.

The Base repo retains all of the above. This repo simply does not include them.

---

## Reserved vs free `adapterId`s

`FortStrategyExecutor.registerAdapter(uint8 adapterId, address adapter)` keys strategy
adapters by `uint8`. The Base deployment assigned:

| adapterId | Adapter | Status on Monad |
|---|---|---|
| `0` | `SwapStrategyAdapter` | ported — venue-agnostic, only its allowlist changes |
| `1` | `MorphoStrategyAdapter` | ported — Morpho Blue live, flash loans confirmed |
| `2` | `PendleStrategyAdapter` | ported — Router V4 ABI matches unchanged |
| **`3`** | *(reserved — Compound V3 replacement)* | **EMPTY, awaiting operator** |
| **`4`** | *(reserved — Aerodrome replacement)* | **EMPTY, awaiting operator** |
| **`5`** | *(reserved — YO replacement)* | **EMPTY, awaiting operator** |
| `6`–`255` | free | unassigned |

> **Phase 4 task 12 note.** `AaveV3Adapter` was added under explicit operator
> instruction and did **not** fill a reserved slot. It is an `IFortProtocol`
> vault-side adapter registered under its own registry keys — `"Aave"` and
> `"Neverland"` — and takes no `adapterId` at all. Ids `3`, `4` and `5` remain
> empty, and the prohibition above still stands: Aave is not a substitute for
> Compound V3, Aerodrome or YO.

IDs `3`, `4` and `5` **must not be assigned to anything else.** Deployment scripts set
these entries to `address(0)` with a `// OPERATOR TO SUPPLY` comment, and
`VerifyDeployment.s.sol` (Phase 9) must assert that no reserved-but-unfilled slot is
registered.

`FortVault`'s protocol registry is keyed by `keccak256(name)` rather than a numeric id,
so no vault-side id is reserved. The Base registry keys `"Compound"`, `"Aave"`, `"Yearn"`
are simply not registered on Monad.

---

## Registration procedure when the operator supplies a replacement

### Strategy-side adapter (`IStrategyAdapter`, used by `FortStrategyExecutor`)

```solidity
// 1. Deploy the adapter behind a UUPS proxy, owned by the timelock (Phase 7).
// 2. Register it against its reserved id:
executor.registerAdapter(3, address(newCompoundLikeAdapter));   // or 4 / 5
```

`registerAdapter` reverts with `AdapterAlreadyRegistered(adapterId)` if the id is taken,
so double-registration is not possible.

### Vault-side protocol (`IFortProtocol` / `IFortProtocolEx`, used by `FortVault`)

```solidity
// isERC4626 = false for adapter-backed protocols; true only for a direct ERC-4626 vault.
vault.registerProtocol("ProtocolName", address(newAdapter), false);
```

---

## Requirements any replacement adapter must meet

A new adapter is not accepted until it satisfies every one of these. They are the
invariants the existing five adapters already hold, plus the Monad-specific one.

1. **UUPS-upgradeable**, `Ownable2Step`, `ReentrancyGuardTransient`
   (TSTORE/TLOAD confirmed available on Monad — `RESEARCH.md` §2.1).
2. **`onlyVault` / `onlyExecutor` gate** on every state-changing entry point.
3. **`rescueToken` escape hatch** and a **50-slot storage gap**.
4. **I1 statelessness** — the adapter's balance of every token involved is zero once the
   call completes.
5. **I2 direct delivery** — every output token goes to the end user, never to the protocol.
6. **I5 allowlists** — any call into a user-supplied external target is validated by
   **both** target address **and** function selector. An address allowlist alone is
   insufficient; that was an audit finding.
7. **I6** — amounts passed to external routers are protocol-computed, never taken from
   user calldata.
8. **I7 approval hygiene** — approvals scoped to the exact amount and revoked in the same
   transaction.
9. **I8 slippage** — every value-converting leg takes a caller-supplied minimum output and
   reverts below it.
10. **Delta-based output verification** using pre-call balance snapshots — never an
    absolute balance check. Must remain correct when `tokenOut == tokenIn` or when a token
    repeats across steps.
11. **I13 measured gas envelope** — a `test/gas/` assertion, measured under **Monad
    Foundry**. Upstream Foundry under-reports cold-state cost by ~3.85× and its numbers
    are not accepted as evidence (`DECISIONS.md` D0-3).
12. **Test matrix** — unit tests against mocks, fuzz tests on amount/slippage boundaries,
    and a fork test against the live Monad deployment for at least one real market/route.
13. **Events on every state change**, no exceptions.
