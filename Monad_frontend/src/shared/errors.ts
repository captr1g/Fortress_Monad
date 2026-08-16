export class InputTokenMismatch extends Error {
  readonly symbol: string;
  readonly address: string;
  constructor(symbol: string, address: string) {
    super(
      `The generated plan doesn't start from your selected token (${symbol}). Mention ${symbol} explicitly in your prompt, or switch the starting token.`,
    );
    this.name = "InputTokenMismatch";
    this.symbol = symbol;
    this.address = address;
  }
}

export class UnsupportedAmountOverride extends Error {
  constructor(action: string) {
    super(`Plans of type "${action}" don't support an amount override.`);
    this.name = "UnsupportedAmountOverride";
  }
}

export class PlannerRefusal extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "PlannerRefusal";
  }
}
