// Here we build up the prompt required for (domain X chain)
import {
  getChainByKey,
  findToken,
  listChains,
  getProtocolsForChain,
  type ChainInfo,
} from "../registry/index.js";
import type { DomainModule } from "@domains/yield/index.js";

export type AssemblyContext = {
  chainKey: string;
  domains: Map<string, DomainModule>;
  configProtocols?: string[];  // Protocol names from chain config (EVM protocol registry, e.g. Morpho, Aave, Fluid...)
  // Current supply rates, read from a Redis cache a background warmer keeps
  // fresh (see vault-apy-warmer.ts) — never fetched live during assembly.
  // Omitted for any protocol with no cached value yet, never guessed.
  rates?: { name: string; apy: number }[];
};

// get chain info using chainRegistery, get protocols using capabilitiesRegistery, get the fragmented prompt for the domain and then return the final SystemPrompt
export function assembleSystemPrompt(ctx: AssemblyContext): string {
  const chain = getChainByKey(ctx.chainKey);
  if (!chain) {
    return "You are a DeFi assistant. The requested chain is not registered.";
  }

  const sections: string[] = [];
  sections.push(buildCoreHeader());
  sections.push(buildChainDataSection(chain));

  if (ctx.rates && ctx.rates.length > 0) {
    sections.push(buildRatesSection(ctx.rates));
  }

  // Pull prompt fragments from each registered domain
  for (const [domainName, domainModule] of ctx.domains) {
    const protocols =
      ctx.configProtocols ?? getProtocolsForChain(ctx.chainKey, domainName);
    if (protocols.length === 0) continue;
    const fragment = domainModule.promptFragment(chain, protocols);
    if (fragment) sections.push(fragment);
  }

  sections.push(buildResponseInstructions(ctx.chainKey));

  return sections.join("\n\n---\n\n");
}

// A snapshot, not a promise — the model should use it to judge which
// protocol pays more when the user is vague ("best yield", "highest
// return"), never to override a protocol the user actually named.
function buildRatesSection(rates: { name: string; apy: number }[]): string {
  const sorted = [...rates].sort((a, b) => b.apy - a.apy);
  const lines = sorted.map((r) => `- ${r.name}: ${(r.apy * 100).toFixed(2)}%`);
  return `CURRENT SUPPLY RATES (snapshot, sorted highest first):
${lines.join("\n")}
Use this only to judge which protocol currently pays more when the user is vague about which one they want (e.g. "best yield", "highest return", "whatever pays the most"). Never use it to override a protocol the user actually named. A protocol missing from this list has no current rate available — don't guess one, and don't rank it above or below the listed protocols.`;
}

function buildCoreHeader(): string {
  return `You are the FORTRESS DeFi intent extractor. Given a user's natural language request, extract a structured JSON intent.

Always respond with ONLY valid JSON matching the schema. No markdown, no explanation.`;
}

function buildChainDataSection(chain: ChainInfo): string {
  const lines: string[] = [];
  lines.push(`TARGET CHAIN: ${chain.label} (chainId: ${chain.chainId})`);
  lines.push("");
  lines.push(buildChainIds());
  lines.push("");
  lines.push(buildTokenTable(chain));
  lines.push("");
  lines.push(buildAmountRules(chain));
  return lines.join("\n");
}

function buildChainIds(): string {
  return `CHAIN IDs:\n${listChains().map((c) => `- ${c.label}: ${c.chainId}`).join("\n")}`;
}

function buildTokenTable(chain: ChainInfo): string {
  const lines = chain.tokens.map(
    (t) => `- ${t.symbol} (${t.decimals}dp): ${t.address}`,
  );
  return `TOKEN ADDRESSES (${chain.label}, chainId ${chain.chainId}):\n${lines.join("\n")}`;
}

function buildAmountRules(chain: ChainInfo): string {
  const usdc = findToken(chain.chainKey, chain.loanToken);
  const weth = findToken(chain.chainKey, "WETH");
  const examples: string[] = [];
  if (usdc)
    examples.push(
      `"500 ${usdc.symbol}" = "${5n * 10n ** BigInt(usdc.decimals + 2)}" (${usdc.decimals} decimals)`,
    );
  if (weth)
    examples.push(
      `"1 ETH" = "${10n ** BigInt(weth.decimals)}" (${weth.decimals} decimals)`,
    );
  const decimalNotes = chain.tokens
    .filter((t) => t.symbol !== chain.loanToken && t.symbol !== "WETH")
    .map((t) => `${t.symbol} has ${t.decimals} decimals`)
    .join(". ");
  const defaultAmount = usdc ? (10n * 10n ** BigInt(usdc.decimals)).toString() : undefined;
  return `AMOUNT RULES:
- Amounts MUST be in smallest units. ${examples.join(". ")}.
- ${decimalNotes}.
- If the user explicitly says "all" or "everything", use "0" to signal max (backend resolves from the live wallet balance).
- If the user does not mention an amount at all — no number, no "all"/"everything" — default the amount to${
    defaultAmount ? ` 10 ${usdc!.symbol} ("${defaultAmount}")` : " a small placeholder amount"
  }. Do NOT use "0" for this case — "0" is reserved exclusively for an explicit "all"/"everything" request.`;
}

function buildResponseInstructions(chainKey: string): string {
  return `RESPONSE FORMAT:
Your response MUST be a JSON object with these top-level fields:
{
  "domain": "yield",
  "chainKey": "${chainKey}",
  "action": "<action>",
  "payload": { "action": "<same action>", ... all other fields from PAYLOAD SCHEMA ... }
}

CRITICAL: The "action" field MUST appear in BOTH the top level AND inside "payload". The payload must be a complete, self-contained intent object matching the PAYLOAD SCHEMA exactly.

If the request cannot be fulfilled:
{ "domain": "yield", "chainKey": "${chainKey}", "action": "refuse", "payload": { "action": "refuse", "reason": "..." } }`;
}
