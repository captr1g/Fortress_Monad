import { z } from "zod";

// Request schemas mirror prompt_2_defi/src/api/schemas.ts.

export const PlanRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.number().int().positive(),
  // Binding starting token (address) — the token the user actually holds.
  inputToken: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  // Optional metadata — echoed back on Preview, used when persisting to /strategies.
  name: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string()).optional(),
});

export const PlanIdRequestSchema = z.object({
  planId: z.string().min(1),
});
