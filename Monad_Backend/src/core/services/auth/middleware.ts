// Auth middleware — attaches walletAddress to request if a valid session exists.

import type { FastifyRequest, FastifyReply } from "fastify";
import type { Redis } from "ioredis";
import { getSession } from "./session.js";

export const COOKIE_NAME = "auth_token";

declare module "fastify" {
  interface FastifyRequest {
    walletAddress?: string;
  }
}

export function createAuthMiddleware(redis: Redis) {
  return async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const token = request.cookies?.[COOKIE_NAME];
    if (!token) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const session = await getSession(redis, token);
    if (!session) {
      return reply.status(401).send({ error: "Session expired" });
    }

    request.walletAddress = session.walletAddress;
  };
}

/**
 * Admin gate for internal routes (currently the metrics dashboard).
 *
 * Built on the SIWE session rather than a bearer token or shared password: the
 * app already proves wallet ownership by signature, so an allowlist of
 * addresses needs no new secret to leak, rotate, or accidentally commit.
 *
 * `allowlist` is read from ADMIN_WALLETS at boot. An EMPTY allowlist denies
 * everyone — the failure mode of a misconfigured admin route must be "nobody
 * gets in", never "everybody does".
 */
export function createAdminMiddleware(redis: Redis, allowlist: string[]) {
  const allowed = new Set(allowlist.map((a) => a.toLowerCase()));

  return async function adminMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const token = request.cookies?.[COOKIE_NAME];
    if (!token) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const session = await getSession(redis, token);
    if (!session) {
      return reply.status(401).send({ error: "Session expired" });
    }

    // 404, not 403: a signed-in non-admin learns nothing about whether this
    // route exists, so the dashboard isn't advertised to every user who pokes at
    // the API.
    if (!allowed.has(session.walletAddress.toLowerCase())) {
      return reply.status(404).send({ error: "Not found" });
    }

    request.walletAddress = session.walletAddress;
  };
}

// Same session lookup as above, but never rejects — routes that must stay
// usable signed-out (e.g. "explore without signing in") use this to get a
// *verified* walletAddress when one exists, while still serving anonymous
// callers. A missing/expired/invalid token just leaves request.walletAddress
// unset instead of failing the request.
export function createOptionalAuthMiddleware(redis: Redis) {
  return async function optionalAuthMiddleware(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    const token = request.cookies?.[COOKIE_NAME];
    if (!token) return;

    const session = await getSession(redis, token);
    if (session) request.walletAddress = session.walletAddress;
  };
}
