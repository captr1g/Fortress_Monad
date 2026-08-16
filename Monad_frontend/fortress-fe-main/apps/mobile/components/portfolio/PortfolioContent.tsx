import { useCallback, useMemo } from "react";
import { View, Text, Pressable, StyleSheet, SectionList, RefreshControl, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import Reanimated, { FadeInUp } from "react-native-reanimated";
import { useWalletAssets, useMorphoPositions, type LiveAsset, type MorphoPosition } from "@fortress/core/hooks/portfolio";
import { TokenIcon } from "@/components/icons";
import { fortressApi } from "@/lib/api";
import { PressableScale } from "@/components/PressableScale";
import { SkeletonBar } from "@/components/Skeleton";
import { TAB_BAR_BASE_HEIGHT } from "@/components/AppTabBar";
import { colors, monoFont, radius } from "@/lib/theme";
import * as haptics from "@/lib/haptics";

// Minted when a user deposits into the Morpho allocation — the Moonwell
// Flagship USDC (mwUSDC) ERC-4626 vault share token. Same constant as web's
// Portfolio; the shared useWalletAssets hook already tracks its balance.
const MORPHO_VAULT_TOKEN = {
  symbol: "mwUSDC",
  name: "Moonwell Flagship USDC",
  address: "0xc1256Ae5FF1cf2719D4937adb3bbcCab2E00A2Ca",
  decimals: 18,
} as const;

function usd(n: number, compact = false) {
  if (compact && Math.abs(n) >= 1_000) {
    return (n < 0 ? "-$" : "$") + (Math.abs(n) / 1_000).toFixed(1) + "k";
  }
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(n: number, signed = false) {
  return (signed && n > 0 ? "+" : "") + n.toFixed(2) + "%";
}
// Risk colour is the ONE place colour varies — green (safe) / amber / red.
function ltvColor(ratio: number) {
  if (ratio >= 0.9) return colors.red;
  if (ratio >= 0.7) return colors.amber;
  return colors.greenBright;
}

type ProtocolRow = { kind: "protocol"; balance: number; valueUsd: number };
type RowItem = MorphoPosition | LiveAsset | ProtocolRow;
type Section = { key: "positions" | "protocol" | "assets"; title: string; data: RowItem[] };

// Portfolio content for /profile's Portfolio tab. The screen shell (identity
// header, auth gate, top inset) lives in ProfileScreen — this assumes a
// connected wallet and owns only the scrolling list.
export function PortfolioContent() {
  const insets = useSafeAreaInsets();

  const { assets: walletAssets, protocolAssets, totalUsd: walletAssetsUsd, isLoading, isPricePending } = useWalletAssets();
  const { positions, isLoading: positionsLoading, isError: positionsError, stale, refetch } = useMorphoPositions(fortressApi);

  // The vault share token gets its own "Protocol Tokens" section, kept
  // separate from the plain wallet list by the hook itself — but it's still
  // money the user holds, so Net worth counts it either way.
  const protocolAsset = protocolAssets.find(
    (a) => a.address.toLowerCase() === MORPHO_VAULT_TOKEN.address.toLowerCase(),
  );
  const protocolAssetsUsd = protocolAssets.reduce((s, a) => s + a.valueUsd, 0);
  const totalUsd = walletAssetsUsd + protocolAssetsUsd;

  const collateralTotal = positions.reduce((s, p) => s + p.collateralUsd, 0);
  const borrowTotal = positions.reduce((s, p) => s + p.borrowUsd, 0);
  const netWorth = totalUsd + collateralTotal - borrowTotal;
  const heroLoading = isLoading || isPricePending || positionsLoading;

  const sections: Section[] = useMemo(
    () => [
      { key: "positions", title: "Morpho Positions", data: positions },
      {
        key: "protocol",
        title: "Protocol Tokens",
        data: [{ kind: "protocol", balance: protocolAsset?.balance ?? 0, valueUsd: protocolAsset?.valueUsd ?? 0 } satisfies ProtocolRow],
      },
      { key: "assets", title: "Wallet Assets", data: walletAssets },
    ],
    [positions, protocolAsset?.balance, protocolAsset?.valueUsd, walletAssets],
  );

  const onRefresh = useCallback(() => {
    haptics.tap();
    refetch();
  }, [refetch]);

  return (
    <SectionList<RowItem, Section>
      sections={sections}
      keyExtractor={(item, index) =>
        ("id" in item ? item.id : "address" in item ? item.address : "protocol-token") + index
      }
      refreshControl={<RefreshControl refreshing={positionsLoading} onRefresh={onRefresh} tintColor={colors.muted} />}
      ListHeaderComponent={
        <NetWorthHero
          netWorth={netWorth}
          walletUsd={totalUsd}
          collateralUsd={collateralTotal}
          borrowUsd={borrowTotal}
          loading={heroLoading}
        />
      }
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{section.data.length}</Text>
          </View>
          {section.key === "positions" && stale && (
            <View style={styles.stalePill}>
              <Text style={styles.stalePillText}>stale data</Text>
            </View>
          )}
        </View>
      )}
      renderItem={({ item, section, index }) => (
        <Reanimated.View entering={FadeInUp.duration(380).delay(Math.min(index, 6) * 60)}>
          {section.key === "positions" ? (
            <MorphoCard position={item as MorphoPosition} />
          ) : section.key === "protocol" ? (
            <ProtocolTokenRow row={item as ProtocolRow} isLoading={isLoading || isPricePending} />
          ) : (
            <AssetRow asset={item as LiveAsset} totalUsd={walletAssetsUsd} pricePending={isPricePending} />
          )}
        </Reanimated.View>
      )}
      renderSectionFooter={({ section }) => {
        if (section.key === "positions") {
          if (positionsError) return <PositionsError onRetry={refetch} />;
          if (positionsLoading && section.data.length === 0) return <CardSkeleton />;
          if (!positionsLoading && section.data.length === 0)
            return <EmptyState text="No Morpho positions found" sub="Deploy a strategy to open your first position." />;
        }
        if (section.key === "assets") {
          if (isLoading && section.data.length === 0) return <RowSkeletons />;
          if (!isLoading && section.data.length === 0)
            return <EmptyState text="No assets found on Base" sub="Bridge or deposit funds to get started" />;
        }
        return null;
      }}
      contentContainerStyle={{ paddingBottom: TAB_BAR_BASE_HEIGHT + insets.bottom + 24, paddingTop: 4 }}
      stickySectionHeadersEnabled={false}
      showsVerticalScrollIndicator={false}
    />
  );
}

// ─── Net worth hero ───────────────────────────────────────────────────────────

function NetWorthHero({
  netWorth,
  walletUsd,
  collateralUsd,
  borrowUsd,
  loading,
}: {
  netWorth: number;
  walletUsd: number;
  collateralUsd: number;
  borrowUsd: number;
  loading: boolean;
}) {
  return (
    <View style={styles.hero}>
      <Text style={styles.heroLabel}>Net worth</Text>
      {loading ? (
        <View style={{ marginTop: 10, marginBottom: 2 }}>
          <SkeletonBar width={170} height={28} radius={6} />
        </View>
      ) : (
        <Text style={styles.heroValue}>{usd(netWorth)}</Text>
      )}
      <Text style={styles.heroSub}>wallet + supplied − borrowed</Text>
      <View style={styles.heroStatsRow}>
        <HeroStat label="Wallet" value={walletUsd} loading={loading} />
        <View style={styles.heroDivider} />
        <HeroStat label="Supplied" value={collateralUsd} loading={loading} />
        <View style={styles.heroDivider} />
        <HeroStat label="Borrowed" value={borrowUsd} loading={loading} negative />
      </View>
    </View>
  );
}

function HeroStat({ label, value, loading, negative }: { label: string; value: number; loading: boolean; negative?: boolean }) {
  return (
    <View style={styles.heroStat}>
      <Text style={styles.heroStatLabel}>{label}</Text>
      {loading ? (
        <SkeletonBar width={62} height={13} radius={4} />
      ) : (
        <Text style={[styles.heroStatValue, negative && value > 0 && { color: colors.amber }]}>
          {`${negative && value > 0 ? "-" : ""}${usd(value)}`}
        </Text>
      )}
    </View>
  );
}

// ─── Protocol token row (mwUSDC vault share) ─────────────────────────────────

function ProtocolTokenRow({ row, isLoading }: { row: ProtocolRow; isLoading: boolean }) {
  function handleWithdraw() {
    haptics.press();
    Alert.alert("Coming soon", "Withdraw isn't built on mobile yet — use the web app for now.");
  }

  return (
    <View style={styles.assetRow}>
      <TokenIcon symbol={MORPHO_VAULT_TOKEN.symbol} size={30} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={styles.protocolTitleRow}>
          <Text style={styles.assetSymbol}>{MORPHO_VAULT_TOKEN.symbol}</Text>
          <View style={styles.viaBadge}>
            <Text style={styles.viaBadgeText}>via Morpho</Text>
          </View>
        </View>
        {isLoading ? (
          <View style={{ marginTop: 4 }}>
            <SkeletonBar width={54} height={9} />
          </View>
        ) : (
          <Text style={styles.assetBalance}>
            {row.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
          </Text>
        )}
      </View>
      <View style={{ alignItems: "flex-end", marginRight: 10 }}>
        {isLoading ? (
          <SkeletonBar width={48} height={11} />
        ) : (
          <Text style={styles.assetValue}>{usd(row.valueUsd, true)}</Text>
        )}
      </View>
      <PressableScale
        style={[styles.withdrawButton, (isLoading || row.balance === 0) && { opacity: 0.35 }]}
        onPress={handleWithdraw}
        disabled={isLoading || row.balance === 0}
      >
        <Svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={colors.muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </Svg>
        <Text style={styles.withdrawButtonText}>Withdraw</Text>
      </PressableScale>
    </View>
  );
}

// ─── Wallet asset row ────────────────────────────────────────────────────────

function AssetRow({ asset, totalUsd, pricePending }: { asset: LiveAsset; totalUsd: number; pricePending: boolean }) {
  const share = totalUsd > 0 ? (asset.valueUsd / totalUsd) * 100 : 0;
  return (
    <View style={styles.assetRow}>
      <TokenIcon symbol={asset.symbol} size={30} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={styles.assetSymbol}>{asset.symbol}</Text>
        <Text style={styles.assetBalance}>{asset.balance.toLocaleString(undefined, { maximumFractionDigits: 6 })}</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        {pricePending ? (
          <SkeletonBar width={48} height={11} />
        ) : (
          <Text style={styles.assetValue}>{usd(asset.valueUsd, true)}</Text>
        )}
        <Text style={styles.assetShare}>{pricePending ? " " : `${share.toFixed(1)}%`}</Text>
      </View>
    </View>
  );
}

// ─── Morpho position card ────────────────────────────────────────────────────

function MorphoCard({ position: pos }: { position: MorphoPosition }) {
  const ltvRatio = pos.maxLtv > 0 ? pos.ltv / pos.maxLtv : 0;

  function handleExit() {
    haptics.press();
    Alert.alert("Coming soon", "Exit position isn't built yet — that's a later milestone.");
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <View style={styles.cardHeaderLeft}>
          <TokenIcon symbol={pos.collateralSymbol} size={30} />
          <View>
            <Text style={styles.cardMarket}>{pos.market}</Text>
            <Text style={styles.cardSubText}>{pos.networkLabel} · Morpho</Text>
          </View>
        </View>
        <Pressable style={styles.exitButton} onPress={handleExit}>
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={colors.muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </Svg>
        </Pressable>
      </View>

      <View style={styles.ltvTrack}>
        <View style={[styles.ltvFill, { width: `${Math.min(ltvRatio * 100, 100)}%`, backgroundColor: ltvColor(ltvRatio) }]} />
      </View>
      <View style={styles.ltvFooterRow}>
        <Text style={styles.ltvFooterText}>
          LTV <Text style={styles.mono}>{pct(pos.ltv * 100)}</Text>
        </Text>
        <Text style={styles.ltvFooterText}>
          HF <Text style={[styles.mono, { color: colors.greenBright }]}>{pos.healthFactor >= 99 ? "∞" : pos.healthFactor.toFixed(2)}</Text>
        </Text>
      </View>
    </View>
  );
}

// ─── Loading / empty / error states ──────────────────────────────────────────

function CardSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <View style={styles.cardHeaderLeft}>
          <SkeletonBar width={30} height={30} radius={15} />
          <View style={{ gap: 6 }}>
            <SkeletonBar width={110} height={11} />
            <SkeletonBar width={70} height={9} />
          </View>
        </View>
        <SkeletonBar width={30} height={30} radius={9} />
      </View>
      <SkeletonBar width={"100%" as const} height={5} radius={3} />
      <View style={[styles.ltvFooterRow, { marginTop: 8 }]}>
        <SkeletonBar width={64} height={9} />
        <SkeletonBar width={48} height={9} />
      </View>
    </View>
  );
}

function RowSkeletons() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.assetRow}>
          <SkeletonBar width={30} height={30} radius={15} />
          <View style={{ flex: 1, marginLeft: 12, gap: 6 }}>
            <SkeletonBar width={64} height={11} />
            <SkeletonBar width={44} height={9} />
          </View>
          <View style={{ alignItems: "flex-end", gap: 6 }}>
            <SkeletonBar width={52} height={11} />
            <SkeletonBar width={32} height={9} />
          </View>
        </View>
      ))}
    </>
  );
}

function EmptyState({ text, sub }: { text: string; sub: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateText}>{text}</Text>
      <Text style={styles.emptyStateSub}>{sub}</Text>
    </View>
  );
}

function PositionsError({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={[styles.emptyState, { borderColor: "rgba(239,68,68,0.25)", backgroundColor: "rgba(239,68,68,0.05)" }]}>
      <Text style={[styles.emptyStateText, { color: colors.red }]}>Failed to load positions</Text>
      <Text style={styles.emptyStateSub}>Could not reach the Fortress API.</Text>
      <Pressable style={styles.retryButton} onPress={onRetry}>
        <Text style={styles.retryButtonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    marginHorizontal: 16,
    marginBottom: 22,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    backgroundColor: colors.surface,
    padding: 18,
  },
  heroLabel: { color: colors.faint, fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1.4 },
  heroValue: { color: colors.fg, fontSize: 34, fontWeight: "700", marginTop: 8, fontFamily: monoFont, fontVariant: ["tabular-nums"], letterSpacing: -0.5 },
  heroSub: { color: colors.faint, fontSize: 11.5, marginTop: 6 },
  heroStatsRow: { flexDirection: "row", alignItems: "center", marginTop: 18, gap: 16 },
  heroDivider: { width: StyleSheet.hairlineWidth, alignSelf: "stretch", backgroundColor: colors.line },
  heroStat: { gap: 5 },
  heroStatLabel: { color: colors.muted, fontSize: 11 },
  heroStatValue: { color: colors.fg, fontSize: 14.5, fontWeight: "600", fontFamily: monoFont, fontVariant: ["tabular-nums"] },

  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, marginBottom: 10, marginTop: 6 },
  sectionTitle: { color: colors.muted, fontSize: 10.5, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2 },
  countPill: { backgroundColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 },
  countPillText: { color: colors.muted, fontSize: 10.5, fontFamily: monoFont },
  stalePill: { marginLeft: "auto", borderRadius: radius.pill, borderWidth: 1, borderColor: "rgba(245,158,11,0.25)", backgroundColor: "rgba(245,158,11,0.1)", paddingHorizontal: 8, paddingVertical: 2 },
  stalePillText: { color: colors.amber, fontSize: 11 },

  assetRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    padding: 12,
  },
  assetSymbol: { color: colors.fg, fontSize: 13, fontWeight: "600" },
  assetBalance: { color: colors.faint, fontSize: 11, marginTop: 2, fontFamily: monoFont },
  assetValue: { color: colors.fg, fontSize: 13, fontWeight: "600", fontFamily: monoFont, fontVariant: ["tabular-nums"] },
  assetShare: { color: colors.faint, fontSize: 11, marginTop: 2, fontFamily: monoFont },

  protocolTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  viaBadge: { backgroundColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1.5 },
  viaBadgeText: { color: colors.muted, fontSize: 9.5, fontWeight: "600" },
  withdrawButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: colors.inset,
    borderWidth: 1,
    borderColor: "#232328",
  },
  withdrawButtonText: { color: colors.muted, fontSize: 11.5, fontWeight: "600" },

  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    padding: 16,
  },
  cardHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  cardHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 9 },
  cardMarket: { color: colors.fg, fontSize: 13.5, fontWeight: "600" },
  cardSubText: { color: colors.faint, fontSize: 10.5, marginTop: 1 },
  exitButton: { width: 30, height: 30, borderRadius: 9, backgroundColor: colors.inset, borderWidth: 1, borderColor: "#232328", alignItems: "center", justifyContent: "center" },

  ltvTrack: { height: 5, borderRadius: 3, backgroundColor: colors.line, overflow: "hidden", marginBottom: 8 },
  ltvFill: { height: "100%", borderRadius: 3 },
  ltvFooterRow: { flexDirection: "row", justifyContent: "space-between" },
  ltvFooterText: { color: colors.muted, fontSize: 11 },
  mono: { color: "#c8c8cd", fontWeight: "600", fontFamily: monoFont },

  emptyState: {
    marginHorizontal: 16,
    marginBottom: 12,
    height: 140,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  emptyStateText: { color: colors.muted, fontSize: 13 },
  emptyStateSub: { color: colors.faint, fontSize: 12 },
  retryButton: { marginTop: 8, borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", paddingHorizontal: 16, paddingVertical: 8 },
  retryButtonText: { color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: "500" },
});
