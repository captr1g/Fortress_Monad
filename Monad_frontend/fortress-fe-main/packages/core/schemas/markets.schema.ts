import { z } from "zod";

// GET /apy/markets — backend returns DB rows whose exact columns may evolve,
// so we keep this permissive and let callers narrow as needed.
export const MarketsResponseSchema = z.object({
  markets: z.array(z.record(z.string(), z.unknown())),
});
