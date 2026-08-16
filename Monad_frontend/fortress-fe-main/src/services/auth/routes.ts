import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { createNonce, getNonce, createSession, getSession, deleteSession } from "./session.js";
import { buildAuthMessage, recoverAndVerify } from "./verify.js";

const COOKIE_NAME = "auth_token";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PRODUCTION,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 604800, // 7 days in seconds
};

function isValidAddress(address: unknown): address is string {
  return (
    typeof address === "string" &&
    /^0x[a-fA-F0-9]{40}$/.test(address)
  );
}

export function registerAuthRoutes(app: FastifyInstance, redis: Redis): void {
  // POST /auth/nonce - Request a nonce for signing
  app.post("/auth/nonce", async (request, reply) => {
    const body = request.body as { walletAddress?: string };
    const { walletAddress } = body;

    if (!isValidAddress(walletAddress)) {
      return reply.status(400).send({ error: "Invalid wallet address format" });
    }

    const nonce = await createNonce(redis, walletAddress);
    return reply.send({ nonce });
  });

  // POST /auth/verify - Verify signature and create session
  app.post("/auth/verify", async (request, reply) => {
    const body = request.body as { walletAddress?: string; signature?: string };
    const { walletAddress, signature } = body;

    if (!isValidAddress(walletAddress)) {
      return reply.status(400).send({ error: "Invalid wallet address format" });
    }

    if (!signature || typeof signature !== "string" || !signature.startsWith("0x")) {
      return reply.status(400).send({ error: "Invalid signature format" });
    }

    // Retrieve and consume the nonce (one-time use)
    const nonce = await getNonce(redis, walletAddress);
    if (!nonce) {
      return reply.status(401).send({ error: "Nonce expired or not found. Request a new one." });
    }

    // Build the message that was signed
    const message = buildAuthMessage(nonce, walletAddress);

    // Verify the signature
    const valid = await recoverAndVerify(
      message,
      signature as `0x${string}`,
      walletAddress
    );

    if (!valid) {
      return reply.status(401).send({ error: "Signature verification failed" });
    }

    // Create session
    const sessionToken = await createSession(redis, walletAddress);

    // Set httpOnly cookie
    reply.setCookie(COOKIE_NAME, sessionToken, COOKIE_OPTIONS);

    return reply.send({ walletAddress: walletAddress.toLowerCase() });
  });

  // GET /auth/me - Check current session
  app.get("/auth/me", async (request, reply) => {
    const token = request.cookies?.[COOKIE_NAME];

    if (!token) {
      return reply.send({ authenticated: false });
    }

    const session = await getSession(redis, token);
    if (!session) {
      return reply.send({ authenticated: false });
    }

    return reply.send({
      authenticated: true,
      walletAddress: session.walletAddress,
    });
  });

  // POST /auth/logout - Destroy session
  app.post("/auth/logout", async (request, reply) => {
    const token = request.cookies?.[COOKIE_NAME];

    if (token) {
      await deleteSession(redis, token);
    }

    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return reply.send({ success: true });
  });
}
