const API_BASE = "http://localhost:3000";

export type IntentAction =
  | "deposit"
  | "swapAndDeposit"
  | "withdraw"
  | "rebalance"
  | "bridge"
  | "claimWithdraw"
  | "cancelWithdraw"
  | "strategy"
  | "leverage";

export type PlanTransaction = {
  to: string;
  data: string;
  value: string;
  chainId: number;
};

export type StrategyStep = {
  action: "swap" | "supplyCollateral" | "borrow" | "repay" | "withdrawCollateral";
  tokenIn: string;
  tokenOut?: string;
  bps: number;
  amountFixed?: string;
  protocolData?: {
    marketId?: string;
    targetLtv?: number;
  };
};

export type ApyTerm = {
  value: number | null;
  status: "ok" | "unavailable";
  source: "morpho" | "staking";
  token?: string;
  market?: string;
  updatedAt: string | null;
};

export type StepApy = {
  index: number;
  action: string;
  apy: number | null;
  kind: "earn" | "cost" | "neutral";
  token?: string;
  status: "ok" | "unavailable";
};

export type StrategyApy = {
  status: "ok" | "unavailable";
  asOf: string;
  leverage: number;
  collateralApy: ApyTerm;
  borrowApy: ApyTerm;
  baseApy: number | null;
  netApy: { value: number | null; status: "ok" | "unavailable" };
  steps: StepApy[];
};

export type DepositLeg = {
  protocol: string;
  bps: number;
  apy: number | null;
  status: "ok" | "unavailable";
};

export type DepositApy = {
  status: "ok" | "partial" | "unavailable";
  netApy: number | null;
  legs: DepositLeg[];
};

export type FortressPlan = {
  intent: { action: IntentAction;[key: string]: unknown };
  description: string;
  transactions: PlanTransaction[];
  simulation: {
    success: boolean;
    gasUsed: string;
    error: string | null;
  };
  apy?: StrategyApy | null;
  depositApy?: DepositApy | null;
};

export type ApiError = {
  error: {
    stage: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

export async function planPrompt(prompt: string, walletAddress: string): Promise<FortressPlan> {
  const res = await fetch(`${API_BASE}/fortress/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ prompt, walletAddress }),
  });

  if (!res.ok) {
    throw await res.json();
  }

  return res.json();
}

export type ExitMode = "full_to_loan" | "full_to_collateral" | "deleverage";

export type PositionView = {
  market: string;
  collateralToken: string;
  loanToken: string;
  collateral: string;
  debt: string;
  collateralValue: string;
  ltv: number;
  lltv: number;
};

export type ExitSettlement = {
  mode: ExitMode;
  debtRepaid: string;
  collateralSold: string;
  collateralReturned: string;
  expectedReceive: string;
  receiveToken: string;
};

export type ExitPlan = {
  description: string;
  transactions: PlanTransaction[];
  simulation: {
    success: boolean;
    gasUsed: string;
    error: string | null;
  };
  position: PositionView;
  settlement: ExitSettlement;
};

export async function fetchPosition(
  walletAddress: string,
  market: string,
): Promise<PositionView> {
  const url = new URL(`${API_BASE}/fortress/position`);
  url.searchParams.set("walletAddress", walletAddress);
  url.searchParams.set("market", market);

  const res = await fetch(url.toString(), { credentials: "include" });
  if (!res.ok) {
    throw await res.json();
  }
  const json = (await res.json()) as { position: PositionView };
  return json.position;
}

export type DashboardPosition = {
  wallet: string;
  marketKey: string;
  collateralToken: string;
  loanToken: string;
  collateral: string;
  debt: string;
  collateralValue: string;
  ltv: number;
  lltv: number;
  netApy: number | null;
  updatedAt: string;
};

export type PositionsFeed = {
  positions: DashboardPosition[];
  asOf: string | null;
  stale: boolean;
};

export async function fetchPositions(walletAddress: string): Promise<PositionsFeed> {
  const url = new URL(`${API_BASE}/fortress/positions`);
  url.searchParams.set("walletAddress", walletAddress);

  const res = await fetch(url.toString(), { credentials: "include" });
  if (!res.ok) {
    throw await res.json();
  }
  return res.json();
}

export async function refreshPositions(walletAddress: string): Promise<void> {
  await fetch(`${API_BASE}/fortress/positions/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ walletAddress }),
  });
}

export type StrategyListItem = {
  id: string;
  title: string;
  summary: string;
  prompt: string;
  status: "ok" | "unavailable" | "error" | "pending";
  description: string | null;
  leverage: number | null;
  netApy: number | null;
  collateralApy: number | null;
  borrowApy: number | null;
  error: string | null;
  updatedAt: string;
};

export type StrategiesFeed = {
  strategies: StrategyListItem[];
  asOf: string;
};

export async function fetchStrategies(): Promise<StrategiesFeed> {
  const res = await fetch(`${API_BASE}/fortress/strategies`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw await res.json();
  }
  return res.json();
}

export async function planExit(params: {
  walletAddress: string;
  market: string;
  mode: ExitMode;
  targetLtv?: number;
}): Promise<ExitPlan> {
  const res = await fetch(`${API_BASE}/fortress/exit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw await res.json();
  }

  return res.json();
}

export type WithdrawResult = {
  description: string;
  protocol: string;
  shares: string;
  minUsdcOut: string;
  transactions: PlanTransaction[];
  simulation: {
    success: boolean;
    gasUsed: string;
    error: string | null;
  };
};

export async function withdrawVault(params: {
  walletAddress: string;
  tokenAddress: string;
  amount: string;
  amountType: "usdc" | "shares" | "percent" | "all";
}): Promise<WithdrawResult> {
  const res = await fetch(`${API_BASE}/fortress/withdraw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw await res.json();
  }

  return res.json();
}

/**
 * Re-build a plan with fresh calldata right before signing.
 * Strategy/leverage intents embed LiFi swap quotes that expire in ~60-120s,
 * so we must re-fetch them at sign-time to avoid FAILED_WOULD_REVERT.
 */
export async function resimulate(
  walletAddress: string,
  intent: FortressPlan["intent"],
  amount?: string,
): Promise<FortressPlan> {
  const res = await fetch(`${API_BASE}/fortress/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ walletAddress, intent, amount }),
  });

  if (!res.ok) {
    throw await res.json();
  }

  return res.json();
}

