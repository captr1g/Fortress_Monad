import { View, Text, Pressable, StyleSheet, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Svg, { Path } from "react-native-svg";
import Reanimated, { FadeInDown, FadeOut, LinearTransition } from "react-native-reanimated";
import { useAccount } from "@reown/appkit-react-native";
import { previewSummary } from "@/lib/mapPreview";
import { fortressApi } from "@/lib/api";
import {
  useSavedStrategies,
  useDeleteSavedStrategy,
  useTouchSavedStrategyUsage,
  MAX_SAVED_STRATEGIES,
} from "@fortress/core/hooks";
import type { SavedStrategy } from "@fortress/core";
import { TokenIcon } from "@/components/icons";
import { PressableScale } from "@/components/PressableScale";
import { TAB_BAR_BASE_HEIGHT } from "@/components/AppTabBar";
import { colors, monoFont, radius } from "@/lib/theme";
import * as haptics from "@/lib/haptics";

export function relativeDate(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Saved-strategies content for /profile's Saved tab. The screen shell
// (identity header, auth gate, top inset) lives in ProfileScreen.
export function SavedContent() {
  const insets = useSafeAreaInsets();
  const { address } = useAccount();
  const { data, refetch, isRefetching } = useSavedStrategies(address, fortressApi);
  const items = data?.items ?? [];
  const router = useRouter();

  if (items.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>Nothing saved yet</Text>
        <Text style={styles.emptyBody}>
          Generate a strategy and tap &quot;Save for later&quot; to keep it here without deploying.
        </Text>
        <PressableScale style={styles.emptyButton} onPress={() => router.push("/(tabs)")}>
          <Text style={styles.emptyButtonText}>Build a strategy</Text>
        </PressableScale>
      </View>
    );
  }

  return (
    <Reanimated.FlatList
      data={items}
      keyExtractor={(item: SavedStrategy) => item.id}
      itemLayoutAnimation={LinearTransition.springify().damping(20)}
      contentContainerStyle={[styles.listContent, { paddingBottom: TAB_BAR_BASE_HEIGHT + insets.bottom + 24 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => {
            haptics.tap();
            refetch();
          }}
          tintColor={colors.muted}
        />
      }
      ListHeaderComponent={
        <Text style={styles.listCaption}>
          Up to {MAX_SAVED_STRATEGIES} strategies you've saved for later, before deploying.
        </Text>
      }
      renderItem={({ item, index }: { item: SavedStrategy; index: number }) => (
        <Reanimated.View entering={FadeInDown.duration(400).delay(index * 70)} exiting={FadeOut.duration(200)}>
          <SavedCard item={item} />
        </Reanimated.View>
      )}
    />
  );
}

function TokenStack({ tokens }: { tokens: string[] }) {
  const shown = tokens.slice(0, 3);
  const overflow = tokens.length - shown.length;
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {shown.map((t, i) => (
        <View key={t} style={{ marginLeft: i > 0 ? -8 : 0, zIndex: shown.length - i }}>
          <TokenIcon symbol={t} size={28} />
        </View>
      ))}
      {overflow > 0 && (
        <View style={[styles.overflowBadge, { marginLeft: -8 }]}>
          <Text style={styles.overflowBadgeText}>+{overflow}</Text>
        </View>
      )}
    </View>
  );
}

function SavedCard({ item }: { item: SavedStrategy }) {
  const router = useRouter();
  const { address } = useAccount();
  const deleteSaved = useDeleteSavedStrategy(fortressApi);
  const touchUsage = useTouchSavedStrategyUsage(fortressApi);
  const summary = previewSummary(item.preview);
  const hasLeverage = typeof summary.leverage === "number" && summary.leverage > 1.001;
  const lastUsedLabel = item.lastUsedAt
    ? `Last used ${relativeDate(item.lastUsedAt)}`
    : `Saved ${relativeDate(item.savedAt)}`;

  function handleDelete() {
    haptics.warning();
    deleteSaved.mutate({ id: item.id, walletAddress: item.wallet });
  }

  function handleRegenerate() {
    haptics.press();
    if (address) touchUsage.mutate({ id: item.id, walletAddress: address });
    router.push({ pathname: "/(tabs)", params: { prompt: item.prompt } });
  }

  return (
    <PressableScale style={styles.card} onPress={() => router.push(`/saved/${item.id}`)}>
      <View style={styles.cardHeaderRow}>
        <TokenStack tokens={summary.tokens} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
          <View style={styles.chainBadge}>
            <Text style={styles.chainBadgeText}>{summary.chain}</Text>
          </View>
        </View>
        <Pressable onPress={handleDelete} hitSlop={10} style={styles.deleteButton}>
          <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={colors.faint} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M6 18L18 6M6 6l12 12" />
          </Svg>
        </Pressable>
      </View>

      <View style={styles.metricsRow}>
        <View>
          <Text style={styles.metricLabel}>Net APY</Text>
          <Text style={[styles.metricValue, summary.netApy !== undefined && summary.netApy < 0 && styles.metricValueNegative]}>
            {summary.netApy !== undefined ? `${summary.netApy >= 0 ? "+" : ""}${summary.netApy.toFixed(2)}%` : "—"}
          </Text>
        </View>
        {summary.startingAmount && (
          <View>
            <Text style={styles.metricLabel}>Starting</Text>
            <Text style={styles.metricValueSecondary}>
              {summary.startingAmount} {summary.startingToken}
            </Text>
          </View>
        )}
        {hasLeverage && (
          <View>
            <Text style={styles.metricLabel}>Leverage</Text>
            <Text style={styles.metricValueSecondary}>{summary.leverage!.toFixed(2)}×</Text>
          </View>
        )}
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.cardMeta}>{lastUsedLabel}</Text>
        <Pressable onPress={handleRegenerate} hitSlop={8}>
          <Text style={styles.cardUse}>Edit & Regenerate →</Text>
        </Pressable>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingHorizontal: 16, gap: 10, paddingTop: 4 },
  listCaption: { color: colors.faint, fontSize: 12, marginBottom: 2 },

  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 36, gap: 8 },
  emptyTitle: { color: "rgba(255,255,255,0.9)", fontSize: 15, fontWeight: "700" },
  emptyBody: { color: "rgba(255,255,255,0.4)", fontSize: 13, textAlign: "center", lineHeight: 18 },
  emptyButton: { backgroundColor: colors.fg, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24, marginTop: 8 },
  emptyButtonText: { color: colors.ink, fontSize: 13.5, fontWeight: "700" },

  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.lg, padding: 14, gap: 12 },
  cardHeaderRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cardTitle: { color: colors.fg, fontSize: 14.5, fontWeight: "700" },
  cardMeta: { color: colors.faint, fontSize: 11 },
  chainBadge: { marginTop: 4, alignSelf: "flex-start", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface2, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  chainBadgeText: { color: colors.faint, fontSize: 10, fontWeight: "600" },
  deleteButton: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  overflowBadge: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  overflowBadgeText: { color: colors.muted, fontSize: 9.5, fontWeight: "700" },

  metricsRow: { flexDirection: "row", gap: 20 },
  metricLabel: { color: colors.faint, fontSize: 9, textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 },
  metricValue: { color: colors.greenBright, fontSize: 15, fontWeight: "700", fontFamily: monoFont },
  metricValueNegative: { color: colors.amber },
  metricValueSecondary: { color: colors.fgSoft, fontSize: 12.5, fontWeight: "600", fontFamily: monoFont },

  cardFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: 10 },
  cardUse: { color: "#cfcfca", fontSize: 12, fontWeight: "600" },
});
