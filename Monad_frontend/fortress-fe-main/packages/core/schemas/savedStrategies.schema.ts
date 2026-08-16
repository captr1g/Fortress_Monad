import { z } from "zod";
import { PreviewSchema } from "./preview.schema";

// Mirrors prompt_2_defi's /fortress/saved-strategies rows.
export const SavedStrategySchema = z.object({
  id: z.string(),
  wallet: z.string(),
  name: z.string(),
  prompt: z.string(),
  preview: PreviewSchema,
  savedAt: z.string(),
  renamedAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
});

export const SavedStrategiesListResponseSchema = z.object({
  items: z.array(SavedStrategySchema),
});

export const SaveStrategyRequestSchema = z.object({
  walletAddress: z.string(),
  name: z.string(),
  prompt: z.string(),
  preview: PreviewSchema,
});

export const SaveStrategyResponseSchema = z.object({
  id: z.string(),
});

export const RenameSavedStrategyRequestSchema = z.object({
  walletAddress: z.string(),
  name: z.string(),
});

// The rename endpoint returns the updated row directly.
export const RenameSavedStrategyResponseSchema = SavedStrategySchema;

// The touch-usage endpoint also returns the updated row directly.
export const TouchSavedStrategyResponseSchema = SavedStrategySchema;
