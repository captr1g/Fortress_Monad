type LogLevel = "info" | "warn" | "error" | "debug";

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  bold: "\x1b[1m",
};

const LEVEL_COLOR: Record<LogLevel, string> = {
  info: COLORS.cyan,
  warn: COLORS.yellow,
  error: COLORS.red,
  debug: COLORS.dim,
};

export type LogSource = { route?: string; file?: string; fn?: string };

function truncate(s: string, max = 200): string {
  return s.length > max ? `${s.slice(0, max)}…(${s.length} chars)` : s;
}

export class FortressLogger {
  private source: LogSource = {};
  private headerPrinted = false;

  constructor(private readonly requestId: string) { }

  static newRequest(): FortressLogger {
    const id = Math.random().toString(36).slice(2, 8);
    return new FortressLogger(id);
  }

  at(source: LogSource): this {
    this.source = { ...this.source, ...source };
    return this;
  }

  private printHeader(): void {
    if (this.headerPrinted) return;
    this.headerPrinted = true;
    const id = `${COLORS.cyan}[fortress:${this.requestId}]${COLORS.reset}`;
    const src: string[] = [];
    if (this.source.route)
      src.push(`${COLORS.bold}${this.source.route}${COLORS.reset}`);
    if (this.source.file)
      src.push(`${COLORS.dim}${this.source.file}${COLORS.reset}`);
    const ctx = src.join(" · ");
    const fn = this.source.fn
      ? ` ${COLORS.dim}›${COLORS.reset} ${this.source.fn}()`
      : "";
    console.log(`${COLORS.dim}┌${COLORS.reset} ${id} ${ctx}${fn}`);
  }

  private step(
    level: LogLevel,
    label: string,
    detail?: string,
    last = false,
  ): void {
    this.printHeader();
    const bar = `${COLORS.dim}${last ? "└" : "│"}${COLORS.reset}`;
    const color = LEVEL_COLOR[level];
    const tag = `${color}${label.padEnd(10)}${COLORS.reset}`;
    const tail = detail ? `${COLORS.dim}${detail}${COLORS.reset}` : "";
    console.log(`${bar} ${tag} ${tail}`.trimEnd());
  }

  prompt(text: string): void {
    this.step(
      "info",
      "PROMPT",
      `"${truncate(text.replace(/\s+/g, " ").trim(), 140)}"`,
    );
  }

  intent(intent: unknown): void {
    const i = intent as Record<string, unknown> | null;
    const action = (i?.action as string) ?? "unknown";
    const bits: string[] = [action];
    if (i && "inputToken" in i)
      bits.push(`in=${short(i.inputToken as string)}`);
    if (i && "targetLtv" in i && i.targetLtv != null)
      bits.push(`ltv=${i.targetLtv}`);
    if (i && Array.isArray((i as { steps?: unknown[] }).steps)) {
      bits.push(`steps=${(i as { steps: unknown[] }).steps.length}`);
    }
    this.step("info", "INTENT", bits.join(" · "));
  }

  action(_action: string): void { }

  transactions(txs: unknown): void {
    const arr = Array.isArray(txs) ? (txs as Array<{ to?: string }>) : [];
    const tos = arr.map((t) => short(t.to ?? "?")).join(", ");
    this.step("info", "TX BUILT", `${arr.length} → ${tos}`);
  }

  simulation(result: unknown): void {
    const r = result as {
      success?: boolean;
      gasUsed?: unknown;
      error?: string | null;
    };
    const ok = r?.success
      ? `${COLORS.green}ok${COLORS.reset}`
      : `${COLORS.red}fail${COLORS.reset}`;
    const parts = [ok];
    if (r?.gasUsed != null) parts.push(`gas=${fmtGas(r.gasUsed)}`);
    if (r?.error) parts.push(`error="${truncate(r.error, 120)}"`);
    this.step("info", "SIMULATION", parts.join(" · "), true);
  }

  refuse(reason: string): void {
    this.step("warn", "REFUSED", truncate(reason, 160), true);
  }

  error(label: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.step("error", label, truncate(message, 200), true);
  }
}

function short(addr: string): string {
  if (typeof addr !== "string" || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtGas(gas: unknown): string {
  try {
    return BigInt(String(gas)).toLocaleString("en-US");
  } catch {
    return String(gas);
  }
}
