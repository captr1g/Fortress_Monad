import { type Address, getAddress } from "viem";

const PENDLE_API_BASE = "https://api-v2.pendle.finance/core";
const TIMEOUT_MS = 15_000;
const MARKET_CACHE_TTL_MS = 5 * 60_000;

const MONTHS: Record<string, number> = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

export type PendleMarketInfo = {
  marketAddress: Address;
  ptAddress: Address;
  ytAddress: Address;
  name: string;
  expiry: string;
  expired: boolean;
};

// Router binary-search bounds for swapExactTokenForPt, taken verbatim from the SDK.
export type PendleApproxParams = {
  guessMin: bigint;
  guessMax: bigint;
  guessOffchain: bigint;
  maxIteration: bigint;
  eps: bigint;
};

type RawPendleMarket = {
  name: string;
  address: string;
  expiry: string;
  pt: string;
  yt: string;
};

// Strips a "chainId-" prefix (Pendle's asset id format) and checksums the address.
function stripChainPrefix(value: string): Address {
  const parts = value.split("-");
  return getAddress(parts[parts.length - 1]);
}

// Normalizes a Pendle asset name for label matching
function normalizeAsset(name: string): string {
  return name
    .replace(/^PT-/i, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}

// Parses "cUSD (23 Jul 2026)", "PT-cUSD-23JUL2026", etc. into an asset + expiry day.
function parseMarketLabel(
  label: string,
): { asset: string; expiry: Date } | null {
  const cleaned = label.trim().replace(/^PT-/i, "");
  const m = cleaned.match(/(\d{1,2})[\s-]?([A-Za-z]{3})[\s-]?(\d{4})/);
  if (!m) return null;

  const month = MONTHS[m[2].toUpperCase()];
  if (month === undefined) return null;

  const expiry = new Date(Date.UTC(Number(m[3]), month, Number(m[1])));
  const asset = cleaned
    .slice(0, m.index)
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  if (!asset) return null;

  return { asset, expiry };
}

function sameUtcDay(iso: string, date: Date): boolean {
  const a = new Date(iso);
  return (
    a.getUTCFullYear() === date.getUTCFullYear() &&
    a.getUTCMonth() === date.getUTCMonth() &&
    a.getUTCDate() === date.getUTCDate()
  );
}

export class PendleMarketService {
  private readonly chainId: number;
  private cache: { markets: PendleMarketInfo[]; fetchedAt: number } | null =
    null;

  constructor(chainId: number) {
    this.chainId = chainId;
  }

  // Resolves a market reference to its market + PT addresses. Accepts a market
  // address (0x…) or a human label like "cUSD-23JUL2026" / "cUSD (23 Jul 2026)".
  // Returns null when unresolved or when a label matches more than one market.
  async resolveMarket(ref: string): Promise<PendleMarketInfo | null> {
    const markets = await this.listMarkets();

    if (/^0x[a-fA-F0-9]{40}$/.test(ref)) {
      const addr = ref.toLowerCase();
      return (
        markets.find((m) => m.marketAddress.toLowerCase() === addr) ?? null
      );
    }

    const parsed = parseMarketLabel(ref);
    if (!parsed) return null;

    const matches = markets.filter(
      (m) =>
        normalizeAsset(m.name) === parsed.asset &&
        sameUtcDay(m.expiry, parsed.expiry),
    );
    return matches.length === 1 ? matches[0] : null;
  }

  // Fetches calldata that swaps `tokenIn` -> PT via the Pendle Convert API.
  // `receiver` MUST be the on-chain adapter that measures the PT balance delta.
  async fetchPtSwap(params: {
    receiver: Address;
    tokenIn: Address;
    amountIn: bigint;
    ptToken: Address;
    slippage: number;
  }): Promise<{ calldata: Address; expectedOut: bigint }> {
    return this.fetchConvert(
      params.tokenIn,
      params.amountIn,
      params.ptToken,
      params.receiver,
      params.slippage,
    );
  }

  // Fetches calldata that swaps `tokenIn` -> YT via the Pendle Convert API.
  async fetchYtSwap(params: {
    receiver: Address;
    tokenIn: Address;
    amountIn: bigint;
    ytToken: Address;
    slippage: number;
  }): Promise<{ calldata: Address; expectedOut: bigint }> {
    return this.fetchConvert(
      params.tokenIn,
      params.amountIn,
      params.ytToken,
      params.receiver,
      params.slippage,
    );
  }

  // Fetches calldata that adds liquidity (tokenIn -> LP) via the Pendle Convert API.
  // tokensOut = market address (the LP token IS the market contract on Pendle).
  async fetchAddLiquidity(params: {
    receiver: Address;
    tokenIn: Address;
    amountIn: bigint;
    marketAddress: Address;
    slippage: number;
  }): Promise<{ calldata: Address; expectedOut: bigint }> {
    return this.fetchConvert(
      params.tokenIn,
      params.amountIn,
      params.marketAddress,
      params.receiver,
      params.slippage,
    );
  }

  // Vault fixed-yield deposit: decomposed swapExactTokenForPt args (minPtOut + the
  // router's guess bounds) for a DIRECT tokenIn→PT route (no aggregator), which is
  // exactly what the on-chain PendleAdapter executes. Sourced verbatim from the SDK.
  async fetchPtDepositParams(params: {
    receiver: Address;
    tokenIn: Address;
    amountIn: bigint;
    ptToken: Address;
    slippage: number;
  }): Promise<{
    minPtOut: bigint;
    guessPtOut: PendleApproxParams;
    expectedOut: bigint;
  }> {
    const route = await this.fetchConvertRoute(
      params.tokenIn,
      params.amountIn,
      params.ptToken,
      params.receiver,
      params.slippage,
    );
    const info = route.contractParamInfo;
    if (info?.method !== "swapExactTokenForPt") {
      throw new Error(
        `Pendle deposit route is not a direct PT swap (got ${info?.method ?? "none"}).`,
      );
    }
    // swapExactTokenForPt(receiver, market, minPtOut, guessPtOut, input, limit)
    const callParams = info.contractCallParams as [
      unknown,
      unknown,
      string,
      Record<string, string>,
    ];
    const minPtOut = BigInt(callParams[2]);
    const g = callParams[3];
    return {
      minPtOut,
      guessPtOut: {
        guessMin: BigInt(g.guessMin),
        guessMax: BigInt(g.guessMax),
        guessOffchain: BigInt(g.guessOffchain),
        maxIteration: BigInt(g.maxIteration),
        eps: BigInt(g.eps),
      },
      expectedOut: BigInt(route.outputs[0].amount),
    };
  }

  // Standalone PT redeem: EXECUTABLE Pendle RouterV4 calldata that sells/redeems
  // `amountIn` PT back to `tokenOut` (USDC) with `receiver` as the user. Aggregator
  // is enabled so markets whose SY does not unwrap 1:1 to USDC (e.g. 40acresUSDC)
  // still route through to USDC — the direct (aggregator-off) route the vault adapter
  // uses cannot complete that final hop. Mirrors the proven standalone-buy pattern.
  async fetchRedeemTx(params: {
    receiver: Address;
    ptToken: Address;
    amountIn: bigint;
    tokenOut: Address;
    slippage: number;
  }): Promise<{ to: Address; data: Address; value: bigint; expectedOut: bigint }> {
    const url = new URL(`${PENDLE_API_BASE}/v2/sdk/${this.chainId}/convert`);
    url.searchParams.set("tokensIn", params.ptToken);
    url.searchParams.set("amountsIn", params.amountIn.toString());
    url.searchParams.set("tokensOut", params.tokenOut);
    url.searchParams.set("receiver", params.receiver);
    url.searchParams.set("slippage", String(params.slippage));
    url.searchParams.set("enableAggregator", "true");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), { signal: controller.signal });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Pendle redeem quote failed (${res.status}): ${body}`);
      }
      const json = (await res.json()) as {
        routes?: Array<{
          tx: { to: string; data: string; value?: string };
          outputs: Array<{ amount: string }>;
        }>;
      };
      const route = json.routes?.[0];
      if (!route?.tx?.data || !route.tx.to)
        throw new Error("Pendle SDK returned no executable redeem route");
      return {
        to: getAddress(route.tx.to),
        data: route.tx.data as Address,
        value: BigInt(route.tx.value ?? 0),
        expectedOut: BigInt(route.outputs[0].amount),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // Market implied (fixed) APY — the yield a PT holder locks in to maturity.
  async fetchImpliedApy(market: Address): Promise<number | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(
        `${PENDLE_API_BASE}/v1/${this.chainId}/markets/${market}`,
        {
          signal: controller.signal,
        },
      );
      if (!res.ok) return null;
      const json = (await res.json()) as { impliedApy?: number };
      return typeof json.impliedApy === "number" ? json.impliedApy : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Convert API call returning the full first route (calldata, outputs, and the
  // decomposed contract params). enableAggregator=false pins the direct route.
  private async fetchConvertRoute(
    tokenIn: Address,
    amountIn: bigint,
    tokenOut: Address,
    receiver: Address,
    slippage: number,
  ): Promise<{
    outputs: Array<{ amount: string }>;
    contractParamInfo?: { method: string; contractCallParams: unknown[] };
  }> {
    const url = new URL(`${PENDLE_API_BASE}/v2/sdk/${this.chainId}/convert`);
    url.searchParams.set("tokensIn", tokenIn);
    url.searchParams.set("amountsIn", amountIn.toString());
    url.searchParams.set("tokensOut", tokenOut);
    url.searchParams.set("receiver", receiver);
    url.searchParams.set("slippage", String(slippage));
    url.searchParams.set("enableAggregator", "false");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), { signal: controller.signal });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Pendle convert failed (${res.status}): ${body}`);
      }
      const json = (await res.json()) as {
        routes?: Array<{
          outputs: Array<{ amount: string }>;
          contractParamInfo?: { method: string; contractCallParams: unknown[] };
        }>;
      };
      const route = json.routes?.[0];
      if (!route?.outputs?.[0])
        throw new Error("Pendle SDK returned no executable route");
      return route;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchConvert(
    tokenIn: Address,
    amountIn: bigint,
    tokenOut: Address,
    receiver: Address,
    slippage: number,
  ): Promise<{ calldata: Address; expectedOut: bigint }> {
    const url = new URL(`${PENDLE_API_BASE}/v2/sdk/${this.chainId}/convert`);
    url.searchParams.set("tokensIn", tokenIn);
    url.searchParams.set("amountsIn", amountIn.toString());
    url.searchParams.set("tokensOut", tokenOut);
    url.searchParams.set("receiver", receiver);
    url.searchParams.set("slippage", String(slippage));
    url.searchParams.set("enableAggregator", "true");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), { signal: controller.signal });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Pendle swap quote failed (${res.status}): ${body}`);
      }
      const json = (await res.json()) as {
        routes?: Array<{
          tx: { data: string };
          outputs: Array<{ amount: string }>;
        }>;
      };
      const route = json.routes?.[0];
      if (!route?.tx?.data)
        throw new Error("Pendle SDK returned no executable route");
      return {
        calldata: route.tx.data as Address,
        expectedOut: BigInt(route.outputs[0].amount),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async listMarkets(): Promise<PendleMarketInfo[]> {
    if (this.cache && Date.now() - this.cache.fetchedAt < MARKET_CACHE_TTL_MS) {
      return this.cache.markets;
    }
    const markets = await this.fetchAllMarkets();
    this.cache = { markets, fetchedAt: Date.now() };
    return markets;
  }

  private async fetchAllMarkets(): Promise<PendleMarketInfo[]> {
    const out: PendleMarketInfo[] = [];
    const limit = 100;
    let skip = 0;

    // Pendle paginates markets; a few pages cover every chain.
    for (let page = 0; page < 20; page++) {
      const url = new URL(`${PENDLE_API_BASE}/v2/markets/all`);
      url.searchParams.set("chainId", String(this.chainId));
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("skip", String(skip));

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let json: { total?: number; results?: RawPendleMarket[] };
      try {
        const res = await fetch(url.toString(), { signal: controller.signal });
        if (!res.ok) break;
        json = (await res.json()) as {
          total?: number;
          results?: RawPendleMarket[];
        };
      } finally {
        clearTimeout(timeout);
      }

      for (const m of json.results ?? []) {
        out.push({
          marketAddress: stripChainPrefix(m.address),
          ptAddress: stripChainPrefix(m.pt),
          ytAddress: stripChainPrefix(m.yt),
          name: m.name,
          expiry: m.expiry,
          expired: new Date(m.expiry).getTime() < Date.now(),
        });
      }

      skip += limit;
      if (skip >= (json.total ?? 0)) break;
    }
    return out;
  }
}
