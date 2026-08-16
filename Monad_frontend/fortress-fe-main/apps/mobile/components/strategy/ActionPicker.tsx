import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, Animated } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import Reanimated, { FadeIn } from "react-native-reanimated";
import { ACTION_GROUPS, CHAINS, tokensForChain, formatTvl, smartActionPhrase, type Action, type SmartAction } from "@/lib/actions";
import { ProtocolMark, TokenIcon, NetworkIcon } from "@/components/icons";
import * as haptics from "@/lib/haptics";

type Step = "action" | "chain" | "token" | "amount";
type Draft = {
  toolId?: string;
  label?: string;
  protocol?: string;
  chainId?: number;
  token?: { symbol: string; address: string };
};

const AMOUNT_PRESETS = [25, 50, 75, 100];

// Real multi-step Smart Action wizard (Action → Chain → Token → Amount),
// backed by the same catalog as web's ActionPicker (apps/mobile/lib/actions.ts,
// copied from apps/web/lib/actions.ts). RN's plain TextInput has no
// contentEditable equivalent, so the result is inserted as a text phrase
// (smartActionPhrase) instead of an inline chip — everything upstream of that
// (the actual selection flow, data, and UI quality bar) is the same wizard.
// Slides down from just below the header rather than up as a bottom sheet —
// a bottom sheet sat exactly on top of the composer, hiding it completely
// behind an opaque panel while picking an action. Anchoring from the top
// instead leaves the composer visible underneath the (dimmed) backdrop.
export function ActionPicker({ visible, onClose, onConfirm }: { visible: boolean; onClose: () => void; onConfirm: (phrase: string) => void }) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>("action");
  const [draft, setDraft] = useState<Draft>({});
  const [amountPct, setAmountPct] = useState(100);
  const translateY = useRef(new Animated.Value(-40)).current;

  useEffect(() => {
    if (visible) {
      translateY.setValue(-40);
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 220, mass: 0.6 }).start();
    }
  }, [visible, translateY]);

  function reset() {
    setStep("action");
    setDraft({});
    setAmountPct(100);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function chainsFor(action?: Action) {
    return action ? action.chains.map((id) => ({ id, ...CHAINS[id] })).filter((c) => c.label) : [];
  }

  function pickAction(action: Action, protocol: string) {
    haptics.tap();
    const single = action.chains.length === 1;
    const next: Draft = { toolId: action.toolId, label: action.label, protocol, chainId: single ? action.chains[0] : undefined };
    setDraft(next);
    setStep(single ? "token" : "chain");
  }

  function pickChain(chainId: number) {
    haptics.tap();
    setDraft((d) => ({ ...d, chainId }));
    setStep("token");
  }

  function pickToken(symbol: string, address: string) {
    haptics.tap();
    setDraft((d) => ({ ...d, token: { symbol, address } }));
    setStep("amount");
  }

  function confirm() {
    if (!draft.toolId || !draft.label || !draft.protocol || draft.chainId == null || !draft.token) return;
    const action: SmartAction = {
      toolId: draft.toolId,
      label: draft.label,
      protocol: draft.protocol,
      chainId: draft.chainId,
      token: draft.token,
      amountPct,
    };
    haptics.success();
    onConfirm(smartActionPhrase(action));
    reset();
  }

  function back() {
    if (step === "amount") setStep("token");
    else if (step === "token") {
      const action = ACTION_GROUPS.flatMap((g) => g.actions).find((a) => a.toolId === draft.toolId);
      setStep(action && action.chains.length > 1 ? "chain" : "action");
    } else setStep("action");
  }

  const currentAction = ACTION_GROUPS.flatMap((g) => g.actions).find((a) => a.toolId === draft.toolId);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Animated.View style={[styles.sheet, { marginTop: insets.top + 56, transform: [{ translateY }] }]}>
        <Pressable onPress={(e) => e.stopPropagation()}>
          <View style={styles.headerRow}>
            {step !== "action" ? (
              <Pressable onPress={back} hitSlop={10}>
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#8a8a93" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M15 18l-6-6 6-6" />
                </Svg>
              </Pressable>
            ) : (
              <View style={{ width: 16 }} />
            )}
            <Text style={styles.headerTitle}>
              {step === "action" && "Smart Action"}
              {step === "chain" && "Choose network"}
              {step === "token" && "Choose token"}
              {step === "amount" && "Amount"}
            </Text>
            <Pressable onPress={handleClose} hitSlop={10}>
              <Text style={styles.closeX}>✕</Text>
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ padding: 14 }}>
            {/* Keyed on the wizard step so each step's content fades in
                instead of popping — the container itself never remounts. */}
            <Reanimated.View key={step} entering={FadeIn.duration(180)} style={{ gap: 14 }}>
            {step === "action" &&
              ACTION_GROUPS.map((group) => (
                <View key={group.protocol}>
                  <View style={styles.groupHeader}>
                    <ProtocolMark name={group.protocol} size={16} />
                    <Text style={styles.groupTitle}>{group.protocol}</Text>
                  </View>
                  {group.actions.map((action) => (
                    <Pressable
                      key={action.toolId}
                      style={[styles.row, !action.enabled && styles.rowDisabled]}
                      onPress={() => action.enabled && pickAction(action, group.protocol)}
                      disabled={!action.enabled}
                    >
                      <Text style={[styles.rowText, !action.enabled && styles.rowTextDisabled]}>{action.label}</Text>
                      {!action.enabled && <Text style={styles.comingSoon}>coming soon</Text>}
                    </Pressable>
                  ))}
                </View>
              ))}

            {step === "chain" &&
              chainsFor(currentAction).map((chain) => (
                <Pressable key={chain.id} style={styles.row} onPress={() => pickChain(chain.id)}>
                  <NetworkIcon network={chain.label} size={26} />
                  <Text style={styles.rowText}>{chain.label}</Text>
                </Pressable>
              ))}

            {step === "token" &&
              draft.chainId != null &&
              tokensForChain(draft.chainId).map((token) => (
                <Pressable key={token.address} style={styles.row} onPress={() => pickToken(token.symbol, token.address)}>
                  <TokenIcon symbol={token.symbol} size={26} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowText}>{token.symbol}</Text>
                    <Text style={styles.rowSub}>{token.name}</Text>
                  </View>
                  {token.apy !== undefined && <Text style={styles.tokenApy}>{token.apy.toFixed(2)}%</Text>}
                  {token.tvlUsd !== undefined && <Text style={styles.tokenTvl}>{formatTvl(token.tvlUsd)}</Text>}
                </Pressable>
              ))}

            {step === "amount" && (
              <View style={{ gap: 12 }}>
                <View style={styles.amountRow}>
                  {AMOUNT_PRESETS.map((p) => (
                    <Pressable
                      key={p}
                      style={[styles.amountChip, amountPct === p && styles.amountChipActive]}
                      onPress={() => {
                        haptics.tap();
                        setAmountPct(p);
                      }}
                    >
                      <Text style={[styles.amountChipText, amountPct === p && styles.amountChipTextActive]}>{p}%</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable style={styles.confirmButton} onPress={confirm}>
                  <Text style={styles.confirmButtonText}>Add to prompt</Text>
                </Pressable>
              </View>
            )}
            </Reanimated.View>
          </ScrollView>
        </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-start" },
  sheet: { marginHorizontal: 10, backgroundColor: "#111114", borderRadius: 20, borderWidth: 1, borderColor: "#1e1e22", overflow: "hidden" },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#1c1c20" },
  headerTitle: { color: "#FAFAFA", fontSize: 15, fontWeight: "700" },
  closeX: { color: "#5e5e66", fontSize: 15 },

  groupHeader: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 8 },
  groupTitle: { color: "#8a8a93", fontSize: 11.5, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },

  row: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#161619", borderRadius: 12, paddingHorizontal: 13, paddingVertical: 12, marginBottom: 6 },
  rowDisabled: { opacity: 0.4 },
  rowText: { color: "#FAFAFA", fontSize: 14, fontWeight: "600" },
  rowTextDisabled: { color: "#8a8a93" },
  rowSub: { color: "#5e5e66", fontSize: 11, marginTop: 1 },
  comingSoon: { marginLeft: "auto", color: "#5e5e66", fontSize: 10.5, fontStyle: "italic" },


  tokenApy: { color: "#34D399", fontSize: 12.5, fontWeight: "600", marginLeft: 6 },
  tokenTvl: { color: "#5e5e66", fontSize: 11, marginLeft: 8, minWidth: 52, textAlign: "right" },

  amountRow: { flexDirection: "row", gap: 8 },
  amountChip: { flex: 1, backgroundColor: "#161619", borderWidth: 1, borderColor: "#232328", borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  amountChipActive: { backgroundColor: "#1c1c1f", borderColor: "#34D399" },
  amountChipText: { color: "#8a8a93", fontSize: 13.5, fontWeight: "600" },
  amountChipTextActive: { color: "#34D399" },
  confirmButton: { backgroundColor: "#FAFAFA", borderRadius: 14, height: 50, alignItems: "center", justifyContent: "center" },
  confirmButtonText: { color: "#0A0A0B", fontSize: 15, fontWeight: "700" },
});
