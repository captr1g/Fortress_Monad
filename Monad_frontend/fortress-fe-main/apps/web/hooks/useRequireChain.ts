import { useAccount, useSwitchChain } from "wagmi";
import { useCallback } from "react";
import { MONAD_CHAIN_ID } from "@/lib/chains";

export function useRequireChain() {
  const { chainId, isConnected } = useAccount();
  const { switchChainAsync, isPending } = useSwitchChain();

  const ensureChain = useCallback(
    async (targetChainId: number = MONAD_CHAIN_ID) => {
      if (!isConnected) return false;
      if (chainId === targetChainId) return true;

      try {
        await switchChainAsync({ chainId: targetChainId });
        return true;
      } catch (err) {
        console.error("[useRequireChain] Failed to switch chain:", err);
        return false;
      }
    },
    [chainId, isConnected, switchChainAsync],
  );

  return {
    currentChainId: chainId,
    isConnected,
    isSwitching: isPending,
    ensureChain,
  };
}
