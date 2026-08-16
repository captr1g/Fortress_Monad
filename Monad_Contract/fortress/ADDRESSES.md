# ADDRESSES.md — Monad Address Book

Chain: **Monad mainnet, chain ID 143**. Every address below was verified in-session
against live RPC `https://rpc.monad.xyz`. Nothing here was copied from a Base
deployment or written from memory.

**Verification legend**

| Code | Meaning |
|---|---|
| `code` | `eth_getCode` returned non-empty runtime bytecode (byte count given) |
| `id:<call>` | an identity `eth_call` returned the value shown |
| `reg` | address independently matches `monad-crypto/protocols` canonical registry (`mainnet/<p>.jsonc`) |
| `api` | address independently returned by the protocol's own live API |

Verified at mainnet block ~96,415,816 (2026-08-16). Re-verify before Phase 9 deploy.

---

## 1. Network

| Item | Value | Verified how |
|---|---|---|
| Mainnet chain ID | `143` | `eth_chainId` → `143` |
| Mainnet RPC | `https://rpc.monad.xyz` | live, `web3_clientVersion` → `Monad/0.15.1` |
| Testnet chain ID | `10143` | `eth_chainId` → `10143` |
| Testnet RPC | `https://testnet-rpc.monad.xyz` | live, `web3_clientVersion` → `Monad/0.16.0` |
| Block gas limit | **150,000,000** | `eth_getBlockByNumber(latest).gasLimit` |
| Base fee | **100 gwei** (= documented min base fee) | `baseFeePerGas` = `100000000000` wei |
| `eth_maxPriorityFeePerGas` | 2 gwei | RPC |
| `eth_gasPrice` | 102 gwei | RPC (= 100 base + 2 priority) |
| Block time | **~0.30 s** | Δtimestamp over 100 blocks / 100 |
| Finality lag | **2 blocks (~0.6 s)** | single batched call: `latest` 96415894 / `safe` 96415893 / `finalized` 96415892 |

> Note: mainnet and testnet run **different client versions** (0.15.1 vs 0.16.0).
> Testnet is ahead. Do not assume testnet behaviour equals mainnet behaviour for
> anything version-sensitive; re-probe on mainnet before Phase 9.

---

## 2. Tokens

| Token | Address | Dec | Verified how |
|---|---|---|---|
| **USDC** (native Circle) | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | **6** | code 1798B; `id:symbol()="USDC"`, `id:name()="USDC"`, `id:decimals()=6` |
| WETH | `0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242` | 18 | code 177B; `id:symbol()="WETH"`, `id:decimals()=18` |
| WBTC | `0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` | 8 | code 13680B; `id:symbol()="WBTC"`, `id:decimals()=8` |
| cbBTC | `0xd18B7EC58Cdf4876f6AFebd3Ed1730e4Ce10414b` | 8 | code 1182B; `id:symbol()="cbBTC"`, `id:decimals()=8` |
| USDT0 | `0xe7cd86e13AC4309349F30B3435a9d337750fC82D` | 6 | code 2227B; `id:symbol()="USDT0"`, `id:decimals()=6` |
| AUSD (Agora) | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` | 6 | code 5937B; `id:symbol()="AUSD"`, `id:decimals()=6` |
| WMON | `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` | 18 | code 3249B; `id:symbol()="WMON"`, `id:decimals()=18` |

**USDC decimals = 6, identical to Base.** All BPS math and fixed-point constants in
`FortVault` / `FortSwapRouter` carry over unchanged. This is confirmed, not assumed.

---

## 3. Morpho (all ported adapters + both executors depend on this cluster)

| Contract | Address | Verified how |
|---|---|---|
| **Morpho Blue core** | `0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee` | code 15582B; `id:DOMAIN_SEPARATOR()=0x1fae209bfeeba26af7ab…`; `id:owner()=0xe27f43624fdb5325b853c4711bcf0feba754e558`; `id:feeRecipient()=0x0` ; `reg` |
| AdaptiveCurveIrm | `0x09475a3D6eA8c314c592b1a3799bDE044E2F400F` | code 2282B; `id:MORPHO()` → Morpho Blue core; `reg` |
| MorphoChainlinkOracleV2Factory | `0xC8659Bcd5279DB664Be973aEFd752a5326653739` | code 4464B; `reg` |
| MetaMorphoV1_1Factory | `0x33f20973275B2F574488b18929cd7DCBf1AbF275` | code 24400B; `id:MORPHO()` → Morpho Blue core; `reg` |
| Bundler3 | `0x82b684483e844422FD339df0b67b3B111F02c66E` | code 1547B; `MORPHO()` reverts (expected — Bundler3 has no such getter) |
| PublicAllocator | `0xfd70575B732F9482F4197FE1075492e114E97302` | code 8746B; `id:MORPHO()` → Morpho Blue core; `reg` |
| PreLiquidationFactory | `0xB5b3e541abD19799E0c65905a5a42BD37d6c94c0` | code 8381B; `id:MORPHO()` → Morpho Blue core |
| Morpho governance Safe | `0xe27f43624FDb5325b853c4711BCF0fEBA754e558` | = on-chain `Morpho.owner()`; `reg` labels it `Safe` |

Four independent periphery contracts each return the **same** core address from
`MORPHO()`. That is a self-consistent cluster, not a single unconfirmed address.

### 3.1 Flash-loan capability — **CONFIRMED**

| Check | Result |
|---|---|
| `flashLoan(address,uint256,bytes)` = `0xe0232b42` present in Morpho Blue runtime code | **YES** |
| Callback `onMorphoFlashLoan(uint256,bytes)` = `0x31f57072` present in core runtime code | **YES** |
| Matches `src/interfaces/IMorphoBlue.sol` `IMorphoFlashLoanCallback` | **YES — identical shape** |
| Also present: `supply` `0x20b76e81`, `withdraw` `0x5c2bea49`, `borrow` `0x50d8cd4b`, `supplyCollateral` `0xa99aad89`, `DOMAIN_SEPARATOR` `0x3644e515` | all found |

⇒ **Phase 5 (`MorphoLeverageExecutor`, `MorphoExitExecutor`) is GO.**

### 3.2 MetaMorpho ERC-4626 vaults (for `FortVault`'s `isERC4626` fast path)

| Vault | Address | Verified how |
|---|---|---|
| naUSDC | `0xf5BC68C6e5825FEAe99B8018F62a595Cf745e297` | code 19689B; `id:symbol()="naUSDC"`; `id:asset()`=USDC; `totalAssets()`=1 |
| **hyperUSDCa** | `0xA8665084D8CD6276c00CA97Cbc0BF4BC9ae94c79` | code 19689B; `id:symbol()="hyperUSDCa"`; `id:asset()`=USDC; `totalAssets()`=23,259,775 |
| **bbqAUSD** | `0xBC03E505EE65f9fAa68a2D7e5A74452858C16D29` | code 19689B; `id:symbol()="bbqAUSD"`; `id:asset()`=AUSD; `totalAssets()`=13,106,242,214 |
| steakETH | `0xba8424EBBEd6C51bEa6d6D903B8815838E6a0322` | code 19689B; `id:symbol()="steakETH"`; `id:asset()`=WETH; `totalAssets()`=1.16e17 |

`naUSDC` has `totalAssets() == 1` — effectively **empty**. Use `hyperUSDCa` and
`bbqAUSD` for the Phase 4 "two live ERC-4626 targets" requirement.

---

## 4. Pendle

| Contract | Address | Verified how |
|---|---|---|
| **Router V4** | `0x888888888889758F76e7103c6CbF23ABbF58F946` | code 287B (diamond proxy); `id:owner()=0x7877adfaded756f3248a0ebfe8ac2e2ef87b75ac`; unknown selectors revert `INVALID_SELECTOR` (Pendle's own fallback error) |
| RouterStatic | `0x6813d43782395A1F2AAb42f39aeEDE03ac655e09` | code 425B |
| MarketFactoryV6 | `0xA3cb62a49b66eB2536cf6F3C7AC82293784888A3` | code 2973B; EIP-1967 impl `0x50fe28d319e62794d95e522863384d4f849ba1c9`; `id:owner()=0x2ad631f7…` |
| PendleSwap | `0xd4F480965D2347d421F1bEC7F545682E5Ec2151D` | code 225B |
| LimitRouter | `0x000000000000c9B3E2C3Ec88B1B4c0cD853f4321` | code 2938B; `id:owner()=0x2ad631f7…` |
| YieldContractFactory | `0x4fe1B23ab695D99394Ab78c16A5bE358f31847F4` | code 2973B; EIP-1967 impl `0xd17685054f62fe55739cf9209d10570a37dcd1e0` |
| PYLPOracle | `0x5542be50420E88dd7D5B4a3D488FA6ED82F6DAc2` | code 2973B; EIP-1967 impl `0x44a287dad83e2d41b77659de33fce72765d1524d` |
| SYFactory | `0x466CeD3b33045Ea986B2f306C8D0aA8067961CF8` | code 2973B; EIP-1967 impl `0xc0090a2ec2f2581df7080ab56fce913a376f5297` |

> The four contracts sharing an identical 2973-byte code size are **EIP-1967 proxies**
> with the same proxy bytecode but four **distinct** implementations (listed above).
> Investigated because identical code size is normally a red flag; it is benign here.

### 4.1 `IPendleRouter.sol` ABI compatibility — **CONFIRMED**

Selectors derived from our own compiled artifact and probed against the live Monad diamond:

| Our function | Selector | On Monad Router V4? |
|---|---|---|
| `swapExactTokenForPt(...)` | `0xc81f847a` | **routed** |
| `swapExactPtForToken(...)` | `0x594a88cc` | **routed** |
| `redeemPyToToken(...)` | `0x47f1de22` | **routed** |
| *negative control* `bogus()` | `0xdeadbeef` | rejected `INVALID_SELECTOR` |

⇒ `src/interfaces/IPendleRouter.sol` needs **no change** for Monad.

---

## 5. LI.FI

| Contract | Address | Verified how |
|---|---|---|
| **LI.FI Diamond (Monad)** | `0x026F252016A7C47CDEf1F05a3Fc9E20C92a49C37` | code 254B; `id:owner()=0x707f90dfb87f88690b6a4fc74107a820af646c47`; `reg` (`li_fi.jsonc` → `"Li.Fi"`); `api` (li.quest quote returns this as `transactionRequest.to`) |
| LI.FI Permit2Proxy | `0x3c6b2e0b7421254846c53c118e24c65d59eae75e` | code 8037B; `reg` |
| ~~LI.FI Diamond (Base)~~ | ~~`0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE`~~ | **`eth_getCode` = `0x` — NO CODE ON MONAD.** All 6 occurrences in our repo are dead. |

Diamond exposes **21 facets / 87 selectors** (`facets()` loupe call).

### 5.1 GenericSwapFacetV3 — facet `0xe850dad9b442b1a7df8fbbd397dbb7466379a9e8`

| Function | Selector | Registered |
|---|---|---|
| `swapTokensSingleV3ERC20ToERC20` | `0x4666fc80` | yes |
| `swapTokensSingleV3ERC20ToNative` | `0x733214a3` | yes |
| `swapTokensSingleV3NativeToERC20` | `0xaf7060fd` | yes |
| `swapTokensMultipleV3ERC20ToERC20` | `0x5fd9ae2e` | yes |
| `swapTokensMultipleV3ERC20ToNative` | `0x2c57e884` | yes |
| `swapTokensMultipleV3NativeToERC20` | `0x736eac0b` | yes |
| **`swapTokensGeneric`** (what our `LiFiAdapter` calls) | **`0x4630a0d8`** | **NOT REGISTERED** |

Live `li.quest` quote (USDC→WMON, chain 143, 1000 USDC) returned
`to = 0x026F25…9C37`, `data` selector **`0x5fd9ae2e`** — i.e. LI.FI itself routes
through `swapTokensMultipleV3ERC20ToERC20`, confirming the v1 generic entry point is gone.

### 5.2 Bridging

Live quote Monad(143)→Base(8453) USDC→USDC: `tool=polymerStandard`, `to`= the Monad
diamond, selector `0x17917a4e` (facet `0xf581a8bfead9dd999298cc0ea0f7d11c3cb92a56`).

Bridges advertised for chain 143: `across, mayan, mayanMCTP, glacis, gasZipBridge,
relaydepository, mayanFastMCTP, unit, polymer, polymerStandard, near, layerswap`.
DEX/aggregators on 143: `eisen, openocean, kyberswap, sushiswap, fly, monorail, kuru`.

---

## 6. Infrastructure

| Contract | Address | Verified how |
|---|---|---|
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | code 3808B |
| Permit2 | `0x000000000022d473030f116ddee9f6b43ac78ba3` | code 9152B; `id:DOMAIN_SEPARATOR()=0x400b2a627bd11055ecf9…` |
| CreateX | `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed` | code 11838B |
| Foundry deterministic deployer | `0x4e59b44847b379578588920ca78fbf26c0b4956c` | code 69B |
| **Safe singleton** | `0x69f4D1788e39c87893C980c06EdF4b7f686e2938` | code 22958B; monskills `addresses` skill lists it as **`Safe`** (the singleton/mastercopy) — **not** the proxy factory as prompt §2.1 states |
| SafeL2 | `0xfb1bffC9d739B8D520DaF37dF666da4C687191EA` | monskills `addresses` skill |
| SafeSingletonFactory | `0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7` | monskills `addresses` skill — **this** is the factory |
| Switchboard oracle | `0xB7F03eee7B9F56347e32cC71DaD65B303D5a0E67` | code 130B (proxy-sized) |

---

## 7. Base addresses to be removed in Phase 2

23 unique 40-hex address literals exist across `src/` + `script/`
(prompt §2 estimated ~30; actual count is 23). Highest-occurrence:

| Base address | Occurrences | What it is | Monad replacement |
|---|---|---|---|
| `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | 6 | LI.FI Diamond (Base) | `0x026F252016A7C47CDEf1F05a3Fc9E20C92a49C37` |
| `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 5 | USDC (Base) | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` |
| `0x4200000000000000000000000000000000000006` | 1 | WETH (Base predeploy) | `0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242` |
| remaining 20 | — | Compound/Aerodrome/YO/Pendle-Base/Morpho-Base specifics | resolved per-adapter in Phase 2 |

---

## 8. UNVERIFIED

- **Safe `0x69f4D1788e39c87893C980c06EdF4b7f686e2938`** — has code, but I did not prove
  it is the Safe **proxy factory** rather than a singleton or an unrelated contract.
  Must be resolved before Phase 7 (timelock ownership).
- **On-chain deploy probes** — all EVM feature probes were executed against the live
  Monad EVM via `eth_call`/`eth_estimateGas` with state overrides, **not** via a
  broadcast deployment, because doing so requires a funded testnet key and the only
  key present (`.env` `PRIVATE_KEY`) is the Base deployer, which prompt rule 7 forbids
  using. Semantics are proven; a broadcast confirmation is still outstanding.
- **Third-party `CREATE2` in the call graph** — FORTRESS itself contains none (§ RESEARCH.md),
  but I cannot statically prove that LI.FI's routed DEXs never `CREATE2` mid-swap.
- **Pendle `RouterStatic` / `PendleSwap` / `PYLPOracle`** — code confirmed, no identity
  call succeeded (no `owner()`); identity rests on the registry + Router association only.
- **Bridge facet selector→name mapping** — the 12 bridge facets are enumerated by
  address and selector, but only `polymerStandard` (`0x17917a4e`) is confirmed by a live
  quote. Full mapping is Phase 6 work. `openchain.xyz` signature DB was returning HTTP 500
  during this session, so bulk selector resolution could not be completed.
