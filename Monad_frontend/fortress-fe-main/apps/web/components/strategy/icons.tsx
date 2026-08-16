import { useState } from "react";
import { useRegistry } from "@fortress/core/hooks";
import { tokenColor, protocolColor } from "@/lib/strategy";

function initial(label: string) {
  return label.replace(/[^a-zA-Z]/g, "").charAt(0).toUpperCase() || "•";
}

import TOKEN_LOGOS from "./tokenLogos.json";

const OVERRIDES: Record<string, string> = {
  "eth": "/tokens/eth.png",
  "weth": "/tokens/weth.png",
  "cbeth": "/tokens/cbeth.png",
  "dai": "/tokens/dai.png",
  "usdc": "/tokens/usdc.png",
};

// Resolves a token's real contract address from the live registry when the
// caller doesn't already have it on hand — keeps the hover tooltip accurate
// without threading `address` through every call site.
function useResolvedAddress(symbol: string, explicit?: string): string | undefined {
  const { data: registry } = useRegistry();
  if (explicit) return explicit;
  const chains = registry?.chains ?? [];
  // Resolve against the executable chain first — a symbol that exists on more
  // than one registered chain should show the address we'd actually transact
  // with, not whichever chain happens to be listed first.
  const primary = chains.find((c) => c.executable);
  const ordered = primary ? [primary, ...chains.filter((c) => c !== primary)] : chains;
  for (const chain of ordered) {
    const match = chain.tokens.find((t) => t.symbol.toLowerCase() === symbol.toLowerCase());
    if (match) return match.address;
  }
  return undefined;
}

// Hover reveal for a token/protocol's contract address; click to copy.
function AddressHover({ address, children }: { address?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!address) return <>{children}</>;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        setOpen(false);
        setCopied(false);
      }}
    >
      {children}
      {open && (
        <span className="absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2">
          {/* span, not button — this sits inside plenty of already-clickable
              rows/buttons, and a nested <button> is invalid HTML that breaks hydration. */}
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(address);
              setCopied(true);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              e.stopPropagation();
              navigator.clipboard.writeText(address);
              setCopied(true);
            }}
            className="mono block cursor-pointer whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-[10.5px] text-fg-soft shadow-[0_8px_24px_-8px_rgba(0,0,0,0.85)] transition hover:text-fg"
          >
            {copied ? "Copied" : address}
          </span>
        </span>
      )}
    </span>
  );
}

export function TokenIcon({ symbol, size = 18, address }: { symbol: string; size?: number; address?: string }) {
  const [error, setError] = useState(false);
  const resolved = useResolvedAddress(symbol, address);
  const normalized = symbol.toLowerCase();
  const logoUrl = OVERRIDES[normalized] || (TOKEN_LOGOS as Record<string, string>)[normalized];

  if (logoUrl && !error) {
    return (
      <AddressHover address={resolved}>
        <img
          src={logoUrl}
          alt={symbol}
          width={size}
          height={size}
          onError={() => setError(true)}
          className="inline-flex flex-none items-center justify-center rounded-full object-contain"
          style={{ width: size, height: size }}
        />
      </AddressHover>
    );
  }

  // Beautiful dark fallback
  return (
    <AddressHover address={resolved}>
      <span
        aria-hidden
        className="inline-flex flex-none items-center justify-center rounded-full font-medium text-white/90 bg-[#161619] border border-white/10"
        style={{
          width: size,
          height: size,
          fontSize: Math.round(size * 0.46),
        }}
      >
        {initial(symbol)}
      </span>
    </AddressHover>
  );
}

const PROTOCOL_LOGOS: Record<string, string> = {
  "morpho": "/protocols/Morpho-logo-symbol-darkmode.svg",
  "lifi": "/protocols/icon_lifi_dark.svg",
  "aave": "/protocols/Logomark-aave-light.svg",
  "pendle": "/protocols/pendle-logo.svg",
  "fluid": "/protocols/fluid-white.svg",
  "euler": "/protocols/euler-symbol-color.svg",
  "compound": "/protocols/compound-mark.svg",
};

export function ProtocolMark({ name, size = 30 }: { name: string; size?: number }) {
  const [error, setError] = useState(false);
  const normalized = name.toLowerCase();
  const logoUrl = Object.entries(PROTOCOL_LOGOS).find(([key]) => normalized.includes(key))?.[1];

  if (logoUrl && !error) {
    return (
      <img
        src={logoUrl}
        alt={name}
        width={size}
        height={size}
        onError={() => setError(true)}
        className="inline-flex flex-none items-center justify-center rounded-full object-contain"
        style={{ width: size, height: size }}
      />
    );
  }

  const color = protocolColor(name);
  return (
    <span
      aria-hidden
      className="inline-flex flex-none items-center justify-center font-semibold text-white"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.27),
        background: color,
        fontSize: Math.round(size * 0.4),
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)",
      }}
    >
      {initial(name)}
    </span>
  );
}

const NETWORK_LOGOS: Record<string, string> = {
  "monad": "https://avatars.githubusercontent.com/u/111000676?v=4",
  "mainnet": "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
  "ethereum": "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
  "optimism": "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/optimism/info/logo.png",
  "arbitrum": "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png",
  "bsc": "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/info/logo.png",
  "polygon": "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png",
};

export function NetworkIcon({ network, size = 18 }: { network: string; size?: number }) {
  const [error, setError] = useState(false);
  const logoUrl = NETWORK_LOGOS[network.toLowerCase()];

  if (logoUrl && !error) {
    return (
      <img
        src={logoUrl}
        alt={network}
        width={size}
        height={size}
        onError={() => setError(true)}
        className="inline-flex flex-none items-center justify-center rounded-full object-contain bg-white"
        style={{ width: size, height: size }}
      />
    );
  }

  // fallback
  const fallbackColor = "bg-[#161619] border border-white/10";
  return (
    <span
      className={`inline-flex flex-none items-center justify-center rounded-full font-medium text-white/90 ${fallbackColor}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }}
    >
      {initial(network)}
    </span>
  )
}

// Calls out the exact on-chain vault/market a step's funds actually land in
// (e.g. "mwUSDC" behind a "Morpho" deposit, or a specific Pendle market) —
// deliberately its own small pill, not a copy of the loop badge, since this
// is a different kind of fact (a contract address, not a repeat count).
// Hover reveals the underlying address, same convention as TokenIcon.
export function VaultBadge({ label, address }: { label: string; address?: string }) {
  return (
    <AddressHover address={address}>
      <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-2 py-[1px] font-mono text-[9.5px] font-medium leading-[1.6] text-white/40">
        via {label}
      </span>
    </AddressHover>
  );
}

export function TokenChip({ symbol, address }: { symbol: string; address?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <TokenIcon symbol={symbol} address={address} />
      <span className="text-[12.5px] text-fg-soft">{symbol}</span>
    </span>
  );
}
