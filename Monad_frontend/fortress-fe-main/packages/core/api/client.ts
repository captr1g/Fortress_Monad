import type { z } from "zod";
import {
  PreviewSchema,
  ValidateResponseSchema,
  ExecuteResponseSchema,
  ApiErrorSchema,
} from "../schemas/preview.schema";
import {
  NonceResponseSchema,
  VerifyResponseSchema,
  SessionResponseSchema,
  LogoutResponseSchema,
} from "../schemas/auth.schema";
import {
  StrategiesListResponseSchema,
  StrategyDetailSchema,
  CreateStrategyResponseSchema,
  PatchStrategyResponseSchema,
} from "../schemas/strategies.schema";
import { MarketsResponseSchema } from "../schemas/markets.schema";
import { PositionsResponseSchema } from "../schemas/positions.schema";
import {
  SavedStrategiesListResponseSchema,
  SaveStrategyResponseSchema,
  RenameSavedStrategyResponseSchema,
  TouchSavedStrategyResponseSchema,
} from "../schemas/savedStrategies.schema";
import { RegistryResponseSchema } from "../schemas/registry.schema";
import type {
  PlanRequest,
  Preview,
  ValidateResponse,
  ExecuteResponse,
  NonceResponse,
  VerifyResponse,
  SessionResponse,
  LogoutResponse,
  StrategiesListResponse,
  StrategyDetail,
  CreateStrategyRequest,
  CreateStrategyResponse,
  PatchStrategyRequest,
  PatchStrategyResponse,
  MarketsResponse,
  PositionsResponse,
  PipelineStage,
  SavedStrategiesListResponse,
  SaveStrategyRequest,
  SaveStrategyResponse,
  RenameSavedStrategyResponse,
  TouchSavedStrategyResponse,
  Suggestion,
  RegistryResponse,
} from "../types";

// Typed client for the prompt_2_defi backend. Cookie-session auth (SIWE), so
// every request sends credentials. Responses are zod-validated before use.

export class FortressApiError extends Error {
  readonly stage: PipelineStage | string;
  readonly category: string;
  readonly status?: number;
  readonly details?: Record<string, unknown>;
  /** Recovery hints from the backend — text lines and prompt-insert chips. */
  readonly suggestions?: Suggestion[];

  constructor(e: {
    stage: string;
    category?: string;
    message: string;
    status?: number;
    details?: Record<string, unknown>;
    suggestions?: Suggestion[];
  }) {
    super(e.message);
    this.name = "FortressApiError";
    this.stage = e.stage;
    this.category = e.category ?? "unknown";
    this.status = e.status;
    this.details = e.details;
    this.suggestions = e.suggestions;
  }

  get isUnauthorized() {
    return this.status === 401;
  }
}

function resolveBase(override?: string): string {
  if (override) return override;
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_BASE) {
    return process.env.NEXT_PUBLIC_API_BASE;
  }
  return "http://localhost:3000";
}

/** The exact message the backend expects the wallet to sign (verify.ts). */
export function siweMessage(nonce: string, address: string): string {
  return `Sign in to Fortress\n\nNonce: ${nonce}\nAddress: ${address}`;
}

async function request<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  base?: string,
  getAuthHeader?: () => string | undefined,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  const authHeader = getAuthHeader?.();
  if (authHeader) headers["Authorization"] = authHeader;

  let res: Response;
  try {
    res = await fetch(`${resolveBase(base)}${path}`, {
      method,
      credentials: "include",
      headers: Object.keys(headers).length ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new FortressApiError({
      stage: "api",
      category: "network",
      message: (err as Error)?.message ?? "Network request failed",
    });
  }

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    // Pipeline errors: { error: { stage, category, message } }
    const pipe = ApiErrorSchema.safeParse(json);
    if (pipe.success) throw new FortressApiError({ ...pipe.data.error, status: res.status });
    // Auth errors: { error: "message" }
    if (json && typeof (json as { error?: unknown }).error === "string") {
      throw new FortressApiError({
        stage: "api",
        category: "auth",
        message: (json as { error: string }).error,
        status: res.status,
      });
    }
    throw new FortressApiError({
      stage: "api",
      category: "unknown",
      message: `Request to ${path} failed (${res.status})`,
      status: res.status,
    });
  }

  return schema.parse(json);
}

// ── Legacy /fortress/plan response shape ─────────────────────────────────────
// The deployed backend returns this simpler shape. We adapt it into the full
// Preview shape that the rest of the frontend expects.
type LegacyIntentStep = {
  // prompt_2_defi's StrategyIntent.steps[].action enum: swap, swapToPt,
  // swapToYt, addLiquidityPendle, wrapLp, supplyCollateral, borrow, repay,
  // withdrawCollateral.
  action: string;
  tokenIn: string;
  tokenOut?: string;
  bps?: number;
  amountFixed?: string;
  protocolData?: { marketId?: string; pendleMarket?: string; borrowAmount?: string };
};

type LegacyApyStep = {
  index: number;
  action: string;
  apy: number | null;
  kind: "earn" | "cost" | "neutral";
  status: string;
  token?: string;
};

type LegacyAllocation = { protocol: string; bps: number };
type LegacyDepositApyLeg = { protocol: string; bps: number; apy: number; status: string; market?: string; marketAddress?: string };

type LegacyPlanResponse = {
  intent: {
    action: string;
    inputToken?: string;
    inputAmount?: string;
    steps?: LegacyIntentStep[];
    targetLtv?: number;
    loops?: number;
    // deposit / swapAndDeposit intents — flat "amount split across protocols",
    // no ordered steps.
    amount?: string;
    allocations?: LegacyAllocation[];
    // leverage intent — a single flash-loan open, no steps[] at all.
    collateralToken?: string;
    multiplier?: number;
  };
  description: string;
  transactions: Array<{ to: string; data: string; value: string; chainId: number }>;
  simulation: { success: boolean; gasUsed: string; error: string | null };
  apy?: {
    status: string;
    asOf?: string;
    leverage?: number;
    baseApy?: number | null;
    netApy?: { value: number | null; status: string };
    collateralApy?: { value: number | null; status: string; source: string; token?: string };
    borrowApy?: { value: number | null; status: string; source: string; market?: string };
    steps?: LegacyApyStep[];
  } | null;
  // deposit / swapAndDeposit intents carry APY here instead of `apy`.
  depositApy?: {
    status: string;
    netApy: number | null;
    legs: LegacyDepositApyLeg[];
  } | null;
  loopSuggestion?: {
    label: string;
    insertText: string;
    currentApy: number;
    projectedApy: number;
    leverage: number;
  } | null;
};

// Known token addresses → display metadata for Base mainnet.
const TOKEN_META: Record<string, { symbol: string; decimals: number }> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", decimals: 6 },
  "0x4200000000000000000000000000000000000006": { symbol: "WETH", decimals: 18 },
  "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22": { symbol: "cbETH", decimals: 18 },
  "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452": { symbol: "wstETH", decimals: 18 },
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": { symbol: "cbBTC", decimals: 8 },
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca": { symbol: "USDbC", decimals: 6 },
};

const TOKEN_ADDRESS_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function tokenMeta(addr: string): { symbol: string; decimals: number } {
  return TOKEN_META[addr.toLowerCase()] ?? {
    symbol: `${addr.slice(0, 6)}…${addr.slice(-4)}`,
    decimals: 18,
  };
}

const PENDLE_ACTIONS = new Set(["swaptopt", "swaptoyt", "addliquiditypendle", "wraplp"]);

// PT/YT/LP/wrapped-LP tokens are minted per-market, so they'll never be in
// the static TOKEN_META map — falling back to a truncated hex address there
// would violate the "never show raw addresses" rule. protocolData.pendleMarket
// (or, for a later step referencing the same market, protocolData.marketId
// rewritten to the same label — see StrategyService.resolvePendleMarkets) is
// a human label like "40acresUSDC (27 Aug 2026)"; strip the expiry and tag
// it with the sub-action that minted it, keyed by address so any *later*
// step referencing the same token (e.g. supplyCollateral.tokenIn = ptAddress)
// resolves to the same display symbol without re-guessing from its own action.
function buildPendleTokenMap(steps: LegacyIntentStep[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of steps) {
    const label = s.protocolData?.pendleMarket ?? (s.protocolData?.marketId && !/^0x/.test(s.protocolData.marketId) ? s.protocolData.marketId : undefined);
    if (!label || !s.tokenOut) continue;
    const asset = label.split(" (")[0].trim();
    const a = s.action.toLowerCase();
    const prefix = a === "swaptopt" ? "PT" : a === "swaptoyt" ? "YT" : a === "wraplp" ? "wLP" : a === "addliquiditypendle" ? "LP" : undefined;
    if (prefix) map.set(s.tokenOut.toLowerCase(), `${prefix}-${asset}`);
  }
  return map;
}

function resolveTokenMeta(addr: string, pendleTokenMap: Map<string, string>): { symbol: string; decimals: number } {
  const known = TOKEN_META[addr.toLowerCase()];
  if (known) return known;
  const pendleSymbol = pendleTokenMap.get(addr.toLowerCase());
  if (pendleSymbol) return { symbol: pendleSymbol, decimals: 18 };
  return { symbol: `${addr.slice(0, 6)}…${addr.slice(-4)}`, decimals: 18 };
}

// Map a raw protocol action name to the display enum used by StrategyStepSchema.
const ACTION_MAP: Record<string, string> = {
  swap: "Swap",
  bridge: "Bridge",
  swaptopt: "Swap to PT",
  swaptoyt: "Swap to YT",
  addliquiditypendle: "Add Liquidity",
  wraplp: "Wrap LP",
  supplycollateral: "Supply",
  supply: "Supply",
  borrow: "Borrow",
  repay: "Repay",
  withdrawcollateral: "Withdraw",
  deposit: "Deposit",
  lend: "Lend",
  stake: "Stake",
  claim: "Claim",
};

type DisplayAction =
  | "Swap"
  | "Bridge"
  | "Lend"
  | "Supply"
  | "Borrow"
  | "Repay"
  | "Withdraw"
  | "Stake"
  | "Deposit"
  | "Claim"
  | "Swap to PT"
  | "Swap to YT"
  | "Add Liquidity"
  | "Wrap LP"
  | "Open Leverage";

function mapAction(raw: string): DisplayAction {
  return (ACTION_MAP[raw.toLowerCase()] ?? "Deposit") as DisplayAction;
}

// Determine the protocol name from the action for display purposes.
function protocolFromAction(action: string): string {
  const a = action.toLowerCase();
  if (PENDLE_ACTIONS.has(a)) return "Pendle";
  if (a === "swap") return "LiFi";
  if (a === "bridge") return "LiFi";
  if (a.includes("collateral") || a === "borrow" || a === "repay") return "Morpho";
  if (a === "supply") return "Morpho";
  return "Morpho";
}

// Convert legacy intent steps into the StrategyStep schema the UI renders.
// apySteps: optional per-step APY data from raw.apy.steps, keyed by index.
function legacyStepsToPreviewSteps(
  steps: LegacyIntentStep[],
  apyStepsByIndex?: Map<number, LegacyApyStep>,
): import("../types").StrategyStep[] {
  const pendleTokenMap = buildPendleTokenMap(steps);
  return steps.map((s, i) => {
    const inMeta = resolveTokenMeta(s.tokenIn, pendleTokenMap);
    const outMeta = s.tokenOut ? resolveTokenMeta(s.tokenOut, pendleTokenMap) : undefined;
    const apyData = apyStepsByIndex?.get(i);

    // Map API "earn"/"cost"/"neutral" → internal "yield"/"cost" enum.
    let apy: { value: number; kind: "yield" | "cost" } | undefined;
    if (apyData && apyData.kind !== "neutral" && apyData.apy !== null && apyData.apy !== 0) {
      apy = {
        value: apyData.apy,
        kind: apyData.kind === "cost" ? "cost" : "yield",
      };
    }

    return {
      index: i,
      toolId: `${s.action}-${i}`,
      action: mapAction(s.action),
      venue: protocolFromAction(s.action),
      market: s.protocolData?.marketId,
      chainId: 8453,
      tokenIn: {
        symbol: inMeta.symbol,
        address: s.tokenIn,
        decimals: inMeta.decimals,
        amount: s.amountFixed ?? "0",
      },
      tokenOut: outMeta && s.tokenOut
        ? {
            symbol: outMeta.symbol,
            address: s.tokenOut,
            decimals: outMeta.decimals,
            amount: "0",
          }
        : undefined,
      apy,
    };
  });
}

// leverage intents have no steps[] at all — a single flash-loan open,
// inputToken (equity) → collateralToken at `multiplier`x. Synthesize one
// step so it renders through the same step-card UI as everything else,
// same pattern as buildAllocations() for deposit intents below.
function buildLeverageStep(
  raw: LegacyPlanResponse,
  apyStepsByIndex: Map<number, LegacyApyStep>,
): import("../types").StrategyStep[] {
  const { inputToken, collateralToken, inputAmount } = raw.intent;
  if (!inputToken || !collateralToken || !inputAmount) return [];

  const inMeta = tokenMeta(inputToken);
  const outMeta = tokenMeta(collateralToken);
  const apyStep = apyStepsByIndex.get(0);
  const netApyValue = raw.apy?.netApy?.value;

  let apy: { value: number; kind: "yield" | "cost" } | undefined;
  if (apyStep && apyStep.kind !== "neutral" && apyStep.apy !== null && apyStep.apy !== 0) {
    apy = { value: apyStep.apy, kind: apyStep.kind === "cost" ? "cost" : "yield" };
  } else if (typeof netApyValue === "number") {
    apy = { value: netApyValue, kind: netApyValue < 0 ? "cost" : "yield" };
  }

  return [
    {
      index: 0,
      toolId: "leverage-0",
      action: "Open Leverage",
      venue: "Morpho",
      chainId: 8453,
      tokenIn: { symbol: inMeta.symbol, address: inputToken, decimals: inMeta.decimals, amount: inputAmount },
      tokenOut: { symbol: outMeta.symbol, address: collateralToken, decimals: outMeta.decimals, amount: "0" },
      apy,
    },
  ];
}

// Store for preview artifacts so executePlan can return them without a network call.
const _previewStore = new Map<string, Array<{ kind: "evmTx"; chainId: number; tx: { to: string; data: string; value: string; chainId: number } }>>();

// deposit / swapAndDeposit intents have no ordered steps — just an amount
// split across protocols by bps. The deposit token isn't in the intent
// itself, so infer it from the first approve() call's target contract
// (the backend always builds approve-then-call for these intents).
function buildAllocations(raw: LegacyPlanResponse) {
  const allocations = raw.intent?.allocations;
  const amount = raw.intent?.amount;
  if (!allocations?.length || !amount) return undefined;

  const approveTx = raw.transactions.find((tx) => tx.data.startsWith("0x095ea7b3"));
  const meta = approveTx ? tokenMeta(approveTx.to) : { symbol: "USDC", decimals: 6 };

  const apyByProtocol = new Map<string, LegacyDepositApyLeg>();
  for (const leg of raw.depositApy?.legs ?? []) {
    apyByProtocol.set(leg.protocol, leg);
  }

  return {
    token: meta.symbol,
    tokenAddress: approveTx?.to,
    decimals: meta.decimals,
    amount,
    legs: allocations.map((a) => {
      const apyLeg = apyByProtocol.get(a.protocol);
      return {
        protocol: a.protocol,
        bps: a.bps,
        apy: apyLeg?.apy ?? null,
        status: apyLeg?.status,
        market: apyLeg?.market,
        marketAddress: apyLeg?.marketAddress,
      };
    }),
  };
}

function adaptLegacyPlan(raw: LegacyPlanResponse, planId: string): Preview {
  const artifacts = raw.transactions.map((tx) => ({
    kind: "evmTx" as const,
    chainId: tx.chainId,
    tx: { to: tx.to, data: tx.data, value: tx.value, chainId: tx.chainId },
  }));

  // Persist artifacts so executePlan can retrieve them by planId.
  _previewStore.set(planId, artifacts);

  // Build a lookup map from the APY steps array so O(1) access when mapping intent steps.
  const apyStepsByIndex = new Map<number, LegacyApyStep>();
  if (raw.apy?.steps) {
    for (const apyStep of raw.apy.steps) {
      apyStepsByIndex.set(apyStep.index, apyStep);
    }
  }

  const steps =
    raw.intent?.action === "leverage"
      ? buildLeverageStep(raw, apyStepsByIndex)
      : raw.intent?.steps
        ? legacyStepsToPreviewSteps(raw.intent.steps, apyStepsByIndex)
        : [];

  // Extract net APY from the apy block (strategy intents), falling back to
  // depositApy (deposit/swapAndDeposit intents), then undefined.
  const netApy = raw.apy?.netApy?.value ?? raw.depositApy?.netApy ?? undefined;
  const leverage = raw.apy?.leverage;

  // The plan's input token + amount — powers the Amount field. Only attached
  // when the token is known (never surface raw addresses in the UI).
  let input: Preview["input"];
  const intent = raw.intent;
  if (intent) {
    const addr =
      intent.action === "strategy" || intent.action === "leverage" || intent.action === "swapAndDeposit"
        ? intent.inputToken
        : intent.action === "deposit" || intent.action === "bridge"
          ? TOKEN_ADDRESS_USDC
          : undefined;
    const amount =
      intent.action === "strategy" || intent.action === "leverage" ? intent.inputAmount : intent.amount;
    const meta = addr ? TOKEN_META[addr.toLowerCase()] : undefined;
    if (addr && meta && amount !== undefined) {
      input = { symbol: meta.symbol, address: addr, decimals: meta.decimals, amount };
    }
  }

  return {
    input,
    // Round-tripped verbatim to POST /fortress/simulate for amount re-simulation.
    rawIntent: raw.intent,
    planId,
    humanSummary: raw.description,
    simulation: {
      success: raw.simulation.success,
      gasUsed: raw.simulation.gasUsed,
      gasCostNative: raw.simulation.gasUsed,
      revertReason: raw.simulation.error ?? undefined,
      balanceChanges: [],
      rawLogs: [],
    },
    artifacts,
    previewCards: [],
    steps,
    allocations: buildAllocations(raw),
    netApy,
    leverage,
    loopSuggestion: raw.loopSuggestion ?? undefined,
    // Attach the full apy block so the UI can display collateral/borrow breakdown.
    apy: raw.apy
      ? {
          status: raw.apy.status,
          asOf: raw.apy.asOf,
          leverage: raw.apy.leverage,
          baseApy: raw.apy.baseApy,
          netApy: raw.apy.netApy,
          collateralApy: raw.apy.collateralApy,
          borrowApy: raw.apy.borrowApy,
          steps: raw.apy.steps,
        }
      : undefined,
  };
}

// Default contract context sent when the caller doesn't supply one.
const DEFAULT_CONTRACTS = `
CHAIN: Base (8453)
TOKENS:
  USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (6 decimals)
  WETH: 0x4200000000000000000000000000000000000006 (18 decimals)
  cbETH: 0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22 (18 decimals)
  wstETH: 0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452 (18 decimals)
  cbBTC: 0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf (8 decimals)
MORPHO MARKETS:
  WETH/USDC 86% LLTV: 0x8793cf302b8ffd655ab97bd1c695dbd967807e8367a65cb2f4edaf1380ba1bda
`.trim();

const PLAN_POLL_INTERVAL_MS = 2000;
// Measured live: a complex multi-step prompt took 3m46s end-to-end in
// production (free-model cascade retries + gpt-5-nano reasoning time) --
// comfortably exceeding an earlier 3-minute ceiling that would have given
// up on a job that was still genuinely working. Generous headroom above
// the worst case actually observed, not a guess.
const PLAN_POLL_MAX_MS = 6 * 60 * 1000;

type PlanJobPollResponse =
  | { status: "pending" }
  | { status: "done" | "error"; httpStatus: number; body: unknown };

// Vercel imposes a hard ~120s timeout on rewrites to an external destination
// (our /api/* proxy to the backend), but a complex strategy prompt can
// legitimately take gpt-5-nano 50-100+ seconds. The backend now returns a
// job id almost immediately (202) instead of holding the connection open —
// poll for the result instead. Every individual request stays fast, so
// Vercel's proxy timeout is never at risk.
async function pollPlanJob(
  jobId: string,
  base?: string,
  getAuthHeader?: () => string | undefined,
): Promise<{ httpStatus: number; json: unknown }> {
  const headers: Record<string, string> = {};
  const authHeader = getAuthHeader?.();
  if (authHeader) headers["Authorization"] = authHeader;

  const deadline = Date.now() + PLAN_POLL_MAX_MS;
  while (Date.now() < deadline) {
    let res: Response;
    try {
      res = await fetch(`${resolveBase(base)}/fortress/plan/${jobId}`, {
        method: "GET",
        credentials: "include",
        headers,
      });
    } catch (err) {
      throw new FortressApiError({
        stage: "api",
        category: "network",
        message: (err as Error)?.message ?? "Network request failed",
      });
    }

    if (!res.ok) {
      // 429/5xx on this poll is almost always transient (a shared rate-limit
      // bucket, a cold instance) rather than the job itself failing — the job
      // keeps computing server-side regardless of whether this one poll
      // landed. Failing the whole multi-minute wait over a single bad tick
      // threw away otherwise-successful plans. Treat it like "pending" and
      // let the same overall deadline bound how long that's tolerated.
      if (res.status === 429 || res.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, PLAN_POLL_INTERVAL_MS));
        continue;
      }
      throw new FortressApiError({
        stage: "api",
        category: "unknown",
        message: `Plan status check failed (${res.status})`,
        status: res.status,
      });
    }

    const poll = (await res.json().catch(() => null)) as PlanJobPollResponse | null;
    if (!poll) {
      throw new FortressApiError({
        stage: "api",
        category: "unknown",
        message: "Empty response polling plan status",
      });
    }

    if (poll.status === "pending") {
      await new Promise((resolve) => setTimeout(resolve, PLAN_POLL_INTERVAL_MS));
      continue;
    }
    return { httpStatus: poll.httpStatus, json: poll.body };
  }

  throw new FortressApiError({
    stage: "api",
    category: "timeout",
    message: "Timed out waiting for the strategy plan.",
  });
}

async function createPlanLegacy(
  req: PlanRequest,
  base?: string,
  getAuthHeader?: () => string | undefined,
): Promise<Preview> {
  const body = {
    prompt: req.prompt,
    walletAddress: req.walletAddress,
    inputToken: req.inputToken,
    contracts: DEFAULT_CONTRACTS,
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const authHeader = getAuthHeader?.();
  if (authHeader) headers["Authorization"] = authHeader;

  let res: Response;
  try {
    res = await fetch(`${resolveBase(base)}/fortress/plan`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new FortressApiError({
      stage: "api",
      category: "network",
      message: (err as Error)?.message ?? "Network request failed",
    });
  }

  let httpStatus = res.status;
  let json = (await res.json().catch(() => null)) as (LegacyPlanResponse & { jobId?: string }) | null;

  // Async path: backend returned a job id instead of the full result (the
  // normal case whenever Redis is configured) — poll until it resolves,
  // then fall through to the exact same status/json handling below as the
  // old fully-synchronous response used.
  if (res.status === 202 && json?.jobId) {
    const polled = await pollPlanJob(json.jobId, base, getAuthHeader);
    httpStatus = polled.httpStatus;
    json = polled.json as LegacyPlanResponse | null;
  }

  if (httpStatus < 200 || httpStatus >= 300) {
    const pipe = ApiErrorSchema.safeParse(json);
    if (pipe.success) throw new FortressApiError({ ...pipe.data.error, status: httpStatus });
    throw new FortressApiError({
      stage: "api",
      category: "unknown",
      message: `Plan request failed (${httpStatus})`,
      status: httpStatus,
    });
  }

  if (!json) throw new FortressApiError({ stage: "api", category: "unknown", message: "Empty response from /fortress/plan" });

  // Generate a stable planId from timestamp so validate/execute still get a ref.
  const planId = `legacy-${Date.now()}`;
  return adaptLegacyPlan(json, planId);
}

export type SimulateWithAmountRequest = {
  walletAddress: string;
  /** The opaque intent from a previous plan's `Preview.rawIntent`. */
  intent: unknown;
  /** New amount in raw base units of the plan's input token. */
  amount: string;
};

// LLM-free re-simulation at a user-chosen amount: the backend rescales the
// intent, rebuilds the transactions, and runs a fresh Tenderly simulation.
// Adapted through the same path as createPlan, so the new artifacts land in
// _previewStore under a fresh planId and deploy works unchanged.
async function simulateWithAmountLegacy(
  req: SimulateWithAmountRequest,
  base?: string,
  getAuthHeader?: () => string | undefined,
): Promise<Preview> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const authHeader = getAuthHeader?.();
  if (authHeader) headers["Authorization"] = authHeader;

  let res: Response;
  try {
    res = await fetch(`${resolveBase(base)}/fortress/simulate`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify(req),
    });
  } catch (err) {
    throw new FortressApiError({
      stage: "api",
      category: "network",
      message: (err as Error)?.message ?? "Network request failed",
    });
  }

  const json = (await res.json().catch(() => null)) as LegacyPlanResponse | null;

  if (!res.ok) {
    const pipe = ApiErrorSchema.safeParse(json);
    if (pipe.success) throw new FortressApiError({ ...pipe.data.error, status: res.status });
    throw new FortressApiError({
      stage: "api",
      category: "unknown",
      message: `Simulate request failed (${res.status})`,
      status: res.status,
    });
  }

  if (!json) throw new FortressApiError({ stage: "api", category: "unknown", message: "Empty response from /fortress/simulate" });

  const planId = `legacy-${Date.now()}`;
  return adaptLegacyPlan(json, planId);
}

// `getAuthHeader` is only needed by clients that can't rely on httpOnly
// cookies (React Native) — web's singleton below omits it, so its behavior
// is unchanged.
export function createFortressClient(base?: string, getAuthHeader?: () => string | undefined) {
  return {
    // ── Strategy pipeline ──
    // createPlan calls /fortress/plan (the only plan endpoint on the deployed backend)
    // and adapts the response into the Preview shape the UI expects.
    createPlan: (req: PlanRequest): Promise<Preview> =>
      createPlanLegacy(req, base, getAuthHeader),
    // Re-simulate an existing plan at a new amount (no LLM call).
    simulateWithAmount: (req: SimulateWithAmountRequest): Promise<Preview> =>
      simulateWithAmountLegacy(req, base, getAuthHeader),
    // Chain/token/market registry — canonical data for pickers and chips.
    getRegistry: (): Promise<RegistryResponse> =>
      request("GET", "/fortress/registry", RegistryResponseSchema, undefined, base, getAuthHeader),
    // validate / simulate / execute are no-ops against the deployed backend
    // (it has no stateful pipeline). validate always passes; execute returns
    // the artifacts already stored from createPlan.
    validatePlan: (_planId: string): Promise<ValidateResponse> =>
      Promise.resolve({ valid: true, planId: _planId }),
    simulatePlan: (planId: string): Promise<Preview> =>
      Promise.resolve({
        planId,
        humanSummary: "",
        simulation: { success: true, gasUsed: "0", gasCostNative: "0", balanceChanges: [], rawLogs: [] },
        artifacts: [],
        previewCards: [],
      }),
    executePlan: (planId: string): Promise<ExecuteResponse> => {
      const stored = _previewStore.get(planId);
      if (stored) {
        return Promise.resolve({ planId, artifacts: stored });
      }
      // Fallback: try the remote /execute endpoint (local backend).
      return request("POST", "/execute", ExecuteResponseSchema, { planId }, base, getAuthHeader);
    },

    // ── SIWE auth ──
    requestNonce: (walletAddress: string): Promise<NonceResponse> =>
      request("POST", "/auth/nonce", NonceResponseSchema, { walletAddress }, base, getAuthHeader),
    verifySignature: (walletAddress: string, signature: string): Promise<VerifyResponse> =>
      request("POST", "/auth/verify", VerifyResponseSchema, { walletAddress, signature }, base, getAuthHeader),
    getSession: (): Promise<SessionResponse> =>
      request("GET", "/auth/me", SessionResponseSchema, undefined, base, getAuthHeader),
    logout: (): Promise<LogoutResponse> =>
      request("POST", "/auth/logout", LogoutResponseSchema, undefined, base, getAuthHeader),

    // ── Strategies (dashboard) ──
    getStrategies: (walletAddress?: string): Promise<StrategiesListResponse> =>
      request(
        "GET",
        walletAddress
          ? `/strategies?walletAddress=${encodeURIComponent(walletAddress)}`
          : "/strategies",
        StrategiesListResponseSchema,
        undefined,
        base,
        getAuthHeader,
      ),
    getStrategy: (id: string): Promise<StrategyDetail> =>
      request("GET", `/strategies/${id}`, StrategyDetailSchema, undefined, base, getAuthHeader),
    createStrategy: (body: CreateStrategyRequest): Promise<CreateStrategyResponse> =>
      request("POST", "/strategies", CreateStrategyResponseSchema, body, base, getAuthHeader),
    patchStrategy: (id: string, body: PatchStrategyRequest): Promise<PatchStrategyResponse> =>
      request("PATCH", `/strategies/${id}`, PatchStrategyResponseSchema, body, base, getAuthHeader),

    // ── Markets (APY) ──
    getMarkets: (): Promise<MarketsResponse> =>
      request("GET", "/apy/markets", MarketsResponseSchema, undefined, base, getAuthHeader),

    // ── Morpho positions ──
    getPositions: (walletAddress: string): Promise<PositionsResponse> =>
      request(
        "GET",
        `/fortress/positions?walletAddress=${encodeURIComponent(walletAddress)}`,
        PositionsResponseSchema,
        undefined,
        base,
        getAuthHeader,
      ),
    // Fire-and-forget: evicts the server-side cache so the next getPositions
    // call returns live data instead of a stale snapshot. Best-effort — swallow
    // failures the same way the original hand-rolled hook did.
    refreshPositions: (walletAddress: string): Promise<void> => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const authHeader = getAuthHeader?.();
      if (authHeader) headers["Authorization"] = authHeader;
      return fetch(`${resolveBase(base)}/fortress/positions/refresh`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ walletAddress }),
      }).then(() => undefined).catch(() => undefined);
    },
    exitPosition: (req: any): Promise<any> => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const authHeader = getAuthHeader?.();
      if (authHeader) headers["Authorization"] = authHeader;
      return fetch(`${resolveBase(base)}/fortress/exit`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify(req),
      }).then(async (res) => {
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(txt || `HTTP ${res.status}`);
        }
        return res.json();
      });
    },
    withdrawToken: (req: any): Promise<any> => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const authHeader = getAuthHeader?.();
      if (authHeader) headers["Authorization"] = authHeader;
      return fetch(`${resolveBase(base)}/fortress/withdraw`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify(req),
      }).then(async (res) => {
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(txt || `HTTP ${res.status}`);
        }
        return res.json();
      });
    },

    // ── Saved strategies ──
    listSavedStrategies: (walletAddress: string): Promise<SavedStrategiesListResponse> =>
      request(
        "GET",
        `/fortress/saved-strategies?walletAddress=${encodeURIComponent(walletAddress)}`,
        SavedStrategiesListResponseSchema,
        undefined,
        base,
        getAuthHeader,
      ),
    saveStrategy: (body: SaveStrategyRequest): Promise<SaveStrategyResponse> =>
      request("POST", "/fortress/saved-strategies", SaveStrategyResponseSchema, body, base, getAuthHeader),
    renameSavedStrategy: (id: string, walletAddress: string, name: string): Promise<RenameSavedStrategyResponse> =>
      request(
        "PATCH",
        `/fortress/saved-strategies/${id}`,
        RenameSavedStrategyResponseSchema,
        { walletAddress, name },
        base,
        getAuthHeader,
      ),
    touchSavedStrategyUsage: (id: string, walletAddress: string): Promise<TouchSavedStrategyResponse> =>
      request(
        "POST",
        `/fortress/saved-strategies/${id}/use`,
        TouchSavedStrategyResponseSchema,
        { walletAddress },
        base,
        getAuthHeader,
      ),
    deleteSavedStrategy: async (id: string, walletAddress: string): Promise<void> => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const authHeader = getAuthHeader?.();
      if (authHeader) headers["Authorization"] = authHeader;

      let res: Response;
      try {
        res = await fetch(`${resolveBase(base)}/fortress/saved-strategies/${id}`, {
          method: "DELETE",
          credentials: "include",
          headers,
          body: JSON.stringify({ walletAddress }),
        });
      } catch (err) {
        throw new FortressApiError({
          stage: "api",
          category: "network",
          message: (err as Error)?.message ?? "Network request failed",
        });
      }
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        const pipe = ApiErrorSchema.safeParse(json);
        if (pipe.success) throw new FortressApiError({ ...pipe.data.error, status: res.status });
        throw new FortressApiError({
          stage: "api",
          category: "unknown",
          message: `Request to /fortress/saved-strategies/${id} failed (${res.status})`,
          status: res.status,
        });
      }
    },
  };
}

export type FortressClient = ReturnType<typeof createFortressClient>;

// Singleton used throughout the app.
// NEXT_PUBLIC_API_BASE is inlined by Next.js at build time.
// Falls back to localhost:3000 for local development without the env var set.
export const fortressApi = createFortressClient(
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3000",
);
