/**
 * Fortress Markdown Test Reporter
 *
 * Generates a self-contained .md report per run at tests/reports/
 * Institutional grade: concise, scannable, shows what was probed and how code reacted.
 *
 * Each test row shows:
 *   - Test name (what was sent / what operation was invoked)
 *   - Result state
 *   - Duration (latency = real service round-trip for integration tier)
 *   - Code reaction (OK, error message, or skip reason)
 *
 * Report sections:
 *   1. Executive summary (verdict, counts, timing)
 *   2. Failures (if any — immediate triage section)
 *   3. Results grouped by category (unit/property/fuzz/contract/integration/api/regression/snapshot)
 */
import { writeFileSync, mkdirSync, existsSync, symlinkSync, unlinkSync } from "node:fs";
import { join, relative } from "node:path";
import type { Reporter } from "vitest/reporters";
import type { TestCase, TestModule, TestSuite } from "vitest/node";

type TestEntry = {
  name: string;
  file: string;
  suite: string;
  category: string;
  state: string;
  duration: number;
  error?: string;
};

const CATEGORY_ORDER = ["unit", "property", "fuzz", "regression", "snapshot", "contract", "integration", "api", "e2e", "other"];

function categorize(file: string): string {
  if (file.includes("tests/unit/")) return "unit";
  if (file.includes("tests/property/")) return "property";
  if (file.includes("tests/fuzz/")) return "fuzz";
  if (file.includes("tests/regression/")) return "regression";
  if (file.includes("tests/snapshots/")) return "snapshot";
  if (file.includes("tests/contracts/")) return "contract";
  if (file.includes("tests/integration/")) return "integration";
  if (file.includes("tests/api/")) return "api";
  if (file.includes("tests/e2e/")) return "e2e";
  if (file.includes("src/")) return "unit";
  return "other";
}

function tierLabel(cat: string): string {
  switch (cat) {
    case "unit": return "Unit (deterministic, no I/O)";
    case "property": return "Property (fast-check invariants)";
    case "fuzz": return "Fuzz (adversarial inputs)";
    case "regression": return "Regression (pinned bugs)";
    case "snapshot": return "Snapshot (pinned outputs)";
    case "contract": return "Contract (external API schema guards — REAL calls)";
    case "integration": return "Integration (full pipeline — REAL calls)";
    case "api": return "API (Fastify app.inject — REAL calls)";
    case "e2e": return "E2E (full boot — REAL calls)";
    default: return cat;
  }
}

export default class MdReporter implements Reporter {
  private entries: TestEntry[] = [];
  private startTime = Date.now();
  private moduleDurations = new Map<string, number>();
  private testStartTimes = new Map<string, number>();

  onTestModuleEnd(testModule: TestModule): void {
    const filePath = relative(process.cwd(), testModule.moduleId);
    try {
      const diag = (testModule as any).diagnostic;
      const dur = typeof diag === "object" && diag !== null ? diag.duration : undefined;
      if (typeof dur === "number" && dur > 0) this.moduleDurations.set(filePath, dur);
    } catch { /* graceful fallback */ }
  }

  onTestCaseReady(testCase: TestCase): void {
    this.testStartTimes.set(testCase.id, Date.now());
  }

  onTestCaseResult(testCase: TestCase): void {
    const mod = testCase.module;
    const filePath = mod ? relative(process.cwd(), mod.moduleId) : "unknown";
    const suiteName = this.buildSuitePath(testCase);
    const result = testCase.result();
    const state = result.state ?? "unknown";

    // Prefer the timing from onTestCaseReady if vitest's own duration is 0.
    let duration = result.duration ?? 0;
    if (duration === 0) {
      const start = this.testStartTimes.get(testCase.id);
      if (start) duration = Date.now() - start;
    }

    let error: string | undefined;
    if (state === "failed") {
      const errs = result.errors ?? [];
      error = errs.map((e: { message?: string }) => e.message ?? "unknown").join("; ");
      if (error.length > 250) error = error.slice(0, 247) + "...";
    }

    this.entries.push({
      name: testCase.name,
      file: filePath,
      suite: suiteName,
      category: categorize(filePath),
      state,
      duration,
      error,
    });
  }

  onTestRunEnd(): void {
    const totalMs = Date.now() - this.startTime;
    const passed = this.entries.filter((e) => e.state === "passed").length;
    const failed = this.entries.filter((e) => e.state === "failed").length;
    const skipped = this.entries.filter((e) => e.state === "skipped").length;
    const total = this.entries.length;
    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);

    const dir = join(process.cwd(), "tests", "reports");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const filename = `test-report-${ts}.md`;
    const filepath = join(dir, filename);
    const latestPath = join(dir, "latest.md");

    const md = this.buildReport({ total, passed, failed, skipped, totalMs, now });
    writeFileSync(filepath, md, "utf-8");

    try { unlinkSync(latestPath); } catch { /* */ }
    try { symlinkSync(filename, latestPath); } catch { /* */ }
  }

  private buildSuitePath(testCase: TestCase): string {
    const parts: string[] = [];
    let parent: TestSuite | TestModule | undefined = testCase.parent;
    while (parent && "name" in parent && parent.name) {
      parts.unshift(parent.name);
      parent = "parent" in parent ? (parent as TestSuite).parent : undefined;
    }
    return parts.join(" > ") || "(root)";
  }

  private buildReport(stats: {
    total: number; passed: number; failed: number; skipped: number; totalMs: number; now: Date;
  }): string {
    const { total, passed, failed, skipped, totalMs, now } = stats;
    const verdict = failed === 0 ? "✅ ALL PASS" : `❌ ${failed} FAILURE(S)`;
    const L: string[] = [];

    // --- Header ---
    L.push("# Fortress Backend — Test Report");
    L.push("");
    L.push("| Field | Value |");
    L.push("|-------|-------|");
    L.push(`| Verdict | **${verdict}** |`);
    L.push(`| Date | ${now.toISOString()} |`);
    L.push(`| Duration | ${(totalMs / 1000).toFixed(2)}s |`);
    L.push(`| Total | ${total} |`);
    L.push(`| Passed | ${passed} |`);
    L.push(`| Failed | ${failed} |`);
    L.push(`| Skipped | ${skipped} |`);
    L.push("");

    // --- Failures (triage section) ---
    if (failed > 0) {
      L.push("## ❌ Failures (requires immediate attention)");
      L.push("");
      for (const e of this.entries.filter((x) => x.state === "failed")) {
        L.push(`- **${esc(e.name)}** (\`${e.file}\`)`);
        L.push(`  - Reaction: \`${esc(e.error ?? "unknown")}\``);
      }
      L.push("");
    }

    // --- Results by category ---
    const grouped = new Map<string, TestEntry[]>();
    for (const e of this.entries) {
      const arr = grouped.get(e.category) ?? [];
      arr.push(e);
      grouped.set(e.category, arr);
    }

    for (const cat of CATEGORY_ORDER) {
      const tests = grouped.get(cat);
      if (!tests || tests.length === 0) continue;
      const cp = tests.filter((t) => t.state === "passed").length;
      const cf = tests.filter((t) => t.state === "failed").length;
      const cs = tests.filter((t) => t.state === "skipped").length;
      const badge = cf > 0 ? "❌" : "✅";

      L.push(`## ${badge} ${tierLabel(cat)} — ${cp}/${tests.length} passed`);
      L.push("");

      // Sub-group by file within this category
      const byFile = new Map<string, TestEntry[]>();
      for (const t of tests) {
        const a = byFile.get(t.file) ?? [];
        a.push(t);
        byFile.set(t.file, a);
      }

      for (const [file, fileTests] of byFile) {
        const ffp = fileTests.filter((t) => t.state === "passed").length;
        const fff = fileTests.filter((t) => t.state === "failed").length;
        const fileBadge = fff > 0 ? "❌" : "✅";
        const sumDur = this.moduleDurations.get(file) ?? fileTests.reduce((s, t) => s + t.duration, 0);
        const modDurStr = sumDur > 0 ? ` — ${sumDur >= 1000 ? (sumDur / 1000).toFixed(1) + "s" : sumDur + "ms"}` : "";
        L.push(`### ${fileBadge} \`${file}\`${modDurStr}`);
        L.push("");
        L.push("| | Test (what was sent) | Time | Reaction (how code responded) |");
        L.push("|:-:|------|-----:|------|");
        for (const t of fileTests) {
          const icon = t.state === "passed" ? "✅" : t.state === "failed" ? "❌" : "⏭️";
          const dur = t.duration >= 1000 ? `${(t.duration / 1000).toFixed(1)}s` : `${t.duration.toFixed(0)}ms`;
          const reaction = t.error
            ? `**FAIL:** ${esc(t.error)}`
            : t.state === "passed"
              ? "Code executed correctly"
              : "Skipped";
          L.push(`| ${icon} | ${esc(t.name)} | ${dur} | ${reaction} |`);
        }
        L.push("");
      }
    }

    // --- Footer ---
    L.push("---");
    L.push("");
    L.push("*Report auto-generated by `tests/reporters/md-report.ts`*");
    return L.join("\n");
  }
}

function esc(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ").replace(/\r/g, "");
}
