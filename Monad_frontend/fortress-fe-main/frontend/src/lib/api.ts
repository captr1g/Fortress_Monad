const API_BASE = "http://localhost:3000";

export type IntentAction =
  | "deposit"
  | "swapAndDeposit"
  | "withdraw"
  | "rebalance"
  | "bridge"
  | "claimWithdraw"
  | "cancelWithdraw";

export type PlanTransaction = {
  to: string;
  data: string;
  value: string;
  chainId: number;
};

export type FortressPlan = {
  intent: { action: IntentAction; [key: string]: unknown };
  description: string;
  transactions: PlanTransaction[];
  simulation: {
    success: boolean;
    gasUsed: string;
    error: string | null;
  };
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
