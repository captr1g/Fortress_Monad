import { describe, it, expect } from "vitest";
import { encodeFunctionData } from "viem";
import { EvmSimulator } from "@chains/evm/simulator.js";
import { erc20Abi } from "@chains/evm/config/base_abi.js";
import type { EvmTransaction } from "@chains/evm/types.js";
import { describeIntegration, hasEnv } from "../../helpers/integration.js";
import { TOKENS, WALLETS, CONTRACTS, BASE_CHAIN_ID } from "../../datasets/base.js";

// Contract: Tenderly simulate-bundle still returns simulation_results[] with
// simulation.status and transaction.gas_used. EvmSimulator parses exactly these;
// drift would make every plan report a false failure or lose gas accounting.

describeIntegration("contract: Tenderly simulate-bundle", () => {
  it.skipIf(!hasEnv("TENDERLY_ACCESS_KEY", "TENDERLY_ACCOUNT_SLUG", "TENDERLY_PROJECT_SLUG"))(
    "simulates a real USDC approve and returns success + gas",
    async () => {
      const sim = new EvmSimulator({
        accessKey: process.env.TENDERLY_ACCESS_KEY!,
        accountSlug: process.env.TENDERLY_ACCOUNT_SLUG!,
        projectSlug: process.env.TENDERLY_PROJECT_SLUG!,
        timeoutMs: 60_000,
      });

      const approve: EvmTransaction = {
        to: TOKENS.USDC,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [CONTRACTS.LIFI_DIAMOND, 1_000_000n],
        }),
        value: 0n,
        chainId: BASE_CHAIN_ID,
      };

      const result = await sim.simulate([approve], WALLETS.sample);

      // The contract we depend on: a well-formed result object.
      expect(typeof result.success).toBe("boolean");
      expect(typeof result.gasUsed).toBe("bigint");
      // An ERC20 approve from any address should simulate successfully.
      expect(result.success).toBe(true);
      expect(result.gasUsed).toBeGreaterThan(0n);
    },
  );
});
