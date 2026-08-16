// Define the capabilities which a {ChainXDomainXProtocol} should have
// set these in boot.ts

import type { Capability } from "./types.js";

const CAPABILITIES: Capability[] = [];

export function registerCapability(cap: Capability): void {
  CAPABILITIES.push(cap);
}

export function registerCapabilities(caps: Capability[]): void {
  for (const cap of caps) CAPABILITIES.push(cap);
}

export function getCapabilities(filter?: {
  chainKey?: string;
  domain?: string;
}): Capability[] {
  if (!filter) return [...CAPABILITIES];
  return CAPABILITIES.filter((c) => {
    if (filter.chainKey && c.chainKey !== filter.chainKey) return false;
    if (filter.domain && c.domain !== filter.domain) return false;
    return true;
  });
}

export function isSupported(
  chainKey: string,
  domain: string,
  protocol?: string,
): boolean {
  return CAPABILITIES.some((c) => {
    if (c.chainKey !== chainKey || c.domain !== domain) return false;
    if (protocol && c.protocol !== protocol) return false;
    return true;
  });
}

export function getProtocolsForChain(
  chainKey: string,
  domain: string,
): string[] {
  return CAPABILITIES.filter(
    (c) => c.chainKey === chainKey && c.domain === domain,
  ).map((c) => c.protocol);
}

export function getPromptFragments(chainKey: string, domain: string): string[] {
  return CAPABILITIES.filter(
    (c) => c.chainKey === chainKey && c.domain === domain && c.promptFragment,
  ).map((c) => c.promptFragment!);
}
