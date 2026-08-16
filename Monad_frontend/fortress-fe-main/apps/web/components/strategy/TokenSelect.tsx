"use client";

import { useState, useRef, useEffect } from "react";
import { useAccount, useBalance } from "wagmi";
import { TokenIcon, NetworkIcon } from "./icons";

const formatDisplayAddress = (addr?: string | null) =>
  addr && addr.length > 10 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";

const monadUsdcAddress = (process.env.NEXT_PUBLIC_MONAD_USDC_ADDRESS || null) as `0x${string}` | null;
const monadWmonAddress = (process.env.NEXT_PUBLIC_MONAD_WMON_ADDRESS || null) as `0x${string}` | null;
const monadWethAddress = (process.env.NEXT_PUBLIC_MONAD_WETH_ADDRESS || null) as `0x${string}` | null;

const TOKENS = [
  {
    symbol: "MON",
    name: "Monad",
    address: null,
    displayAddress: "",
    network: "monad",
    decimals: 18,
    disabled: false,
  },

  
  {
    symbol: "USDC.e",
    name: "USDC.e (Monad)",
    address: monadUsdcAddress,
    displayAddress: formatDisplayAddress(monadUsdcAddress),
    network: "monad",
    decimals: 6,
    disabled: false,
  },
  {
    symbol: "WMON",
    name: "Wrapped MON",
    address: monadWmonAddress,
    displayAddress: formatDisplayAddress(monadWmonAddress),
    network: "monad",
    decimals: 18,
    disabled: false,
  },
  {
    symbol: "WETH",
    name: "Wrapped Ether (Monad)",
    address: monadWethAddress,
    displayAddress: formatDisplayAddress(monadWethAddress),
    network: "monad",
    decimals: 18,
    disabled: !monadWethAddress,
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`,
    displayAddress: "0x8335...2913",
    network: "base",
    decimals: 6,
    disabled: false,
  },
  {
    symbol: "ETH",
    name: "ether",
    address: null,
    displayAddress: "",
    network: "base",
    decimals: 18,
    disabled: true,
  },
  {
    symbol: "cbETH",
    name: "Coinbase Wrapped Staked ETH",
    address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22" as `0x${string}`,
    displayAddress: "0x2Ae3...c22",
    network: "base",
    decimals: 18,
    disabled: true,
  },
  {
    symbol: "cbBTC",
    name: "Coinbase Wrapped BTC",
    address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" as `0x${string}`,
    displayAddress: "0xcbB7...3Bf",
    network: "base",
    decimals: 8,
    disabled: true,
  },
  {
    symbol: "USDbC",
    name: "USD Base Coin",
    address: "0xd9aAEc86b65D86f6A7B5B1b0c42FFA531710b6CA" as `0x${string}`,
    displayAddress: "0xd9aA...6CA",
    network: "base",
    decimals: 6,
    disabled: true,
  },
];

// Address for the plan request's binding `inputToken` field. The list above
// mirrors the backend registry's Base data (GET /fortress/registry).
export function tokenAddressForSymbol(symbol: string): `0x${string}` | undefined {
  return TOKENS.find((t) => t.symbol === symbol)?.address ?? undefined;
}

const CHAINS = [
  { id: "monad", name: "Monad", color: "bg-[#836EF9]", disabled: false },
  { id: "base", name: "Base", color: "bg-[#0052FF]", disabled: false },
  { id: "mainnet", name: "Ethereum", color: "bg-[#627EEA]", disabled: true },
  { id: "optimism", name: "Optimism", color: "bg-[#FF0420]", disabled: true },
  { id: "arbitrum", name: "Arbitrum", color: "bg-[#28A0F0]", disabled: true },
  { id: "bsc", name: "BSC", color: "bg-[#F3BA2F]", disabled: true },
];

function getNetworkBadgeColor(network: string) {
  const chain = CHAINS.find((c) => c.id === network);
  return chain ? chain.color : "bg-gray-500";
}

// Fetches and formats a single token balance for the connected wallet.
function useTokenBalance(token: (typeof TOKENS)[number]) {
  const { address, chainId: currentChainId } = useAccount();
  const tokenChainId = token.network === "monad" ? (currentChainId === 10143 ? 10143 : 143) : 8453;

  // Native balance (ETH or MON)
  const isNative = token.symbol === "ETH" || token.symbol === "MON";
  const { data: nativeData } = useBalance({
    address,
    chainId: tokenChainId,
    query: { enabled: !!address && isNative },
  });

  // ERC-20 balance
  const { data: erc20Data } = useBalance({
    address,
    token: token.address ?? undefined,
    chainId: tokenChainId,
    query: { enabled: !!address && token.address !== null },
  });

  const data = isNative ? nativeData : erc20Data;
  if (!address || !data) return { balance: null, balanceUsd: null };

  const amount = Number(data.formatted);
  if (amount === 0) return { balance: "0", balanceUsd: null };

  // Format: show up to 4 decimal places, trim trailing zeros.
  const formatted =
    amount >= 1000
      ? amount.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : amount >= 1
        ? amount.toFixed(4).replace(/\.?0+$/, "")
        : amount.toFixed(6).replace(/\.?0+$/, "");

  return { balance: formatted, balanceUsd: null };
}

// Individual token row — each fetches its own balance independently.
function TokenRow({
  token,
  onSelect,
}: {
  token: (typeof TOKENS)[number];
  onSelect: () => void;
}) {
  const { balance } = useTokenBalance(token);
  const isDisabled = token.disabled;

  return (
    <button
      onClick={() => !isDisabled && onSelect()}
      disabled={isDisabled}
      className={`flex items-center justify-between rounded-xl px-4 py-3 transition-colors ${
        isDisabled ? "cursor-not-allowed opacity-50" : "hover:bg-surface cursor-pointer"
      }`}
    >
      <div className="flex items-center gap-3.5">
        <div className="relative">
          <TokenIcon symbol={token.symbol} size={34} />
          <div
            className={`absolute -bottom-0.5 -left-0.5 h-3.5 w-3.5 rounded-full border-2 border-surface-2 ${getNetworkBadgeColor(
              token.network
            )}`}
          />
        </div>
        <div className="flex flex-col items-start">
          <div className="flex items-center gap-2">
            <span className="text-[15.5px] font-semibold text-fg tracking-tight">{token.name}</span>
            {isDisabled && (
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-muted uppercase">
                Soon
              </span>
            )}
          </div>
          <span className="text-[13px] text-muted">
            {token.symbol}
            {token.displayAddress && (
              <span className="opacity-60 ml-1">({token.displayAddress})</span>
            )}
          </span>
        </div>
      </div>
      {balance !== null && (
        <div className="flex flex-col items-end">
          <span className="text-[15.5px] font-semibold text-fg">{balance}</span>
          <span className="text-[13px] text-muted">{token.symbol}</span>
        </div>
      )}
    </button>
  );
}

export function TokenSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isChainsOpen, setIsChainsOpen] = useState(false);
  const [selectedChains, setSelectedChains] = useState<string[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const chainsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (chainsRef.current && chainsRef.current.contains(event.target as Node)) {
        return;
      }
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setIsChainsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedToken = TOKENS.find((t) => t.symbol === value) || TOKENS[1];

  const filteredTokens =
    selectedChains.length > 0
      ? TOKENS.filter((t) => selectedChains.includes(t.network))
      : TOKENS;

  return (
    <div className="relative w-fit z-50" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-[42px] w-[172px] cursor-pointer items-center justify-between rounded-lg border border-line bg-surface px-3 outline-none transition hover:border-line-soft focus:border-fg-soft"
      >
        <div className="flex items-center gap-2.5">
          <TokenIcon symbol={selectedToken.symbol} size={21} />
          <span className="text-[14px] font-medium text-fg">{selectedToken.name}</span>
        </div>
        <span className="text-[10px] text-faint">▾</span>
      </button>

      {isOpen && (
        // Anchors right-0 with a viewport-capped width on mobile (the trigger
        // sits at the right edge of its row, so right-0 stays on-screen);
        // reverts to the original left-0 + fixed 440px from sm up, where it's
        // meant to spill past the narrow aside into the open canvas.
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 flex w-[min(440px,calc(100vw-2rem))] flex-col rounded-[20px] border border-line-soft bg-surface-2 p-2 shadow-2xl sm:left-0 sm:right-auto sm:w-[440px]">
          <div className="mb-2 flex items-center gap-2 p-2">
            <div className="flex flex-1 items-center gap-2 rounded-xl bg-surface px-3 py-2.5 transition focus-within:border-line-soft border border-transparent">
              <svg className="h-4 w-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                autoFocus
                placeholder="Search token name or address"
                className="w-full bg-transparent text-[14px] text-fg outline-none placeholder:text-muted"
              />
            </div>

            <div className="relative">
              <button
                onClick={() => setIsChainsOpen(!isChainsOpen)}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition ${
                  isChainsOpen
                    ? "bg-surface-2 text-fg border border-line-soft"
                    : "bg-surface text-fg hover:bg-surface-2 border border-transparent"
                }`}
              >
                <div className="flex -space-x-1.5 mr-1">
                  <div className="h-3.5 w-3.5 rounded-full border border-surface bg-[#0052FF]" />
                  <div className="h-3.5 w-3.5 rounded-full border border-surface bg-[#E84142]" />
                  <div className="h-3.5 w-3.5 rounded-full border border-surface bg-[#F3BA2F]" />
                </div>
                {selectedChains.length > 0 ? `${selectedChains.length} Chains` : "All Chains"}
                <span className="ml-1.5 text-[10px] text-muted">▾</span>
              </button>

              {isChainsOpen && (
                <div
                  ref={chainsRef}
                  className="absolute right-0 top-[calc(100%+8px)] z-50 flex w-[220px] flex-col rounded-xl border border-line-soft bg-surface p-2 shadow-xl"
                >
                  {CHAINS.map((chain) => (
                    <label
                      key={chain.id}
                      className={`flex ${
                        chain.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-surface-2"
                      } items-center justify-between rounded-lg px-3 py-2.5 transition-colors`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center">
                          <NetworkIcon network={chain.id} size={20} />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-medium text-fg">{chain.name}</span>
                          {chain.disabled && (
                            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-muted uppercase">
                              Soon
                            </span>
                          )}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        disabled={chain.disabled}
                        checked={selectedChains.includes(chain.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedChains([...selectedChains, chain.id]);
                          } else {
                            setSelectedChains(selectedChains.filter((id) => id !== chain.id));
                          }
                        }}
                        className="h-4 w-4 rounded border-line-soft bg-surface accent-fg-soft"
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex max-h-[320px] flex-col overflow-y-auto pb-2 fx-scroll">
            {filteredTokens.map((token, i) => (
              <TokenRow
                key={i}
                token={token}
                onSelect={() => {
                  onChange(token.symbol);
                  setIsOpen(false);
                }}
              />
            ))}
            {filteredTokens.length === 0 && (
              <div className="py-10 text-center text-[13px] text-muted">
                No tokens found for selected chains.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
