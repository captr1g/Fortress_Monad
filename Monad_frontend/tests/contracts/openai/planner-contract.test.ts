import { describe, it, expect } from "vitest";
import OpenAI from "openai";
import { describeIntegration, hasEnv } from "../../helpers/integration.js";

// Contract: OpenAI chat.completions with JSON mode still returns a single-choice
// response whose message.content is parseable JSON. This is exactly the shape
// FortressPlanner.extractIntent depends on — if OpenAI changes it, planning breaks.

describeIntegration("contract: OpenAI chat completions (JSON mode)", () => {
  it.skipIf(!hasEnv("OPENAI_API_KEY"))(
    "returns choices[0].message.content as valid JSON",
    async () => {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
      const model = process.env.OPENAI_MODEL ?? "gpt-4o";

      // Models like o1/o3-mini don't support temperature != 1.
      // Only set temperature: 0 for GPT-4o/GPT-4-series models.
      const supportsTemperature = !model.startsWith("o1") && !model.startsWith("o3");

      const res = await client.chat.completions.create({
        model,
        ...(supportsTemperature ? { temperature: 0 } : {}),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: 'Reply with a JSON object: {"ok": true}.' },
          { role: "user", content: "ping" },
        ],
      });

      expect(Array.isArray(res.choices)).toBe(true);
      expect(res.choices.length).toBeGreaterThan(0);
      const content = res.choices[0]?.message?.content;
      expect(typeof content).toBe("string");
      expect(() => JSON.parse(content as string)).not.toThrow();
    },
  );
});
