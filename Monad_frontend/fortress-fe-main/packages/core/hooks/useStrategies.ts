"use client";

import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { fortressApi } from "../api/client";
import type { PatchStrategyRequest } from "../types";

const STRATEGIES_KEY = ["strategies"] as const;

/** List the connected wallet's strategies (Dashboard). */
export function useStrategies(walletAddress?: string) {
  return useQuery({
    queryKey: [...STRATEGIES_KEY, walletAddress ?? "session"],
    queryFn: () => fortressApi.getStrategies(walletAddress),
  });
}

/** A single strategy's full detail. */
export function useStrategy(id: string | undefined) {
  return useQuery({
    queryKey: [...STRATEGIES_KEY, "detail", id],
    queryFn: () => fortressApi.getStrategy(id as string),
    enabled: Boolean(id),
  });
}

/** Update a strategy's status / APY / PnL or append a history event. */
export function usePatchStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PatchStrategyRequest }) =>
      fortressApi.patchStrategy(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: STRATEGIES_KEY }),
  });
}
