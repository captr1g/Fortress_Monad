import { z } from "zod";
import { StrategyStepSchema } from "./preview.schema";

// Dashboard persistence — mirrors prompt_2_defi/src/services/strategy-store.ts
// and api/strategies-route.ts.

export const StrategyStatusSchema = z.enum([
  "monitoring",
  "entered",
  "exit_pending",
  "exited",
  "failed",
]);

export const StrategyHistoryEventSchema = z.object({
  at: z.string(),
  event: z.string(),
  txHash: z.string().optional(),
});

export const StrategySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  walletAddress: z.string(),
  status: StrategyStatusSchema,
  chainId: z.number(),
  netApy: z.number(),
  valueUsd: z.string(),
  depositUsd: z.string(),
  pnlUsd: z.string(),
  tags: z.array(z.string()),
  deployedAt: z.string(),
  exitedAt: z.string().optional(),
  exitCondition: z.string().optional(),
  planId: z.string(),
  txHashes: z.array(z.string()),
  description: z.string().optional(),
});

// GET /strategies returns the full stored object (detail), not just the summary.
export const StrategyDetailSchema = StrategySummarySchema.extend({
  steps: z.array(StrategyStepSchema).default([]),
  position: z.unknown().optional(),
  gasSpentUsd: z.string(),
  history: z.array(StrategyHistoryEventSchema),
});

export const StrategiesListResponseSchema = z.object({
  strategies: z.array(StrategyDetailSchema),
});

export const CreateStrategyResponseSchema = z.object({ id: z.string() });
export const PatchStrategyResponseSchema = z.object({
  success: z.boolean(),
  strategy: StrategyDetailSchema.nullable(),
});

export const CreateStrategyRequestSchema = z.object({
  planId: z.string(),
  name: z.string().min(1).max(200),
  txHashes: z.array(z.string()).min(1),
  tags: z.array(z.string()).optional(),
  exitCondition: z.string().optional(),
  description: z.string().optional(),
});

export const PatchStrategyRequestSchema = z.object({
  status: StrategyStatusSchema.optional(),
  exitCondition: z.string().optional(),
  historyEvent: z.string().optional(),
  txHash: z.string().optional(),
  netApy: z.number().optional(),
  valueUsd: z.string().optional(),
  pnlUsd: z.string().optional(),
});
