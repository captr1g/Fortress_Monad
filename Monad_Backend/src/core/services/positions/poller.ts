import type pg from "pg";
import type { PositionsService } from "./service.js";
import { getAllPositionsByWallet, pruneStaleWallets } from "./db.js";
import { withRetry } from "../apy/poller/retry.js";
import type { DiscoveredMarket } from "./types.js";
import { Address } from "viem";

type PollerDeps = {
  pool: pg.Pool;
  service: PositionsService;
  intervalMs: number;
  walletTtlDays: number;
};

type PollerState = {
  lastPollAt: string | null;
  walletsPolled: number;
  failedWallets: number;
};

const CHUNK_SIZE = 20;
const CHUNK_DELAY_MS = 250;

let timer: ReturnType<typeof setInterval> | null = null;
let state: PollerState = {
  lastPollAt: null,
  walletsPolled: 0,
  failedWallets: 0,
};

export function getPositionsPollerState(): PollerState {
  return { ...state };
}

export function startPositionsPoller(deps: PollerDeps): void {
  poll(deps);
  timer = setInterval(() => poll(deps), deps.intervalMs);
}

export function stopPositionsPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// Rebuilds each tracked wallet's markets from persisted rows (oracle/irm/lltv) and
// re-reads them on-chain via batched multicall — no GraphQL in the steady-state loop.
async function poll(deps: PollerDeps): Promise<void> {
  try {
    await pruneStaleWallets(deps.pool, deps.walletTtlDays);
  } catch (err) {
    console.error("[positions-poller] prune failed:", err);
  }

  let byWallet: Map<string, ReturnType<typeof toMarket>[]>;
  try {
    const stored = await getAllPositionsByWallet(deps.pool);
    byWallet = new Map([...stored].map(([w, ps]) => [w, ps.map(toMarket)]));
  } catch (err) {
    console.error("[positions-poller] load failed:", err);
    return;
  }

  const wallets = [...byWallet.keys()];
  let polled = 0;
  let failed = 0;

  for (let i = 0; i < wallets.length; i += CHUNK_SIZE) {
    const chunk = wallets.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (wallet) => {
        const markets = byWallet.get(wallet) ?? [];
        try {
          await withRetry(() =>
            deps.service.refreshFromMarkets(wallet as Address, markets),
          );
          polled++;
        } catch (err) {
          console.error(`[positions-poller] wallet ${wallet} failed:`, err);
          failed++;
        }
      }),
    );
    if (i + CHUNK_SIZE < wallets.length) {
      await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
    }
  }

  state = {
    lastPollAt: new Date().toISOString(),
    walletsPolled: polled,
    failedWallets: failed,
  };
}

function toMarket(p: {
  marketKey: string;
  loanToken: string;
  collateralToken: string;
  oracle: string;
  irm: string;
  lltvWad: string;
}): DiscoveredMarket {
  return {
    marketKey: p.marketKey as Address,
    params: {
      loanToken: p.loanToken as Address,
      collateralToken: p.collateralToken as Address,
      oracle: p.oracle as Address,
      irm: p.irm as Address,
      lltv: BigInt(p.lltvWad),
    },
  };
}
