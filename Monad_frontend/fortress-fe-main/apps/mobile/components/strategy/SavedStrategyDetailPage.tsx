import { View, Text, Pressable, StyleSheet, ScrollView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Svg, { Path } from "react-native-svg";
import { useAccount } from "@reown/appkit-react-native";
import { StepList } from "./StepCard";
import { buildDisplaySteps, previewSummary } from "@/lib/mapPreview";
import { fortressApi } from "@/lib/api";
import { useSavedStrategies, useDeleteSavedStrategy, useTouchSavedStrategyUsage } from "@fortress/core/hooks";
import { PressableScale } from "@/components/PressableScale";
import { relativeDate } from "./SavedStrategies";
import { colors, monoFont } from "@/lib/theme";
import * as haptics from "@/lib/haptics";
import { shareStrategy } from "@/lib/share";

function ActivityRow({ label, iso }: { label: string; iso: string }) {
  return (
    <View style={styles.activityRow}>
      <Text style={styles.activityLabel}>{label}</Text>
      <Text style={styles.activityValue}>{relativeDate(iso)}</Text>
    </View>
  );
}

// A full pushed screen, not a modal — same reasoning as web's
// SavedStrategyDetailPage: a saved strategy carries the same amount of
// content (prompt, metrics, every step) as the live result screen, so it
// gets the same amount of room and its own back-navigable screen.
export function SavedStrategyDetailPage({ id }: { id: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { data } = useSavedStrategies(address, fortressApi);
  const deleteSaved = useDeleteSavedStrategy(fortressApi);
  const touchUsage = useTouchSavedStrategyUsage(fortressApi);
  const item = data?.items.find((i) => i.id === id);

  // Real hand-off: land on the Prompt tab with this prompt already in the
  // composer (PromptScreen consumes the `prompt` param) — no manual pasting.
  function handleRegenerate() {
    if (!item) return;
    haptics.press();
    if (address) touchUsage.mutate({ id: item.id, walletAddress: address });
    router.replace({ pathname: "/(tabs)", params: { prompt: item.prompt } });
  }

  function handleDelete() {
    if (!item) return;
    haptics.warning();
    deleteSaved.mutate({ id: item.id, walletAddress: item.wallet }, { onSuccess: () => router.back() });
  }

  function handleShare() {
    if (!item) return;
    haptics.press();
    shareStrategy({
      name: item.name,
      netApy: item.preview.netApy,
      stepCount: buildDisplaySteps(item.preview).length,
      prompt: item.prompt,
    });
  }

  if (!isConnected || !item) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.notFoundText}>
          {!isConnected ? "Connect your wallet to view saved strategies." : "Strategy not found."}
        </Text>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.backLinkText}>← Back</Text>
        </Pressable>
      </View>
    );
  }

  const displaySteps = buildDisplaySteps(item.preview);
  const netApy = item.preview.netApy;
  const summary = previewSummary(item.preview);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
          <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="#8a8a93" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M15 18l-6-6 6-6" />
          </Svg>
          <Text style={styles.backButtonText}>Profile</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{item.name}</Text>
        <Pressable onPress={handleShare} hitSlop={10} style={styles.shareButton}>
          <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="#8a8a93" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7" />
            <Path d="M16 6l-4-4-4 4" />
            <Path d="M12 2v13" />
          </Svg>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.promptBox}>
          <Text style={styles.promptText}>{item.prompt}</Text>
        </View>

        {summary.startingAmount && (
          <View style={styles.chipsRow}>
            <View style={styles.chip}>
              <Text style={styles.chipText}>
                {summary.startingAmount} {summary.startingToken} starting
              </Text>
            </View>
          </View>
        )}

        <View style={styles.activityCard}>
          <Text style={styles.activityTitle}>Activity</Text>
          <ActivityRow label="Saved" iso={item.savedAt} />
          {item.renamedAt && <ActivityRow label="Renamed" iso={item.renamedAt} />}
          {item.lastUsedAt && <ActivityRow label="Last used" iso={item.lastUsedAt} />}
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Net APY</Text>
            <Text style={[styles.metricValue, { color: "#34D399" }]}>
              {netApy !== undefined ? `${(netApy * 100).toFixed(2)}%` : "—"}
            </Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Steps</Text>
            <Text style={styles.metricValue}>{displaySteps.length}</Text>
          </View>
        </View>

        <View style={styles.stepsCard}>
          <View style={styles.stepsCardHeader}>
            <Text style={styles.stepsCardTitle}>Steps</Text>
            <Text style={styles.stepsCardCount}>{displaySteps.length} action{displaySteps.length === 1 ? "" : "s"}</Text>
          </View>
          <View style={styles.stepsCardBody}>
            {displaySteps.length > 0 ? (
              <StepList steps={displaySteps} />
            ) : (
              <Text style={styles.noStepsText}>No step breakdown available for this strategy.</Text>
            )}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.actionsWrap, { paddingBottom: insets.bottom + 10 }]}>
        <Text style={styles.regenerateCaption}>
          Reruns with current market rates — yours may have changed since you saved this.
        </Text>
        <View style={styles.actionsRow}>
          <PressableScale style={styles.deleteButton} haptic={false} onPress={handleDelete}>
            <Text style={styles.deleteButtonText}>Delete</Text>
          </PressableScale>
          <PressableScale style={styles.useButton} onPress={handleRegenerate}>
            <Text style={styles.useButtonText}>Edit & Regenerate</Text>
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0B" },
  centered: { alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 16 },
  notFoundText: { color: "rgba(255,255,255,0.5)", fontSize: 13.5, textAlign: "center" },
  backLinkText: { color: "#8a8a93", fontSize: 13, fontWeight: "600" },

  headerRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14 },
  backButton: { flexDirection: "row", alignItems: "center", gap: 4 },
  backButtonText: { color: "#8a8a93", fontSize: 13, fontWeight: "600" },
  title: { flex: 1, color: "#FAFAFA", fontSize: 17, fontWeight: "800", letterSpacing: -0.2 },
  shareButton: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },

  scrollContent: { paddingHorizontal: 20, paddingBottom: 20, gap: 12 },
  promptBox: { backgroundColor: "#131316", borderWidth: 1, borderColor: "#1e1e22", borderRadius: 14, padding: 14 },
  promptText: { color: "#e9e9ec", fontSize: 14, lineHeight: 20 },

  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { color: colors.muted, fontSize: 11, fontFamily: monoFont },

  activityCard: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.lineSoft, borderRadius: 14, padding: 12, gap: 6 },
  activityTitle: { color: colors.faint, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 },
  activityRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  activityLabel: { color: colors.muted, fontSize: 12 },
  activityValue: { color: colors.faint, fontSize: 12, fontFamily: monoFont },

  metricsRow: { flexDirection: "row", gap: 8, marginTop: 4, marginBottom: 4 },
  metricCard: { flex: 1, backgroundColor: "#131316", borderWidth: 1, borderColor: "#1e1e22", borderRadius: 16, padding: 14 },
  metricLabel: { color: "#5e5e66", fontSize: 9, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 },
  metricValue: { color: "#FAFAFA", fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"] },

  stepsCard: { backgroundColor: "rgba(255,255,255,0.02)", borderWidth: 1, borderColor: "#1c1c20", borderRadius: 18 },
  stepsCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: "#1c1c20" },
  stepsCardTitle: { color: "#FAFAFA", fontSize: 13, fontWeight: "700" },
  stepsCardCount: { color: "#5e5e66", fontSize: 11.5, fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }) },
  stepsCardBody: { padding: 10 },
  noStepsText: { color: "rgba(255,255,255,0.3)", fontSize: 12.5, textAlign: "center", paddingVertical: 20 },

  actionsWrap: { paddingHorizontal: 20, paddingTop: 10, gap: 8 },
  actionsRow: { flexDirection: "row", gap: 10 },
  regenerateCaption: { color: colors.faint, fontSize: 10.5, textAlign: "center", lineHeight: 15, paddingHorizontal: 4 },
  deleteButton: { width: 96, borderRadius: 16, height: 52, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.08)" },
  deleteButtonText: { color: "#ef4444", fontSize: 14, fontWeight: "700" },
  useButton: { flex: 1, backgroundColor: "#FAFAFA", borderRadius: 16, height: 52, alignItems: "center", justifyContent: "center" },
  useButtonText: { color: "#0A0A0B", fontSize: 15, fontWeight: "700" },
});
