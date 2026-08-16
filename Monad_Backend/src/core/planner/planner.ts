//This is where plans are created using openAI initiated in boot.ts

import OpenAI from "openai";
import {
  IntentEnvelopeSchema,
  type IntentEnvelope,
} from "./intent-envelope.js";
import {
  assembleSystemPrompt,
  type AssemblyContext,
} from "./prompt-assembler.js";
import type { TokenInfo } from "../registry/index.js";

export type PlannerConfig = {
  apiKey: string;
  model: string;
  baseURL?: string;
  timeoutMs?: number;
  /**
   * Additional model IDs to try, in order, on the same client (OpenRouter)
   * before giving up on the free tier — free models get saturated by
   * aggregate demand from every OpenRouter user hitting that model, not just
   * this app's own traffic, so a single free model 429ing doesn't mean the
   * whole tier is down.
   */
  fallbackModels?: string[];
  /**
   * A different provider entirely, tried only after every model above has
   * failed — e.g. the original paid OpenAI key, so a bad day for OpenRouter's
   * free tier degrades to "cost a little" instead of "the request fails."
   */
  finalFallback?: { apiKey: string; model: string; baseURL?: string };
};

export type PlannerOptions = {
  inputToken?: TokenInfo;
};

type Attempt = { client: OpenAI; model: string; label: string };

// gpt-5/gpt-5.x models (nano/mini/pro/etc, dated or "-latest" aliases) only
// accept the default temperature — verified live: passing 0 gets a 400.
function isGpt5Family(model: string): boolean {
  return /^gpt-5(\.\d+)?(-|$)/.test(model);
}

// gpt-5-nano is a reasoning model — verified live, it can spend 40+ seconds
// of reasoning on a complex multi-step strategy prompt before answering
// (vs. gpt-4o's much faster, non-reasoning response). The old 30s default
// was tuned for gpt-4o and intermittently timed out gpt-5-nano on exactly
// this kind of prompt, right when the free-tier cascade above it was
// already exhausted — i.e. the one path that's supposed to never fail.
const DEFAULT_TIMEOUT_MS = 90_000;

// The gpt-5 family can't be pinned to temperature 0 (see below), so it's the
// one model in the fallback chain that isn't already deterministic. `seed`
// is OpenAI's other determinism lever — best-effort, not a hard guarantee,
// but it fixes the sampling RNG so the same prompt tends to reproduce the
// same output instead of varying run to run. Harmless to send on every
// attempt: for the temperature-0 models it's a no-op on top of already-
// deterministic decoding.
const DETERMINISTIC_SEED = 42;

export class Planner {
  private readonly attempts: Attempt[];

  constructor(config: PlannerConfig) {
    const defaultHeaders = config.baseURL?.includes("openrouter")
      ? {
          "HTTP-Referer": "https://fortress.finance",
          "X-Title": "Fortress",
        }
      : undefined;

    const primaryClient = new OpenAI({
      apiKey: config.apiKey.trim(),
      // Explicit default for the same reason as finalFallback below — never let the
      // SDK fall through to reading process.env.OPENAI_BASE_URL implicitly.
      baseURL: config.baseURL || "https://api.openai.com/v1",
      defaultHeaders,
      timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });

    this.attempts = [
      { client: primaryClient, model: config.model, label: config.model },
      ...(config.fallbackModels ?? []).map((model) => ({
        client: primaryClient,
        model,
        label: model,
      })),
    ];

    if (config.finalFallback) {
      // Must be explicit: the OpenAI SDK falls back to reading process.env.OPENAI_BASE_URL
      // when baseURL is undefined, which is set to OpenRouter's URL for the primary client
      // above — an unset finalFallback.baseURL would silently inherit that and send this
      // (OpenAI-keyed) client's requests to OpenRouter instead of OpenAI.
      const fallbackClient = new OpenAI({
        apiKey: config.finalFallback.apiKey.trim(),
        baseURL: config.finalFallback.baseURL || "https://api.openai.com/v1",
        timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      this.attempts.push({
        client: fallbackClient,
        model: config.finalFallback.model,
        label: `${config.finalFallback.model} (fallback provider)`,
      });
    }
  }

  // Input user prompt, Assctx, opts and from them first assemble system prompt(Assctx), then feed model with 
  // {Systemprompt + userprompt} and safeparse the intent using intent-envelope before returning
  async extractIntent(
    prompt: string,
    ctx: AssemblyContext,
    opts?: PlannerOptions,
  ): Promise<IntentEnvelope> {
    const systemContent = assembleSystemPrompt(ctx);
    let userContent = prompt;
    if (opts?.inputToken) {
      userContent += `\n\nINPUT TOKEN CONSTRAINT: The user holds only ${opts.inputToken.symbol} (${opts.inputToken.address}, ${opts.inputToken.decimals} decimals). The plan MUST start from this token.`;
    }

    let response;
    let lastMessage = "";
    for (const attempt of this.attempts) {
      try {
        response = await attempt.client.chat.completions.create({
          model: attempt.model,
          // The gpt-5 family only supports the default temperature (1) — passing
          // 0 (what every other model here wants, for deterministic planning)
          // gets rejected outright with a 400. Omit it for that family so the
          // API falls back to its own default instead of erroring.
          ...(isGpt5Family(attempt.model) ? {} : { temperature: 0 }),
          // Intent extraction is a structured-mapping task, not something that
          // benefits from gpt-5's default (much deeper) reasoning depth — that
          // default is what was costing 40+ seconds per request. "low" cut
          // latency/cost the most but occasionally mis-picked a token on
          // complex multi-loop strategy prompts (gpt-5 can't be pinned to
          // temperature 0, so output isn't fully deterministic even at a
          // fixed seed). "medium" trades a bit of that latency/cost saving
          // back for reliability on those harder prompts.
          ...(isGpt5Family(attempt.model) ? { reasoning_effort: "medium" as const } : {}),
          seed: DETERMINISTIC_SEED,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemContent },
            { role: "user", content: userContent },
          ],
        });
        break;
      } catch (err: unknown) {
        lastMessage = err instanceof Error ? err.message : String(err);
        console.error(`[planner] ${attempt.label} failed, trying next:`, lastMessage);
      }
    }

    if (!response) {
      return {
        domain: "system",
        chainKey: ctx.chainKey,
        action: "refuse",
        payload: { reason: `Planner unavailable: ${lastMessage}` },
      };
    }

    const raw = response.choices[0]?.message?.content;
    if (!raw) {
      return {
        domain: "system",
        chainKey: ctx.chainKey,
        action: "refuse",
        payload: { reason: "Could not understand your request. Please try again." },
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("[planner] Model returned non-JSON:", raw);
      return {
        domain: "system",
        chainKey: ctx.chainKey,
        action: "refuse",
        payload: { reason: "Failed to parse intent. Please rephrase your request." },
      };
    }

    const result = IntentEnvelopeSchema.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      const detail = issue?.path?.join(".") + ": " + issue?.message;
      console.error("[planner] Envelope validation failed:", detail, "\nraw:", JSON.stringify(parsed));
      return {
        domain: "system",
        chainKey: ctx.chainKey,
        action: "refuse",
        payload: { reason: `Invalid intent structure: ${detail}` },
      };
    }

    return result.data;
  }
}
