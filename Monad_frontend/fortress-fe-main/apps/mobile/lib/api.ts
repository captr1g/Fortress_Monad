import { createFortressClient } from "@fortress/core/api";

// Mobile has no Next.js proxy (web's "/api" relative path), so it talks to
// the backend directly. Bearer-token auth (SIWE) isn't wired yet — that's a
// later milestone; this client sends no Authorization header for now.
export const fortressApi = createFortressClient(
  process.env.EXPO_PUBLIC_API_BASE ?? "https://fortress-backend-210732125495.us-central1.run.app",
);
