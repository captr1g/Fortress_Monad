type LogLevel = "info" | "warn" | "error" | "debug";

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

const LEVEL_COLOR: Record<LogLevel, string> = {
  info: COLORS.cyan,
  warn: COLORS.yellow,
  error: COLORS.red,
  debug: COLORS.dim,
};

function serialize(value: unknown): string {
  return JSON.stringify(
    value,
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
}

export class FortressLogger {
  constructor(private readonly requestId: string) {}

  static newRequest(): FortressLogger {
    const id = Math.random().toString(36).slice(2, 8);
    return new FortressLogger(id);
  }

  private write(level: LogLevel, label: string, payload?: unknown): void {
    const color = LEVEL_COLOR[level];
    const tag = `${color}[fortress:${this.requestId}]${COLORS.reset}`;
    const heading = `${COLORS.magenta}${label}${COLORS.reset}`;
    if (payload === undefined) {
      console.log(`${tag} ${heading}`);
    } else {
      console.log(`${tag} ${heading}\n${COLORS.dim}${serialize(payload)}${COLORS.reset}`);
    }
  }

  prompt(text: string): void {
    this.write("info", "PROMPT", text);
  }

  intent(intent: unknown): void {
    this.write("info", "INTENT JSON", intent);
  }

  action(action: string): void {
    this.write("info", `ACTION → ${action}`);
  }

  transactions(txs: unknown): void {
    this.write("info", "BUILT TRANSACTIONS", txs);
  }

  simulation(result: unknown): void {
    this.write("info", "SIMULATION RESULT", result);
  }

  refuse(reason: string): void {
    this.write("warn", "REFUSED", reason);
  }

  error(label: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.write("error", label, message);
  }
}
