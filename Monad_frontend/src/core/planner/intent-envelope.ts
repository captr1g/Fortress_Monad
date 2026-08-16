// Intent Envelope to safe parse LLM response
import { z } from "zod";

export const IntentEnvelopeSchema = z.object({
  domain: z.string().min(1),
  chainKey: z.string().min(1),
  action: z.string().min(1),
  payload: z.unknown(),
});

export type IntentEnvelope = z.infer<typeof IntentEnvelopeSchema>;

export function createEnvelope(
  domain: string,
  chainKey: string,
  action: string,
  payload: unknown,
): IntentEnvelope {
  return { domain, chainKey, action, payload };
}

export function isRefusal(envelope: IntentEnvelope): boolean {
  return envelope.action === "refuse";
}
