import { describe, it, expect } from "vitest";
import { z } from "zod";
import { describeIntegration } from "../../helpers/integration.js";
import { MONAD_CHAIN_ID } from "../../datasets/monad.js";

// Contract: the Morpho GraphQL markets query still returns items[].marketId and
// items[].state.{supplyApy,borrowApy,rewards[]}. MorphoAdapter.getRatesBatch reads
// exactly these; a schema change would make every Morpho APY resolve as unavailable.

const MORPHO_GRAPHQL = "https://api.morpho.org/graphql";

const ItemSchema = z.object({
  marketId: z.string(),
  state: z.object({
    supplyApy: z.number(),
    borrowApy: z.number(),
    rewards: z.array(z.object({ supplyApr: z.number(), borrowApr: z.number() })),
  }),
});

describeIntegration("contract: Morpho GraphQL markets", () => {
  it("returns the market rate shape our adapter parses", async () => {
    const query = `
      query ($chainIds: [Int!]!) {
        markets(where: { chainId_in: $chainIds }, first: 3, orderBy: SupplyAssetsUsd, orderDirection: Desc) {
          items {
            marketId
            state { supplyApy borrowApy rewards { supplyApr borrowApr } }
          }
        }
      }
    `;
    const res = await fetch(MORPHO_GRAPHQL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { chainIds: [MONAD_CHAIN_ID] } }),
    });
    expect(res.ok).toBe(true);

    const json = (await res.json()) as {
      data?: { markets: { items: unknown[] } };
      errors?: Array<{ message: string }>;
    };
    expect(json.errors).toBeUndefined();
    const items = json.data?.markets.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(() => ItemSchema.parse(item)).not.toThrow();
    }
  });
});
