import { Fragment } from "react";
import { View, Text, StyleSheet } from "react-native";
import type { DisplayStep } from "@/lib/mapPreview";
import { ProtocolMark, TokenIcon } from "@/components/icons";

function TokenChip({ symbol }: { symbol: string }) {
  return (
    <View style={styles.chip}>
      <TokenIcon symbol={symbol} size={14} />
      <Text style={styles.chipText}>{symbol}</Text>
    </View>
  );
}

// Shared inner content (action/apy row, divider, protocol/token row) — used
// both by a standalone StepCard and by each nested row inside a LoopCard, so
// the two only differ in their surrounding chrome (index column size, inset
// background), matching apps/web/components/strategy/StepCard.tsx's
// StepInner split.
function StepInner({ step }: { step: DisplayStep }) {
  const hasSwap = step.tokenIn && step.tokenOut;
  return (
    <>
      <View style={styles.row1}>
        <Text style={styles.action}>{step.action}</Text>
        {step.apy !== undefined ? (
          <Text style={[styles.apy, step.apyKind === "cost" && { color: "#f87171" }]}>
            APY {step.apyKind === "cost" ? "−" : "+"}
            {Math.abs(step.apy).toFixed(2)}
          </Text>
        ) : step.amount ? (
          <Text style={styles.apy}>{step.amount}</Text>
        ) : null}
      </View>
      <View style={styles.divider} />
      <View style={styles.row2}>
        <View style={styles.protocolGroup}>
          {step.protocol ? (
            <>
              <ProtocolMark name={step.protocol} size={16} />
              <Text style={styles.protocolText}>{step.protocol}</Text>
            </>
          ) : (
            <Text style={styles.protocolTextMuted}>—</Text>
          )}
        </View>
        {hasSwap ? (
          <View style={styles.swapGroup}>
            <TokenChip symbol={step.tokenIn!} />
            <Text style={styles.arrow}>→</Text>
            <TokenChip symbol={step.tokenOut!} />
          </View>
        ) : step.token ? (
          <TokenChip symbol={step.token} />
        ) : null}
      </View>
    </>
  );
}

export function StepCard({ step, n }: { step: DisplayStep; n: number }) {
  return (
    <View style={styles.row}>
      <View style={styles.indexCol}>
        <Text style={styles.indexText}>{n}</Text>
      </View>
      <View style={styles.inset}>
        <StepInner step={step} />
      </View>
    </View>
  );
}

export function StepChevron({ inner }: { inner?: boolean }) {
  return (
    <View style={inner ? styles.chevronWrapInner : styles.chevronWrap}>
      <Text style={inner ? styles.chevronInner : styles.chevron}>⌄</Text>
    </View>
  );
}

// One big card wrapping a "Nx LOOP" header, the nested repeated steps (no
// outer border of their own — just a darker inset), and an "END" footer.
// Ported from apps/web/components/strategy/StepCard.tsx's LoopCard.
function LoopCard({ steps, startN }: { steps: DisplayStep[]; startN: number }) {
  const iterations = steps[0]?.loop?.iterations ?? 2;
  return (
    <View style={styles.loopCard}>
      <View style={styles.loopHeader}>
        <View style={styles.loopBadge}>
          <Text style={styles.loopBadgeText}>{iterations}x</Text>
        </View>
        <Text style={styles.loopLabel}>Loop</Text>
        <View style={styles.loopDivider} />
      </View>

      <View style={styles.loopSteps}>
        {steps.map((step, i) => (
          <Fragment key={step.id}>
            {i > 0 && <StepChevron inner />}
            <View style={styles.loopStepRow}>
              <View style={styles.loopIndexCol}>
                <Text style={styles.loopIndexText}>{startN + i}</Text>
              </View>
              <View style={styles.loopInset}>
                <StepInner step={step} />
              </View>
            </View>
          </Fragment>
        ))}
      </View>

      <View style={styles.loopFooter}>
        <View style={styles.loopFooterLine} />
        <Text style={styles.loopFooterLabel}>End</Text>
        <View style={[styles.loopFooterLine, { flex: 1 }]} />
      </View>
    </View>
  );
}

// Groups a flat DisplayStep[] into standalone steps and loop blocks (steps
// whose loop.position spans start→…→end), assigning running display numbers
// so a loop block doesn't leave gaps. Ported from apps/web's groupSteps +
// countVisualSteps combined into one pass.
type DisplayGroup =
  | { type: "step"; step: DisplayStep; n: number }
  | { type: "loop"; steps: DisplayStep[]; startN: number };

function groupDisplaySteps(steps: DisplayStep[]): DisplayGroup[] {
  const groups: DisplayGroup[] = [];
  let n = 0;
  let i = 0;
  while (i < steps.length) {
    const s = steps[i];
    if (s.loop?.position === "start") {
      const block: DisplayStep[] = [s];
      i++;
      while (i < steps.length && steps[i].loop?.position !== "end") {
        block.push(steps[i]);
        i++;
      }
      if (i < steps.length) {
        block.push(steps[i]);
        i++;
      }
      groups.push({ type: "loop", steps: block, startN: n + 1 });
      n += block.length;
    } else {
      n += 1;
      groups.push({ type: "step", step: s, n });
      i++;
    }
  }
  return groups;
}

export function StepList({ steps }: { steps: DisplayStep[] }) {
  const groups = groupDisplaySteps(steps);
  return (
    <View>
      {groups.map((g, gi) => (
        <Fragment key={gi}>
          {gi > 0 && <StepChevron />}
          {g.type === "step" ? <StepCard step={g.step} n={g.n} /> : <LoopCard steps={g.steps} startN={g.startN} />}
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", backgroundColor: "#161619", borderRadius: 14 },
  indexCol: { width: 28, alignItems: "center", paddingTop: 11 },
  indexText: { fontSize: 15, fontWeight: "700", color: "rgba(255,255,255,0.14)" },
  inset: { flex: 1, backgroundColor: "#0e0e11", borderRadius: 10, margin: 6, marginLeft: 0 },
  row1: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
  action: { fontSize: 13.5, fontWeight: "600", color: "rgba(255,255,255,0.85)" },
  apy: { fontSize: 11.5, fontWeight: "600", color: "rgba(255,255,255,0.5)" },
  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.05)", marginHorizontal: 12 },
  row2: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10 },
  protocolGroup: { flexDirection: "row", alignItems: "center", gap: 6 },
  protocolText: { fontSize: 11, fontWeight: "500", color: "rgba(255,255,255,0.45)" },
  protocolTextMuted: { fontSize: 10, color: "rgba(255,255,255,0.15)" },
  swapGroup: { flexDirection: "row", alignItems: "center", gap: 6 },
  arrow: { color: "rgba(255,255,255,0.3)", fontSize: 12 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  chipText: { fontSize: 10.5, color: "#d4d4d8", fontVariant: ["tabular-nums"] },
  chevronWrap: { alignItems: "center", paddingVertical: 3 },
  chevron: { color: "rgba(255,255,255,0.18)", fontSize: 14 },
  chevronWrapInner: { alignItems: "center", paddingVertical: 1 },
  chevronInner: { color: "rgba(255,255,255,0.16)", fontSize: 11 },

  loopCard: { backgroundColor: "#161619", borderRadius: 14 },
  loopHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 13, paddingTop: 13, paddingBottom: 9 },
  loopBadge: { width: 25, height: 25, borderRadius: 13, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  loopBadgeText: { color: "rgba(255,255,255,0.65)", fontSize: 10.5, fontWeight: "700" },
  loopLabel: { color: "rgba(255,255,255,0.35)", fontSize: 10.5, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.4 },
  loopDivider: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.07)" },

  loopSteps: { paddingHorizontal: 6, paddingBottom: 6, gap: 0 },
  loopStepRow: { flexDirection: "row", backgroundColor: "#111114", borderRadius: 10 },
  loopIndexCol: { width: 26, alignItems: "center", paddingTop: 10 },
  loopIndexText: { fontSize: 13, fontWeight: "700", color: "rgba(255,255,255,0.1)" },
  loopInset: { flex: 1, backgroundColor: "#0c0c0f", borderRadius: 8, margin: 5, marginLeft: 0 },

  loopFooter: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 12 },
  loopFooterLine: { width: 16, height: 1, backgroundColor: "rgba(255,255,255,0.07)" },
  loopFooterLabel: { color: "rgba(255,255,255,0.3)", fontSize: 9.5, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.4 },
});
