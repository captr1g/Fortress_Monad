import { z } from "zod";

// SIWE auth — mirrors prompt_2_defi/src/services/auth/routes.ts.
export const NonceResponseSchema = z.object({ nonce: z.string() });
// `token` is additive — only present for clients that can't rely on httpOnly
// cookies (React Native). Web ignores it; cookie-session behavior is unchanged.
export const VerifyResponseSchema = z.object({
  walletAddress: z.string(),
  token: z.string().optional(),
});
export const SessionResponseSchema = z.object({
  authenticated: z.boolean(),
  walletAddress: z.string().optional(),
});
export const LogoutResponseSchema = z.object({ success: z.boolean() });
