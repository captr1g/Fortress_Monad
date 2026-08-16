import type { FastifyInstance } from "fastify";
import { getAuthRedis } from "./session.js";
import { registerAuthRoutes } from "./routes.js";

export { createRequireSession } from "./middleware.js";

export function registerAuthService(app: FastifyInstance, redisUrl: string): void {
  const redis = getAuthRedis(redisUrl);
  registerAuthRoutes(app, redis);
  console.log("[auth-service] Routes registered");
}
