"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fortressApi as defaultFortressApi, type FortressClient } from "../api/client";
import type { SaveStrategyRequest } from "../types";

// `client` defaults to web's fortressApi singleton (Next.js proxy base) so
// existing web call sites are unaffected. Mobile has no Next.js proxy — its
// singleton reads EXPO_PUBLIC_API_BASE instead of NEXT_PUBLIC_API_BASE, so
// the default here would silently resolve to localhost:3000 there. Mobile
// must pass its own client explicitly, same as useCreatePlan (useStrategyPlan.ts).

const SAVED_STRATEGIES_KEY = ["saved-strategies"] as const;

// Mirrors the server-side cap in prompt_2_defi's SavedStrategiesService.
export const MAX_SAVED_STRATEGIES = 3;

/** The connected wallet's saved strategies. */
export function useSavedStrategies(walletAddress?: string, client: FortressClient = defaultFortressApi) {
  return useQuery({
    queryKey: [...SAVED_STRATEGIES_KEY, walletAddress],
    queryFn: () => client.listSavedStrategies(walletAddress as string),
    enabled: Boolean(walletAddress),
  });
}

/** Save a generated strategy for later (capped per wallet server-side). */
export function useSaveStrategy(client: FortressClient = defaultFortressApi) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveStrategyRequest) => client.saveStrategy(body),
    onSuccess: (_data, variables) =>
      qc.invalidateQueries({ queryKey: [...SAVED_STRATEGIES_KEY, variables.walletAddress] }),
  });
}

/** Remove a saved strategy. */
export function useDeleteSavedStrategy(client: FortressClient = defaultFortressApi) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, walletAddress }: { id: string; walletAddress: string }) =>
      client.deleteSavedStrategy(id, walletAddress),
    onSuccess: (_data, variables) =>
      qc.invalidateQueries({ queryKey: [...SAVED_STRATEGIES_KEY, variables.walletAddress] }),
  });
}

/** Rename a saved strategy. */
export function useRenameSavedStrategy(client: FortressClient = defaultFortressApi) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, walletAddress, name }: { id: string; walletAddress: string; name: string }) =>
      client.renameSavedStrategy(id, walletAddress, name),
    onSuccess: (_data, variables) =>
      qc.invalidateQueries({ queryKey: [...SAVED_STRATEGIES_KEY, variables.walletAddress] }),
  });
}

/** Mark a saved strategy as used — called when "Edit & Regenerate" is pressed. */
export function useTouchSavedStrategyUsage(client: FortressClient = defaultFortressApi) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, walletAddress }: { id: string; walletAddress: string }) =>
      client.touchSavedStrategyUsage(id, walletAddress),
    onSuccess: (_data, variables) =>
      qc.invalidateQueries({ queryKey: [...SAVED_STRATEGIES_KEY, variables.walletAddress] }),
  });
}
