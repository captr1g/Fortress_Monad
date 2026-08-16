import type { FastifyRequest, FastifyReply } from "fastify";
import type { Redis } from "ioredis";
import { getSession } from "./session.js";

export function createRequireSession(redis: Redis) {
  return async function requireSession(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const token = request.cookies?.auth_token;

    if (!token) {
      reply.status(401).send({ error: "Unauthorized: no session token" });
      return;
    }

    const session = await getSession(redis, token);
    if (!session) {
      reply.status(401).send({ error: "Unauthorized: invalid or expired session" });
      return;
    }

    (request as FastifyRequest & { walletAddress: string }).walletAddress =
      session.walletAddress;
  };
}
