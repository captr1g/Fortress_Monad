"use client";

import { useCallback } from "react";
import { useAccount, useSendTransaction, useSwitchChain, useConfig } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import type { PlanTransaction } from "@/lib/api";

// Map chainId → viem chain object so sendTransactionAsync resolves `chain`
// properly for gas estimation. Without this viem logs `chain: undefined`.
const CHAIN_MAP: Record<number, number> = {
    1: 1,
    8453: 8453,
    42161: 42161,
    10: 10,
    137: 137,
};

export function useSignTransactions() {
    const { isConnected, chainId: currentChainId } = useAccount();
    const { sendTransactionAsync } = useSendTransaction();
    const { switchChainAsync } = useSwitchChain();
    const wagmiConfig = useConfig();

    return useCallback(
        async (transactions: PlanTransaction[]): Promise<string[]> => {
            if (!isConnected) throw new Error("Connect your wallet first to sign");

            const hashes: string[] = [];
            for (const tx of transactions) {
                const targetChainId = CHAIN_MAP[tx.chainId] ?? tx.chainId;

                if (currentChainId !== targetChainId) {
                    await switchChainAsync({ chainId: targetChainId });
                }

                // Pass `gas: undefined` so the wallet provider handles gas
                // estimation natively. This avoids viem's internal estimateGas
                // which can fail with `chain: undefined` on some connectors.
                const hash = await sendTransactionAsync({
                    to: tx.to as `0x${string}`,
                    data: tx.data as `0x${string}`,
                    value: BigInt(tx.value || "0"),
                    chainId: targetChainId,
                    gas: undefined,
                });
                hashes.push(hash);

                const receipt = await waitForTransactionReceipt(wagmiConfig, {
                    hash,
                    chainId: targetChainId,
                });
                if (receipt.status !== "success") {
                    throw new Error(`Transaction ${hash} reverted on-chain`);
                }
            }
            return hashes;
        },
        [isConnected, currentChainId, sendTransactionAsync, switchChainAsync, wagmiConfig],
    );
}
