import type pg from "pg";
import {
  insertSavedStrategy,
  listSavedStrategies,
  countForWallet,
  deleteSavedStrategy,
  renameSavedStrategy,
  touchSavedStrategyUsage,
  type SavedStrategyRow,
} from "./db.js";

export const MAX_SAVED_STRATEGIES = 3;

export class LimitReachedError extends Error {
  constructor() {
    super(`A wallet can save at most ${MAX_SAVED_STRATEGIES} strategies`);
    this.name = "LimitReachedError";
  }
}

export class NotFoundError extends Error {
  constructor() {
    super("Saved strategy not found");
    this.name = "NotFoundError";
  }
}

export class SavedStrategiesService {
  private readonly pool: pg.Pool;

  constructor(deps: { pool: pg.Pool }) {
    this.pool = deps.pool;
  }

  async list(wallet: string): Promise<SavedStrategyRow[]> {
    return listSavedStrategies(this.pool, wallet);
  }

  async save(entry: {
    wallet: string;
    name: string;
    prompt: string;
    preview: unknown;
  }): Promise<SavedStrategyRow> {
    const count = await countForWallet(this.pool, entry.wallet);
    if (count >= MAX_SAVED_STRATEGIES) throw new LimitReachedError();

    const id = `saved-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return insertSavedStrategy(this.pool, { id, ...entry });
  }

  async remove(id: string, wallet: string): Promise<void> {
    const deleted = await deleteSavedStrategy(this.pool, id, wallet);
    if (!deleted) throw new NotFoundError();
  }

  async rename(
    id: string,
    wallet: string,
    name: string,
  ): Promise<SavedStrategyRow> {
    const row = await renameSavedStrategy(this.pool, id, wallet, name);
    if (!row) throw new NotFoundError();
    return row;
  }

  async touchUsage(id: string, wallet: string): Promise<SavedStrategyRow> {
    const row = await touchSavedStrategyUsage(this.pool, id, wallet);
    if (!row) throw new NotFoundError();
    return row;
  }
}
