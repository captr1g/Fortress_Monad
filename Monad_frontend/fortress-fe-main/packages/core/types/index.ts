import type { z } from "zod";
import type {
  BalanceChangeSchema,
  PositionStateSchema,
  SimResultSchema,
  PreviewCardSchema,
  UnsignedTxSchema,
  ExecutionArtifactSchema,
  TokenAmountSchema,
  StrategyStepSchema,
  PreviewSchema,
  PlanInputSchema,
  SuggestionSchema,
  LoopSuggestionSchema,
  ValidateResponseSchema,
  ExecuteResponseSchema,
  ApiErrorSchema,
} from "../schemas/preview.schema";
import type {
  RegistryTokenSchema,
  RegistryMarketSchema,
  RegistryProtocolSchema,
  RegistryChainSchema,
  RegistryResponseSchema,
} from "../schemas/registry.schema";
import type { PlanRequestSchema } from "../schemas/request.schema";
import type {
  NonceResponseSchema,
  VerifyResponseSchema,
  SessionResponseSchema,
  LogoutResponseSchema,
} from "../schemas/auth.schema";
import type {
  StrategyStatusSchema,
  StrategyHistoryEventSchema,
  StrategySummarySchema,
  StrategyDetailSchema,
  StrategiesListResponseSchema,
  CreateStrategyRequestSchema,
  CreateStrategyResponseSchema,
  PatchStrategyRequestSchema,
  PatchStrategyResponseSchema,
} from "../schemas/strategies.schema";
import type { MarketsResponseSchema } from "../schemas/markets.schema";
import type { PositionsResponseSchema, PositionApiSchema } from "../schemas/positions.schema";
import type {
  SavedStrategySchema,
  SavedStrategiesListResponseSchema,
  SaveStrategyRequestSchema,
  SaveStrategyResponseSchema,
  RenameSavedStrategyRequestSchema,
  RenameSavedStrategyResponseSchema,
  TouchSavedStrategyResponseSchema,
} from "../schemas/savedStrategies.schema";

// Types are derived from zod — never hand-written duplicates (CLAUDE.md rule 2).
export type BalanceChange = z.infer<typeof BalanceChangeSchema>;
export type PositionState = z.infer<typeof PositionStateSchema>;
export type SimResult = z.infer<typeof SimResultSchema>;
export type PreviewCard = z.infer<typeof PreviewCardSchema>;
export type UnsignedTx = z.infer<typeof UnsignedTxSchema>;
export type ExecutionArtifact = z.infer<typeof ExecutionArtifactSchema>;
export type Preview = z.infer<typeof PreviewSchema>;
export type LoopSuggestion = z.infer<typeof LoopSuggestionSchema>;
export type ValidateResponse = z.infer<typeof ValidateResponseSchema>;
export type ExecuteResponse = z.infer<typeof ExecuteResponseSchema>;
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

export type NonceResponse = z.infer<typeof NonceResponseSchema>;
export type VerifyResponse = z.infer<typeof VerifyResponseSchema>;
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;

export type TokenAmount = z.infer<typeof TokenAmountSchema>;
export type StrategyStep = z.infer<typeof StrategyStepSchema>;
export type StrategyStatus = z.infer<typeof StrategyStatusSchema>;
export type StrategyHistoryEvent = z.infer<typeof StrategyHistoryEventSchema>;
export type StrategySummary = z.infer<typeof StrategySummarySchema>;
export type StrategyDetail = z.infer<typeof StrategyDetailSchema>;
export type StrategiesListResponse = z.infer<typeof StrategiesListResponseSchema>;
export type CreateStrategyRequest = z.infer<typeof CreateStrategyRequestSchema>;
export type CreateStrategyResponse = z.infer<typeof CreateStrategyResponseSchema>;
export type PatchStrategyRequest = z.infer<typeof PatchStrategyRequestSchema>;
export type PatchStrategyResponse = z.infer<typeof PatchStrategyResponseSchema>;
export type MarketsResponse = z.infer<typeof MarketsResponseSchema>;

export type PositionApi = z.infer<typeof PositionApiSchema>;
export type PositionsResponse = z.infer<typeof PositionsResponseSchema>;

export type PlanInput = z.infer<typeof PlanInputSchema>;
export type Suggestion = z.infer<typeof SuggestionSchema>;
export type RegistryToken = z.infer<typeof RegistryTokenSchema>;
export type RegistryMarket = z.infer<typeof RegistryMarketSchema>;
export type RegistryProtocol = z.infer<typeof RegistryProtocolSchema>;
export type RegistryChain = z.infer<typeof RegistryChainSchema>;
export type RegistryResponse = z.infer<typeof RegistryResponseSchema>;

export type SavedStrategy = z.infer<typeof SavedStrategySchema>;
export type SavedStrategiesListResponse = z.infer<typeof SavedStrategiesListResponseSchema>;
export type SaveStrategyRequest = z.infer<typeof SaveStrategyRequestSchema>;
export type SaveStrategyResponse = z.infer<typeof SaveStrategyResponseSchema>;
export type RenameSavedStrategyRequest = z.infer<typeof RenameSavedStrategyRequestSchema>;
export type RenameSavedStrategyResponse = z.infer<typeof RenameSavedStrategyResponseSchema>;
export type TouchSavedStrategyResponse = z.infer<typeof TouchSavedStrategyResponseSchema>;

export type PipelineStage =
  | "planner"
  | "resolver"
  | "validator"
  | "builder"
  | "simulator"
  | "executor"
  | "api";
