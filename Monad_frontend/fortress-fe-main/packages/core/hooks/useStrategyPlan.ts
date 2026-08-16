"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fortressApi, type FortressClient, type SimulateWithAmountRequest } from "../api/client";
import { RegistryResponseSchema } from "../schemas";
import type { PlanRequest, RegistryResponse } from "../types";

// Hooks own the server-state calls so components stay logic-free (CLAUDE.md rule 1).
// Wallet address is passed in as a parameter — these never import Privy (rule 3).
//
// `client` defaults to web's fortressApi singleton (Next.js proxy base) so
// existing web call sites are unaffected. Mobile has no Next.js proxy, so it
// builds its own client (absolute backend URL) and passes it explicitly.

export function useCreatePlan(client: FortressClient = fortressApi) {
  return useMutation({
    mutationFn: (req: PlanRequest) => client.createPlan(req),
  });
}

export function useSimulatePlan(client: FortressClient = fortressApi) {
  return useMutation({
    mutationFn: (planId: string) => client.simulatePlan(planId),
  });
}

export function useValidatePlan(client: FortressClient = fortressApi) {
  return useMutation({
    mutationFn: (planId: string) => client.validatePlan(planId),
  });
}

export function useExecutePlan(client: FortressClient = fortressApi) {
  return useMutation({
    mutationFn: (planId: string) => client.executePlan(planId),
  });
}

/** Re-simulate an existing plan at a user-chosen amount (no LLM call). */
export function useSimulateWithAmount(client: FortressClient = fortressApi) {
  return useMutation({
    mutationFn: (req: SimulateWithAmountRequest) => client.simulateWithAmount(req),
  });
}

// Last good registry response, persisted so a repeat visit paints instantly
// instead of waiting out the backend roundtrip (Cloud Run cold starts can
// take seconds). Not a hand-maintained copy of the data — it's whatever the
// backend last served, revalidated in the background via staleTime. Guarded
// for environments without localStorage (SSR, React Native).
//
// Deliberately NOT wired in via useQuery's `initialData` — that runs
// synchronously at query-init time, which happens during SSR too. Since
// localStorage doesn't exist on the server, the server-rendered HTML would
// show the loading state while the client's first hydration pass already had
// cached data ready, a same-tick divergence React can't reconcile (an actual
// hydration-mismatch error, caught while testing this exact page). Seeding
// happens in useSeedRegistryCache() instead, in a useEffect that only ever
// runs post-hydration, so the first paint is identical on both sides and the
// cached data pops in a beat later rather than causing a mismatch.
const REGISTRY_CACHE_KEY = "fortress-registry-cache-v1";

function readCachedRegistry(): { data: RegistryResponse; at: number } | undefined {
  if (typeof window === "undefined" || !window.localStorage) return undefined;
  try {
    const raw = window.localStorage.getItem(REGISTRY_CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { data?: unknown; at?: number };
    if (typeof parsed.at !== "number") return undefined;
    // Re-validate through the schema — a cached copy written before a schema
    // change must fall back to a live fetch, not crash the page.
    const check = RegistryResponseSchema.safeParse(parsed.data);
    if (!check.success) return undefined;
    return { data: check.data, at: parsed.at };
  } catch {
    return undefined;
  }
}

function writeCachedRegistry(data: RegistryResponse): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(REGISTRY_CACHE_KEY, JSON.stringify({ data, at: Date.now() }));
  } catch {
    // Quota/private-mode failures just mean no cache next visit.
  }
}

/** Chain/token/market registry — near-static, cached aggressively. */
export function useRegistry(client: FortressClient = fortressApi) {
  return useQuery({
    queryKey: ["fortress-registry"],
    queryFn: async () => {
      const data = await client.getRegistry();
      writeCachedRegistry(data);
      return data;
    },
    staleTime: 60 * 60 * 1000, // 1h — it changes on deploys, not at runtime
    gcTime: 24 * 60 * 60 * 1000,
  });
}

/**
 * Seeds the registry query from localStorage, post-hydration only (see the
 * comment above REGISTRY_CACHE_KEY for why it can't be wired through
 * useQuery's `initialData`). Call once, near the top of a page that renders
 * useRegistry() and wants a warm-cache first paint — e.g. the board page.
 * A no-op if there's nothing cached yet, or once a real fetch has already
 * landed (checked via the query's own dataUpdatedAt, so this never clobbers
 * fresher data with a stale cached copy on a slow effect run).
 */
export function useSeedRegistryCache(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const cached = readCachedRegistry();
    if (!cached) return;
    const existing = queryClient.getQueryState(["fortress-registry"]);
    if (existing?.dataUpdatedAt) return;
    queryClient.setQueryData(["fortress-registry"], cached.data, { updatedAt: cached.at });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
