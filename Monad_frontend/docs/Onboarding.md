# Onboarding — Wallet Authentication & Session Management

## Overview

Users authenticate by proving wallet ownership through a cryptographic signature (Sign-In With Ethereum pattern).The wallet address is the identity.

Sessions are stored in Redis with configurable TTL. Every authenticated API call verifies the session token against Redis before processing.

---

## Authentication Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (wagmi)                                               │
│                                                                 │
│  1. User connects wallet (injected/WalletConnect)               │
│  2. Frontend calls POST /auth/nonce { walletAddress }           │
│  3. Backend generates random nonce, stores in Redis (5min TTL)  │
│  4. Frontend receives nonce                                     │
│  5. Frontend asks wallet to sign message containing nonce       │
│  6. Frontend calls POST /auth/verify { walletAddress, sig }     │
│  7. Backend recovers signer from signature                      │
│  8. Backend verifies recovered address matches claimed address  │
│  9. Backend creates session in Redis, returns session token     │
│  10. Frontend stores token (httpOnly cookie or header)          │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

### POST /auth/nonce

Request a challenge nonce for signing.

**Request:**
```json
{ "walletAddress": "0x1234...abcd" }
```

**Response:**
```json
{ "nonce": "a7f3b2c1...", "expiresIn": 300 }
```

**Backend logic:**
- Validate address format (0x + 40 hex chars)
- Generate 32-byte random nonce
- Store in Redis: `nonce:{address}` → nonce value, TTL 300s
- Return nonce

### POST /auth/verify

Verify the signed message and create a session.

**Request:**
```json
{
  "walletAddress": "0x1234...abcd",
  "signature": "0xabc123..."
}
```

**Response:**
```json
{
  "token": "session_uuid",
  "walletAddress": "0x1234...abcd",
  "expiresAt": "2026-06-27T12:00:00.000Z"
}
```

**Backend logic:**
1. Retrieve nonce from Redis: `nonce:{address}`
2. If no nonce → 401 (expired or never requested)
3. Reconstruct the signed message: `Sign in to Inter\n\nNonce: {nonce}\nAddress: {address}`
4. Recover signer address from signature using `viem.verifyMessage`
5. Compare recovered address with claimed address (case-insensitive)
6. If mismatch → 401 (signature invalid)
7. Delete nonce from Redis (one-time use)
8. Generate session ID (crypto.randomUUID)
9. Store session in Redis: `session:{sessionId}` → `{ walletAddress, createdAt }`, TTL 7 days
10. Return session token

### GET /auth/me

Check current session status.

**Headers:** `Authorization: Bearer {token}` or cookie `auth_token`

**Response (authenticated):**
```json
{ "authenticated": true, "walletAddress": "0x1234...abcd" }
```

**Response (not authenticated):**
```json
{ "authenticated": false }
```

### POST /auth/logout

Destroy the session.

**Response:**
```json
{ "success": true }
```

**Backend logic:** Delete `session:{token}` from Redis.

---

## Redis Key Schema

| Key Pattern | Value | TTL | Purpose |
|-------------|-------|-----|---------|
| `nonce:{address}` | Random 32-byte hex string | 300s | One-time challenge for signature verification |
| `session:{sessionId}` | `{ walletAddress, createdAt }` | 7 days | Active user session |
| `user:{address}` | `{ strategies, positions, ... }` | None | User profile cache  |

---

## Signature Verification (viem)

```typescript
import { verifyMessage } from "viem";

const SIGN_MESSAGE_PREFIX = "Sign in to Inter";

function buildMessage(nonce: string, address: string): string {
  return `${SIGN_MESSAGE_PREFIX}\n\nNonce: ${nonce}\nAddress: ${address}`;
}

function verifyWalletSignature(message: string, signature: `0x${string}`, expectedAddress: `0x${string}`): boolean {
  const recovered = verifyMessage({ message, signature });
  return recovered.toLowerCase() === expectedAddress.toLowerCase();
}
```


---

## Session Middleware

Applied to all protected routes. Extracts and validates the session before the handler runs.

```typescript
async function requireSession(request: FastifyRequest): Promise<{ walletAddress: string }> {
  const token = request.headers.authorization?.replace("Bearer ", "")
    || request.cookies?.auth_token;

  if (!token) throw new PipelineError("api", "validation", "Authentication required");

  const session = await redis.get(`session:${token}`);
  if (!session) throw new PipelineError("api", "validation", "Session expired");

  return JSON.parse(session);
}
```

---

## Protected Routes

| Route | Auth Required | Purpose |
|-------|--------------|---------|
| POST /plan | Yes | Submit strategy prompt |
| POST /execute | Yes | Execute confirmed strategy |
| GET /portfolio/:wallet | Yes (owner only) | View positions |
| GET /apy/* | No | Public market data |
| GET /auth/nonce | No | Start auth flow |
| POST /auth/verify | No | Complete auth flow |
| GET /auth/me | Optional | Check session |

---

## Frontend Integration (wagmi)

```typescript
import { useAccount, useSignMessage } from "wagmi";

function useAuth() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  async function login() {
    // 1. Get nonce
    const { nonce } = await fetch("/auth/nonce", {
      method: "POST",
      body: JSON.stringify({ walletAddress: address }),
    }).then(r => r.json());

    // 2. Sign
    const message = `Sign in to Fortress\n\nNonce: ${nonce}\nAddress: ${address}`;
    const signature = await signMessageAsync({ message });

    // 3. Verify
    const { token } = await fetch("/auth/verify", {
      method: "POST",
      body: JSON.stringify({ walletAddress: address, signature }),
    }).then(r => r.json());

    // 4. Store token (localStorage or cookie set by backend)
    localStorage.setItem("auth_token", token);
  }

  return { login };
}
```

---

## Security Properties

| Property | Implementation |
|----------|---------------|
| No private key exposure | User signs in-wallet; backend never sees keys |
| Replay protection | Nonce is single-use (deleted after verification) |
| Nonce expiry | 5-minute TTL prevents stale nonce attacks |
| Session expiry | 7-day TTL; revocable by deleting from Redis |
| Address spoofing impossible | Signature cryptographically binds message to signer |
| CSRF protection | Token-based auth (not cookie-only) |
| Constant-time comparison | Address comparison is case-insensitive hex match |

---


## Token Delivery Strategy

Two options depending on your frontend architecture:


**Option which is suitable: httpOnly cookie**
- Backend sets `Set-Cookie: auth_token={token}; HttpOnly; Secure; SameSite=Strict`
- Browser sends automatically on every request
- More secure against XSS (JS can't read the token)
- Requires `credentials: 'include'` on fetch calls

---

## Wallet Change Handling

When the user switches wallets in MetaMask:

1. Frontend detects address change via wagmi's `useAccount` hook
2. Frontend clears stored token
3. Frontend prompts re-authentication with new wallet
4. Old session remains in Redis until TTL (harmless — token is gone from client)

No explicit "link wallet" step needed. The wallet address IS the identity.

---

## Rate Limiting on Auth Endpoints

| Endpoint | Limit | Window | Reason |
|----------|-------|--------|--------|
| POST /auth/nonce | 10 | 60s per IP | Prevent nonce flooding |
| POST /auth/verify | 5 | 60s per IP | Prevent brute-force signature attempts |

Uses the existing `createRateLimiter` from `src/api/rate-limit.ts`.

---


---

## Frontend Integration (Implemented)

### Files

| File | Purpose |
|------|---------|
| `frontend/src/hooks/useAuth.ts` | Auth state management hook |
| `frontend/src/components/AuthGate.tsx` | Gate component for protected UI |
| `frontend/src/lib/api.ts` | All API calls with `credentials: "include"` |

### useAuth Hook

```typescript
import { useAuth } from "@/hooks/useAuth";

function MyComponent() {
  const {
    isAuthenticated,   // boolean — session is valid
    isAuthenticating,  // boolean — sign flow in progress
    walletAddress,     // string | null — authenticated address (lowercase)
    login,             // () => Promise<void> — triggers nonce → sign → verify
    logout,            // () => Promise<void> — destroys session
    checkAuth,         // () => Promise<void> — re-checks /auth/me
  } = useAuth();
}
```

**Behavior:**
- On mount: calls `GET /auth/me` to check existing cookie session
- On `login()`: requests nonce → asks wallet to sign → verifies with backend → cookie is set
- On wallet change (MetaMask switch): auto-logs out, clears state
- On wallet disconnect: auto-logs out

### AuthGate Component

Wraps any UI that requires authentication:

```tsx
import { AuthGate } from "@/components/AuthGate";

export default function Page() {
  return (
    <AuthGate>
      {/* Only renders when wallet is connected AND authenticated */}
      <ChatInterface />
    </AuthGate>
  );
}
```

**States rendered:**
1. Wallet not connected → "Connect your wallet to continue" + Connect button
2. Connected but not authenticated → "Sign a message to verify wallet ownership" + Sign In button
3. Authenticated → renders children

```
### Cookie Behavior

| Scenario | What Happens |
|----------|-------------|
| First visit | No cookie → `/auth/me` returns `{authenticated: false}` → show sign-in |
| After sign-in | Cookie `auth_token` set by backend → all subsequent requests authenticated |
| Page refresh | Cookie persists → `/auth/me` returns `{authenticated: true}` → instant access |
| After 7 days | Cookie expires + Redis TTL → next `/auth/me` returns false → re-sign |
| Switch wallet | Frontend detects via wagmi → calls logout → cookie cleared → show sign-in for new wallet |
| Clear cookies | Next request has no cookie → backend returns 401 → frontend shows sign-in |
