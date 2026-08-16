import { z } from "zod";

export const ExitModeSchema = z.enum([
  "full_to_loan",
  "full_to_collateral",
  "deleverage",
]);
export type ExitMode = z.infer<typeof ExitModeSchema>;

// Numeric enum matching MorphoExitExecutor.ExitMode on-chain.
export const EXIT_MODE_ENUM: Record<ExitMode, number> = {
  full_to_loan: 0,
  full_to_collateral: 1,
  deleverage: 2,
};

export const ExitRequestSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  market: z.string().min(1),
  mode: ExitModeSchema,
  targetLtv: z.number().min(0).max(1).optional(),
});
export type ExitRequest = z.infer<typeof ExitRequestSchema>;

export type PositionView = {
  market: string;
  collateralToken: `0x${string}`;
  loanToken: `0x${string}`;
  collateral: bigint;
  debt: bigint;
  collateralValue: bigint; // loan-token units
  ltv: number;
  lltv: number;
};

export type ExitSettlement = {
  mode: ExitMode;
  debtRepaid: bigint;
  collateralSold: bigint;
  collateralReturned: bigint;
  expectedReceive: bigint; // loan-token units returned to the user
  receiveToken: `0x${string}`;
};
