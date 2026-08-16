// Auth controller — handles nonce generation, signature verification, session lookup, and logout.

import type { FastifyRequest, FastifyReply } from "fastify";
import type { Redis } from "ioredis";
import {
  createNonce,
  getNonce,
  createSession,
  getSession,
  deleteSession,
} from "../../services/auth/session.js";
import { buildAuthMessage, recoverAndVerify } from "../../services/auth/verify.js";
import { COOKIE_NAME } from "../../services/auth/middleware.js";
import type { AnalyticsService } from "../../services/analytics/index.js";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PRODUCTION,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 604800, // 7 days
};

function isValidAddress(address: unknown): address is string {
  return typeof address === "string" && /^0x[a-fA-F0-9]{40}$/.test(address);
}

export class AuthController {
  constructor(
    private readonly redis: Redis,
    private readonly analytics?: AnalyticsService,
  ) { }

  async nonce(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as { walletAddress?: string };
    const { walletAddress } = body;

    if (!isValidAddress(walletAddress)) {
      return reply.status(400).send({ error: "Invalid wallet address format" });
    }

    const nonce = await createNonce(this.redis, walletAddress);
    return reply.send({ nonce });
  }

  async verify(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as { walletAddress?: string; signature?: string };
    const { walletAddress, signature } = body;

    if (!isValidAddress(walletAddress)) {
      return reply.status(400).send({ error: "Invalid wallet address format" });
    }

    if (!signature || typeof signature !== "string" || !signature.startsWith("0x")) {
      return reply.status(400).send({ error: "Invalid signature format" });
    }

    const nonce = await getNonce(this.redis, walletAddress);
    if (!nonce) {
      return reply
        .status(401)
        .send({ error: "Nonce expired or not found. Request a new one." });
    }

    const message = buildAuthMessage(nonce, walletAddress);
    const valid = await recoverAndVerify(
      message,
      signature as `0x${string}`,
      walletAddress,
    );

    if (!valid) {
      return reply.status(401).send({ error: "Signature verification failed" });
    }

    const sessionToken = await createSession(this.redis, walletAddress);
    reply.setCookie(COOKIE_NAME, sessionToken, COOKIE_OPTIONS);

    // Placed after verification, so a wallet is only ever counted once its
    // owner has proved control of it — an unverified address is just a string
    // anyone can post. Never throws (see AnalyticsService).
    await this.analytics?.recordSignIn(walletAddress);

    return reply.send({ walletAddress: walletAddress.toLowerCase() });
  }

  async me(request: FastifyRequest, reply: FastifyReply) {
    const token = request.cookies?.[COOKIE_NAME];
    if (!token) return reply.send({ authenticated: false });

    const session = await getSession(this.redis, token);
    if (!session) return reply.send({ authenticated: false });

    return reply.send({
      authenticated: true,
      walletAddress: session.walletAddress,
    });
  }

  async logout(request: FastifyRequest, reply: FastifyReply) {
    const token = request.cookies?.[COOKIE_NAME];
    if (token) await deleteSession(this.redis, token);
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return reply.send({ success: true });
  }
}
