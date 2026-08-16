import { useState } from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import TOKEN_LOGOS from "./tokenLogos.json";

// Brand accents — used sparingly, only on token/protocol icons for scannability.
// Mirrors apps/web/lib/strategy.ts's TOKEN_COLORS/PROTOCOL_COLORS.
const TOKEN_COLORS: Record<string, string> = {
  ETH: "#627EEA",
  USDC: "#2775CA",
  cbETH: "#0052FF",
  cbBTC: "#F7931A",
  wstETH: "#00A3FF",
  "PT-USDC": "#1FC7A8",
  Rewards: "#6b6b73",
};

const PROTOCOL_COLORS: Record<string, string> = {
  Kyber: "#31CB9E",
  Aave: "#B6509E",
  Uniswap: "#FF007A",
  Morpho: "#2C6EF2",
  Lido: "#00A3FF",
  Pendle: "#1FC7A8",
  Merkl: "#F5A623",
  LiFi: "#5C67DE",
};

function tokenColor(sym?: string) {
  return (sym && TOKEN_COLORS[sym]) || "#6b6b73";
}
function protocolColor(name?: string) {
  return (name && PROTOCOL_COLORS[name]) || "#6b6b73";
}
function initial(label: string) {
  return label.replace(/[^a-zA-Z]/g, "").charAt(0).toUpperCase() || "•";
}

const TOKEN_OVERRIDES: Record<string, string> = {
  eth: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
  weth: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
};

export function TokenIcon({ symbol, size = 18 }: { symbol: string; size?: number }) {
  const [error, setError] = useState(false);
  const normalized = symbol.toLowerCase();
  const logoUrl = TOKEN_OVERRIDES[normalized] || (TOKEN_LOGOS as Record<string, string>)[normalized];

  if (logoUrl && !error) {
    return (
      <Image
        source={{ uri: logoUrl }}
        onError={() => setError(true)}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }

  return (
    <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: Math.round(size * 0.46), fontWeight: "500" }}>
        {initial(symbol)}
      </Text>
    </View>
  );
}

// DefiLlama's public icon CDN — real protocol logos, no API key needed.
// Slugs verified to actually resolve (some protocols use non-obvious slugs,
// e.g. LiFi is "li-fi" not "lifi").
const PROTOCOL_LOGO_SLUGS: Record<string, string> = {
  Morpho: "morpho",
  LiFi: "li-fi",
  Aave: "aave",
  Uniswap: "uniswap",
  Lido: "lido",
  Pendle: "pendle",
  Merkl: "merkl",
  Kyber: "kyberswap",
};

export function ProtocolMark({ name, size = 30 }: { name: string; size?: number }) {
  const [error, setError] = useState(false);
  const slug = PROTOCOL_LOGO_SLUGS[name];
  const color = protocolColor(name);

  if (slug && !error) {
    return (
      <Image
        source={{ uri: `https://icons.llamao.fi/icons/protocols/${slug}?w=64&h=64` }}
        onError={() => setError(true)}
        style={{ width: size, height: size, borderRadius: Math.round(size * 0.27) }}
      />
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.27),
        backgroundColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#fff", fontSize: Math.round(size * 0.4), fontWeight: "600" }}>{initial(name)}</Text>
    </View>
  );
}

const NETWORK_LOGOS: Record<string, string> = {
  base: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/info/logo.png",
  mainnet: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
  ethereum: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
  optimism: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/optimism/info/logo.png",
  arbitrum: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png",
  polygon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png",
};

export function NetworkIcon({ network, size = 18 }: { network: string; size?: number }) {
  const [error, setError] = useState(false);
  const logoUrl = NETWORK_LOGOS[network.toLowerCase()];

  if (logoUrl && !error) {
    return (
      <Image
        source={{ uri: logoUrl }}
        onError={() => setError(true)}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: "#fff" }}
      />
    );
  }

  return (
    <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: Math.round(size * 0.46), fontWeight: "500" }}>
        {initial(network)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: "#161619",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
});

export { tokenColor, protocolColor };
