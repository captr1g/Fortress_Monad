// Tenderly bundle simulator for EVM chains. Sends all transactions as a bundle to Tenderly's simulation API and reports aggregated success/gas/error.
import type { Address } from "viem";
import type {
  TenderlyConfig,
  EvmSimulationResult,
  EvmTransaction,
} from "./types.js";
import { decodeRevertData, decodeRevertFromResult } from "./helper/revert-decoder.js";

export class EvmSimulator {
  private readonly config: TenderlyConfig;

  constructor(config: TenderlyConfig) {
    this.config = config;
  }

  async simulate(
    txs: EvmTransaction[],
    from: Address,
  ): Promise<EvmSimulationResult> {
    if (txs.length === 0) return { success: true, gasUsed: 0n };

    const simulations = txs.map((tx) => ({
      network_id: String(tx.chainId),
      from,
      to: tx.to,
      input: tx.data,
      value: tx.value.toString(),
      save: false,
      save_if_fails: true,
      simulation_type: "full",
    }));

    const url = `https://api.tenderly.co/api/v1/account/${this.config.accountSlug}/project/${this.config.projectSlug}/simulate-bundle`;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? 30_000,
    );

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
        return {
          success: false,
          gasUsed: 0n,
          error: `Tenderly ${res.status}: ${summarizeError(body)}`,
        };
      }

      const json = (await res.json()) as {
        simulation_results: Array<{
          simulation?: { status?: boolean; error_message?: string };
          transaction?: {
            gas_used?: number;
            status?: boolean;
            error_message?: string;
            error_info?: { error_message?: string; address?: string };
          };
        }>;
      };

      const total = json.simulation_results.length;
      let totalGas = 0n;
      for (let i = 0; i < total; i++) {
        const result = json.simulation_results[i];
        const failed =
          result.simulation?.status === false ||
          result.transaction?.status === false;

        if (failed) {
          const stepLabel = total > 1 ? ` (step ${i + 1}/${total})` : "";

          // First choice: decode the raw revert data ourselves using the
          // Fortress error ABIs. Tenderly reports custom errors as a bare
          // "execution reverted" but leaves the 0x selector+args somewhere in
          // the result (error_info, call trace output, nested calls). Scanning
          // the whole result for a decodable blob turns "no reason string" into
          // the actual named error — the single most useful debugging signal.
          const decoded = decodeRevertFromResult(result);
          if (decoded) {
            return {
              success: false,
              gasUsed: totalGas + BigInt(result.transaction?.gas_used ?? 0),
              error: `${decoded}${stepLabel}`,
            };
          }

          // Fallback: the string reason Tenderly gives us, mapped to a friendly
          // form for the standard cases.
          const rawError =
            result.transaction?.error_info?.error_message ??
            result.transaction?.error_message ??
            result.simulation?.error_message ??
            "reverted without a reason string";
          return {
            success: false,
            gasUsed: totalGas + BigInt(result.transaction?.gas_used ?? 0),
            error: `${humanizeSimError(rawError)}${stepLabel}`,
          };
        }
        totalGas += BigInt(result.transaction?.gas_used ?? 0);
      }

      return { success: true, gasUsed: totalGas };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return { success: false, gasUsed: 0n, error: "Simulation timed out" };
      }
      return { success: false, gasUsed: 0n, error: String(err) };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function summarizeError(body: string): string {
  if (!body) return "no response body";
  try {
    const json = JSON.parse(body) as {
      error?: { message?: string };
      message?: string;
    };
    const msg = json.error?.message ?? json.message;
    if (msg) return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
  } catch {
    /* not JSON */
  }
  return body.length > 200 ? `${body.slice(0, 200)}…` : body;
}

function humanizeSimError(raw: string): string {
  // If the reason string itself carries a raw revert blob (0x selector+args),
  // decode it against the Fortress error ABIs first.
  const blob = raw.match(/0x[0-9a-fA-F]{8,}/)?.[0];
  if (blob) {
    const decoded = decodeRevertData(blob as `0x${string}`);
    if (decoded) return decoded;
  }

  // Try to parse JSON error objects from Tenderly
  try {
    const parsed = JSON.parse(raw) as { msg?: string; message?: string; slug?: string };
    const msg = parsed.msg ?? parsed.message;
    if (msg) return mapKnownError(msg);
  } catch {
    /* plain string */
  }
  return mapKnownError(raw);
}

function mapKnownError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("transfer amount exceeds balance"))
    return "Insufficient token balance — the wallet does not hold enough to execute this transaction.";
  if (lower.includes("insufficient allowance") || lower.includes("erc20: insufficient-allowance"))
    return "Token approval insufficient — the approve step did not grant enough allowance.";
  if (lower.includes("slippage") || lower.includes("min amount") || lower.includes("minamountout") || lower.includes("too little received") || lower.includes("insufficient output"))
    return `Swap output below the minimum — the DEX returned less than the slippage floor. (${msg})`;
  if (lower.includes("deadline") || lower.includes("expired"))
    return "Transaction deadline expired — the LiFi route data is stale. Rebuild the plan and sign immediately.";
  // We reach here only when custom-error decoding already failed (no revert
  // data was available to decode). Be honest that the reason is unknown rather
  // than guessing a cause — the decoder above names the error whenever the
  // simulator returns any revert bytes.
  if (lower.includes("execution reverted") && !lower.includes(":")) {
    return "Execution reverted, and the simulator returned no revert data to decode. If this persists, rebuild the plan (routes may be stale) or try a larger amount.";
  }
  return msg;
}
