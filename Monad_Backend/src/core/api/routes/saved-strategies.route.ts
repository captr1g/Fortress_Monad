import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import { z } from "zod";
import type { SavedStrategiesService } from "../../services/saved-strategies/saved-strategies.service.js";
import { SavedStrategiesController } from "../controllers/saved-strategies.controller.js";
import { createAuthMiddleware } from "../../services/auth/middleware.js";
import type { AnalyticsService } from "../../services/analytics/index.js";

const WalletQuerySchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

const SaveBodySchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  name: z.string().min(1),
  prompt: z.string().min(1),
  preview: z
    .unknown()
    .refine((v) => v !== undefined, { message: "preview is required" }),
});

const DeleteBodySchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

const RenameBodySchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  name: z.string().min(1),
});

const TouchUsageBodySchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

const IdParamsSchema = z.object({
  id: z.string().min(1),
});

export function registerSavedStrategiesRoutes(
  app: FastifyInstance,
  service: SavedStrategiesService,
  redis?: Redis,
  analytics?: AnalyticsService,
): void {
  const controller = new SavedStrategiesController(service, analytics);

  // These routes act on a specific wallet's private data (list/save/rename/
  // delete), so the wallet they act on must come from the verified session,
  // never the request body/query — those are attacker-controlled and wallet
  // addresses are public, so trusting them let anyone read or delete anyone
  // else's saved strategies. Falls back to the claimed address only when
  // there's no Redis to hold a session at all (local dev), matching how
  // plan.route.ts already degrades in that case.
  const preHandler = redis ? [createAuthMiddleware(redis)] : [];
  const wallet = (request: FastifyRequest, claimed: string): string =>
    redis ? request.walletAddress! : claimed;

  const handleList = (req: any, reply: any) => {
    const q = WalletQuerySchema.parse(req.query);
    return controller.list(wallet(req, q.walletAddress), req, reply);
  };

  const handleSave = (req: any, reply: any) => {
    const body = SaveBodySchema.parse(req.body);
    return controller.save(
      { ...body, walletAddress: wallet(req, body.walletAddress) },
      req,
      reply,
    );
  };

  const handleRemove = (req: any, reply: any) => {
    const { id } = IdParamsSchema.parse(req.params);
    const body = DeleteBodySchema.parse(req.body);
    return controller.remove(id, wallet(req, body.walletAddress), req, reply);
  };

  const handleRename = (req: any, reply: any) => {
    const { id } = IdParamsSchema.parse(req.params);
    const body = RenameBodySchema.parse(req.body);
    return controller.rename(
      id,
      { ...body, walletAddress: wallet(req, body.walletAddress) },
      req,
      reply,
    );
  };

  const handleTouchUsage = (req: any, reply: any) => {
    const { id } = IdParamsSchema.parse(req.params);
    const body = TouchUsageBodySchema.parse(req.body);
    return controller.touchUsage(
      id,
      { ...body, walletAddress: wallet(req, body.walletAddress) },
      req,
      reply,
    );
  };

  app.get("/fortress/saved-strategies", { preHandler }, handleList);
  app.get("/api/fortress/saved-strategies", { preHandler }, handleList);

  app.post("/fortress/saved-strategies", { preHandler }, handleSave);
  app.post("/api/fortress/saved-strategies", { preHandler }, handleSave);

  app.delete("/fortress/saved-strategies/:id", { preHandler }, handleRemove);
  app.delete("/api/fortress/saved-strategies/:id", { preHandler }, handleRemove);

  app.patch("/fortress/saved-strategies/:id", { preHandler }, handleRename);
  app.patch("/api/fortress/saved-strategies/:id", { preHandler }, handleRename);

  app.post("/fortress/saved-strategies/:id/use", { preHandler }, handleTouchUsage);
  app.post("/api/fortress/saved-strategies/:id/use", { preHandler }, handleTouchUsage);
}
