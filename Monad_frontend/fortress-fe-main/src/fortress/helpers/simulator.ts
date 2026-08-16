import type { UnsignedTransaction } from "./builder.js";

export type SimulationResult = {
  success: boolean;
  gasUsed: bigint;
  error?: string;
  logs: unknown[];
};

type TenderlySimConfig = {
  accessKey: string;
  accountSlug: string;
  projectSlug: string;
  timeoutMs?: number;
};

export class FortressSimulator {
  private readonly config: TenderlySimConfig;

  constructor(config: TenderlySimConfig) {
    this.config = config;
  }

  async simulate(txs: UnsignedTransaction[], from: `0x${string}`): Promise<SimulationResult> {
    const simulations = txs.map((tx) => ({
      network_id: String(tx.chainId),
      from,
      to: tx.to,
      input: tx.data,
      value: tx.value.toString(),
      save: false,
      save_if_fails: true,
      simulation_type: "full",
      state_objects: {},
    }));

    const url = `https://api.tenderly.co/api/v1/account/${this.config.accountSlug}/project/${this.config.projectSlug}/simulate-bundle`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 30_000);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "X-Access-Key": this.config.accessKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ simulations }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { success: false, gasUsed: 0n, error: `Tenderly ${res.status}: ${body}`, logs: [] };
      }

      const json = await res.json() as {
        simulation_results: Array<{
          simulation: { status?: boolean; error_message?: string };
          transaction: { gas_used?: number; transaction_info?: unknown };
        }>;
      };

      let totalGas = 0n;
      const logs: unknown[] = [];

      for (const result of json.simulation_results) {
        if (result.simulation.status === false) {
          return {
            success: false,
            gasUsed: totalGas,
            error: result.simulation.error_message ?? "Transaction reverted",
            logs,
          };
        }
        totalGas += BigInt(result.transaction.gas_used ?? 0);
        if (result.transaction.transaction_info) {
          logs.push(result.transaction.transaction_info);
        }
      }

      return { success: true, gasUsed: totalGas, logs };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return { success: false, gasUsed: 0n, error: "Simulation timed out", logs: [] };
      }
      return { success: false, gasUsed: 0n, error: String(err), logs: [] };
    } finally {
      clearTimeout(timeout);
    }
  }
}
