import { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Animated, Easing, Platform, KeyboardAvoidingView, Alert, Keyboard } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import Svg, { Path } from "react-native-svg";
import Reanimated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { useAccount, useAppKit } from "@reown/appkit-react-native";
import { useCreatePlan, useSaveStrategy, useSavedStrategies, useSimulateWithAmount, useRegistry, MAX_SAVED_STRATEGIES } from "@fortress/core/hooks";
import { FortressApiError, type Preview } from "@fortress/core";
import { formatUnits, parseUnits } from "viem";
import { fortressApi } from "@/lib/api";
import { StepList } from "./StepCard";
import { buildDisplaySteps } from "@/lib/mapPreview";
import { AmbientWave } from "./AmbientWave";
import { ComposerGlow } from "./ComposerGlow";
import { ActionPicker } from "./ActionPicker";
import { TokenIcon } from "@/components/icons";
import { FortressMark } from "@/components/FortressMark";
import { PressableScale } from "@/components/PressableScale";
import { TAB_BAR_BASE_HEIGHT } from "@/components/AppTabBar";
import * as haptics from "@/lib/haptics";
import { shareStrategy } from "@/lib/share";

const BASE_CHAIN_ID = 8453;

// Offline fallback for the starting-token chip — mirrors the backend
// registry's Base data (GET /fortress/registry supersedes it when reachable).
const FALLBACK_INPUT_TOKENS = [
  { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, inputEnabled: true },
];

// Ported verbatim from apps/web/components/strategy/StrategyBuilder.tsx's
// TEMPLATES — same label/token/desc/prompt for every card, so mobile
// generates the exact same structured plan web does instead of a vaguer
// one-liner that can resolve differently.
const TEMPLATES = [
  {
    title: "Basic Morpho Borrow",
    token: "USDC",
    sub: "Supply cbETH collateral to Morpho and borrow USDC against it safely.",
    prompt:
      "I have 1 USDC on Base.\n\n" +
      "1. Swap 100% USDC to WETH.\n" +
      "2. Wrap 100% WETH into cbETH.\n" +
      "3. Supply 100% cbETH as collateral to Morpho market cbETH-USDC on Base.\n" +
      "4. Borrow USDC at 30% LTV against cbETH.",
  },
  {
    title: "Morpho Leverage Loop (2x)",
    token: "USDC",
    sub: "Supply cbETH and automate a recursive 35% LTV borrow-swap-supply loop twice.",
    prompt:
      "I have 1 USDC on Base.\n\n" +
      "1. Swap 100% USDC to WETH.\n" +
      "2. Wrap 100% WETH into cbETH.\n" +
      "3. Supply 100% cbETH as collateral to Morpho market cbETH-USDC on Base.\n\n" +
      "Then repeat 2 times:\n" +
      "4. Borrow USDC at 35% LTV.\n" +
      "5. Swap borrowed USDC to WETH.\n" +
      "6. Wrap WETH into cbETH.\n" +
      "7. Supply 100% cbETH.",
  },
  {
    title: "Deposit 100 USDC into Morpho",
    token: "USDC",
    sub: "Supply 100 USDC to Morpho for a steady yield.",
    prompt: "I have 100 USDC on Base.\n\n1. Supply 100% USDC to Morpho on Base.",
  },
];

// The floating tab bar sits over the composer's home-indicator padding — but
// when the keyboard is open it covers the tab bar entirely, so the extra
// clearance would just be a dead gap above the keyboard.
function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, () => setVisible(true));
    const hide = Keyboard.addListener(hideEvt, () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

// Counts seconds while a plan is generating — an honest "still working"
// signal instead of fake discrete stage-progress that can finish (or get
// stuck) well before the real backend response actually arrives.
function useElapsedSeconds(active: boolean) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  return elapsed;
}

export function PromptScreen() {
  const insets = useSafeAreaInsets();
  const { open } = useAppKit();
  const { isConnected, address } = useAccount();
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const createPlan = useCreatePlan(fortressApi);
  const elapsed = useElapsedSeconds(createPlan.isPending);

  // The tab bar floats over content now — anything anchored to the bottom of
  // the screen must clear it plus the home indicator.
  const bottomClearance = TAB_BAR_BASE_HEIGHT + insets.bottom;
  const keyboardVisible = useKeyboardVisible();
  const composerClearance = keyboardVisible ? 4 : bottomClearance + 4;

  // "Use this prompt" hand-off from the saved-strategy detail screen.
  const params = useLocalSearchParams<{ prompt?: string }>();
  const consumedParamPrompt = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (params.prompt && params.prompt !== consumedParamPrompt.current) {
      consumedParamPrompt.current = params.prompt;
      setPrompt(params.prompt);
      createPlan.reset(); // ensure the composer (not a stale result) is showing
      router.setParams({ prompt: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.prompt]);

  // Physical confirmation when a generation finishes either way.
  useEffect(() => {
    if (createPlan.isSuccess) haptics.success();
  }, [createPlan.isSuccess]);
  useEffect(() => {
    if (createPlan.isError) haptics.error();
  }, [createPlan.isError]);

  // Amount re-simulation replaces the shown preview without re-running the
  // planner; cleared whenever the user goes back or generates fresh.
  const [overridePreview, setOverridePreview] = useState<Preview | null>(null);
  const preview = overridePreview ?? createPlan.data;
  // Not sent to the backend today (the /plan request has no name field) —
  // this is a client-only label, same as web's `name` state, laying the
  // groundwork for a future "save this strategy" feature.
  const displayName = preview?.name ?? (name.trim() || undefined) ?? "Generated strategy";

  const saveStrategy = useSaveStrategy(fortressApi);
  const { data: savedData } = useSavedStrategies(address, fortressApi);
  const mySaved = savedData?.items ?? [];

  // Starting token — a structured, backend-validated constraint (the token
  // the user actually holds), not free prompt text. List comes from the
  // backend registry; tapping the chip cycles through enabled tokens (one
  // today, so it reads as a static badge until more are enabled).
  const { data: registryData } = useRegistry(fortressApi);
  const enabledTokens =
    registryData?.chains
      .find((c) => c.chainId === BASE_CHAIN_ID)
      ?.tokens.filter((t) => t.inputEnabled) ?? FALLBACK_INPUT_TOKENS;
  const [tokenIdx, setTokenIdx] = useState(0);
  const startingToken = enabledTokens[tokenIdx % enabledTokens.length];

  function handleGenerate() {
    if (!prompt.trim() || !address) return;
    setOverridePreview(null);
    createPlan.mutate({
      prompt: prompt.trim(),
      walletAddress: address,
      chainId: BASE_CHAIN_ID,
      inputToken: startingToken.address,
    });
  }

  // Plain back-navigation to the composer — the prompt text is preserved
  // (createPlan.reset() only clears the generated result), but it doesn't
  // force the keyboard open. Auto-focusing here made "go back" also pop the
  // keyboard unexpectedly; the user can tap the composer if they want to type.
  function handleBack() {
    setOverridePreview(null);
    createPlan.reset();
  }

  // Suggestion chip from a failed generation: append the required line to the
  // prompt and return to the composer.
  function applySuggestion(insertText: string) {
    haptics.tap();
    setPrompt((p) => (p.trim() ? `${p.trimEnd()}\n${insertText}` : insertText));
    createPlan.reset();
  }

  function handleInsertAction(phrase: string) {
    setPrompt((p) => (p.length && !p.endsWith(" ") ? p + " " : p) + phrase);
    setPickerOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function handleDeploy() {
    Alert.alert("Coming soon", "Deploy & sign flow isn't built yet — this is the next milestone.");
  }

  // Explicit "save for later" — persists to the real backend (/fortress/saved-strategies).
  // Mirrors apps/web's SaveStrategyAction.
  //
  // TEMPORARY PLACEMENT: the real flow saves *after* the user approves and
  // runs the transaction, not here on the pre-deploy result screen. It's
  // wired in here for now purely so it's easy to reach and test without a
  // full deploy each time — move it into the post-deploy success state once
  // that's built.
  function handleSaveForLater() {
    if (!address || !preview) return;
    saveStrategy.mutate(
      { walletAddress: address, name: displayName, prompt, preview },
      {
        onSuccess: () => {
          haptics.success();
          Alert.alert("Saved", "Strategy saved for later.");
        },
        onError: (err) => {
          haptics.error();
          // Logged so a repeat failure actually leaves a trace in logcat —
          // the Alert alone gives no diagnostic signal.
          console.error("[Fortress] Save strategy failed:", err);
          if (err instanceof FortressApiError && err.status === 409) {
            Alert.alert("Save limit reached", `You've saved ${MAX_SAVED_STRATEGIES} strategies already — delete one to save more.`);
          } else if (err instanceof FortressApiError && err.category === "network") {
            Alert.alert("Couldn't save", "Check your connection and try again.");
          } else {
            Alert.alert("Failed to save", "Something went wrong saving this strategy.");
          }
        },
      },
    );
  }

  if (!isConnected) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.notConnectedTitle}>Connect your wallet</Text>
        <Text style={styles.notConnectedBody}>Connect your wallet to describe a strategy and generate a plan.</Text>
        <PressableScale style={styles.connectButton} onPress={() => open()}>
          <Text style={styles.connectButtonText}>Connect Wallet</Text>
        </PressableScale>
      </View>
    );
  }

  // ── Result state ──
  if (preview && !createPlan.isPending) {
    const displaySteps = buildDisplaySteps(preview);
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.resultHeaderRow}>
          <Pressable onPress={handleBack} hitSlop={12} style={styles.backButton}>
            <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="#8a8a93" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M15 18l-6-6 6-6" />
            </Svg>
            <Text style={styles.backButtonText}>Edit</Text>
          </Pressable>
          <Text style={styles.resultTitle} numberOfLines={1}>
            {displayName}
          </Text>
          <Pressable
            onPress={() => {
              haptics.press();
              shareStrategy({ name: displayName, netApy: preview.netApy, stepCount: displaySteps.length, prompt });
            }}
            hitSlop={10}
            style={styles.shareButton}
          >
            <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="#8a8a93" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7" />
              <Path d="M16 6l-4-4-4 4" />
              <Path d="M12 2v13" />
            </Svg>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.resultScrollContent}>
          <Reanimated.View entering={FadeInUp.duration(400)} style={styles.metricsRow}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Net APY</Text>
              <Text style={[styles.metricValue, { color: "#34D399" }]}>
                {/* API returns a fraction (0.004), not a percentage — matches web's *100 */}
                {preview.netApy !== undefined ? `${(preview.netApy * 100).toFixed(2)}%` : "—"}
              </Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Steps</Text>
              <Text style={styles.metricValue}>{displaySteps.length}</Text>
            </View>
          </Reanimated.View>

          <Reanimated.View entering={FadeInUp.duration(400).delay(90)} style={styles.stepsCard}>
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
          </Reanimated.View>

          {!preview.simulation.success && (
            <View style={styles.simFailBox}>
              <Text style={styles.simFailText}>Simulation failed{preview.simulation.revertReason ? `: ${preview.simulation.revertReason}` : ""}</Text>
            </View>
          )}
        </ScrollView>

        <View style={[styles.deployWrap, { paddingBottom: bottomClearance + 10 }]}>
          <AmountRow preview={preview} walletAddress={address} onSimulated={setOverridePreview} />
          <View style={styles.saveRow}>
            <Text style={styles.saveRowCount}>{mySaved.length}/{MAX_SAVED_STRATEGIES} saved</Text>
            <Pressable
              onPress={() => {
                haptics.press();
                handleSaveForLater();
              }}
              disabled={mySaved.length >= MAX_SAVED_STRATEGIES}
              hitSlop={8}
            >
              <Text style={[styles.saveRowAction, mySaved.length >= MAX_SAVED_STRATEGIES && styles.saveRowActionDisabled]}>
                {mySaved.length >= MAX_SAVED_STRATEGIES ? "Save limit reached" : "Save for later"}
              </Text>
            </Pressable>
          </View>
          <PressableScale style={styles.deployButton} onPress={handleDeploy}>
            <Text style={styles.deployButtonText}>Approve &amp; Deploy · {preview.artifacts.length} txs</Text>
          </PressableScale>
        </View>
      </View>
    );
  }

  // ── Pipeline / error / empty (composer) state ──
  return (
    <View style={[styles.container, { overflow: "hidden" }]}>
      {/* Rendered outside the KeyboardAvoidingView so its position is always
          relative to the full screen — anchoring it inside the shrinking
          keyboard-avoiding container made it recompute (and visually jump
          away from the composer, leaving a bare gap) whenever the keyboard
          opened. */}
      {!createPlan.isPending && !createPlan.isError && <AmbientWave />}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={insets.top}>
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <View style={styles.header}>
          <Text style={styles.title}>Prompt</Text>
          {address && (
            <Pressable style={styles.addressChip} onPress={() => open({ view: "Account" })}>
              <View style={styles.addressChipIcon}>
                <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#cfcfca" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M21 12V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2v-5z" />
                  <Path d="M16 12h5M19 12a2 2 0 11-4 0 2 2 0 014 0z" />
                </Svg>
              </View>
              <Text style={styles.addressChipText} numberOfLines={1}>
                {address.slice(0, 6)}…{address.slice(-4)}
              </Text>
            </Pressable>
          )}
        </View>

        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          {createPlan.isPending && <GeneratingSkeleton elapsed={elapsed} />}

          {createPlan.isError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>Couldn&apos;t generate a plan</Text>
              <Text style={styles.errorBody}>{createPlan.error instanceof Error ? createPlan.error.message : "Unknown error"}</Text>
              {createPlan.error instanceof FortressApiError &&
                (createPlan.error.suggestions?.length ?? 0) > 0 && (
                  <View style={styles.suggestionsWrap}>
                    {createPlan.error.suggestions!.map((s, i) =>
                      s.insertText ? (
                        <Pressable key={i} style={styles.suggestionChip} onPress={() => applySuggestion(s.insertText!)}>
                          <Text style={styles.suggestionChipText}>+ {s.label}</Text>
                        </Pressable>
                      ) : (
                        <Text key={i} style={styles.suggestionText}>{s.label}</Text>
                      ),
                    )}
                  </View>
                )}
              <Pressable style={styles.retryButton} onPress={handleGenerate}>
                <Text style={styles.retryButtonText}>Try again</Text>
              </Pressable>
            </View>
          )}

          {!createPlan.isPending && !createPlan.isError && (
            <View style={styles.emptyCenter}>
              <Reanimated.View entering={FadeInUp.duration(450)} style={{ alignItems: "center", gap: 20 }}>
                <FortressMark size={38} gradient={false} color="#FAFAFA" />
                <Text style={styles.headline}>What do you want{"\n"}to do on-chain?</Text>
              </Reanimated.View>

              <Reanimated.View entering={FadeInUp.duration(450).delay(120)} style={styles.templatesDivider}>
                <View style={styles.templatesDividerLine} />
                <Text style={styles.templatesDividerText}>Templates</Text>
                <View style={styles.templatesDividerLine} />
              </Reanimated.View>

              <View style={styles.templatesWrap}>
                {TEMPLATES.map((t, i) => (
                  <Reanimated.View key={t.title} entering={FadeInDown.duration(400).delay(200 + i * 80)}>
                    <PressableScale style={styles.templateCard} onPress={() => setPrompt(t.prompt)}>
                      <View style={styles.templateTitleRow}>
                        <TokenIcon symbol={t.token} size={17} />
                        <Text style={styles.templateTitle}>{t.title}</Text>
                      </View>
                      <Text style={styles.templateSub}>{t.sub}</Text>
                    </PressableScale>
                  </Reanimated.View>
                ))}
              </View>
            </View>
          )}
        </ScrollView>

        {!createPlan.isPending && (
          <View style={[styles.composerWrap, { paddingBottom: composerClearance }]}>
            <View style={styles.nameRow}>
              <TextInput
                style={[styles.nameInput, { flex: 1 }]}
                placeholder="Name this strategy…"
                placeholderTextColor="#54545c"
                value={name}
                onChangeText={setName}
              />
              {/* Starting token — tap cycles through registry-enabled tokens
                  (just USDC today, so it reads as a badge until more unlock). */}
              <Pressable
                style={styles.tokenChip}
                onPress={() => {
                  if (enabledTokens.length > 1) {
                    haptics.tap();
                    setTokenIdx((i) => (i + 1) % enabledTokens.length);
                  }
                }}
              >
                <TokenIcon symbol={startingToken.symbol} size={14} />
                <Text style={styles.tokenChipText}>{startingToken.symbol}</Text>
              </Pressable>
            </View>
            <View style={styles.composerPill}>
              <ComposerGlow />
              <Pressable
                style={[styles.iconButton, styles.slashButton]}
                onPress={() => {
                  haptics.tap();
                  Keyboard.dismiss();
                  setPickerOpen(true);
                }}
              >
                <Text style={styles.slashButtonText}>/</Text>
              </Pressable>
              <TextInput
                ref={inputRef}
                style={styles.composerInput}
                placeholder="Describe a strategy…"
                placeholderTextColor="#54545c"
                multiline
                value={prompt}
                onChangeText={setPrompt}
              />
              <Pressable
                style={[styles.iconButton, prompt.trim() ? styles.sendButtonActive : styles.sendButton]}
                onPress={() => {
                  haptics.press();
                  handleGenerate();
                }}
                disabled={!prompt.trim()}
              >
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={prompt.trim() ? "#0A0A0B" : "#5e5e66"} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M12 19V5M5 12l7-7 7 7" />
                </Svg>
              </Pressable>
            </View>
            <Text style={styles.composerCaption}>
              Tap <Text style={styles.mono}>/</Text> to insert a Smart Action
            </Text>
          </View>
        )}

        <ActionPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onConfirm={handleInsertAction} />
      </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// Amount row — the strategy is the structure, the amount is a parameter.
// Prefilled from the plan's parsed amount; editing reveals Simulate, which
// re-runs resolve→build→Tenderly at the new amount (no LLM call).
function AmountRow({
  preview,
  walletAddress,
  onSimulated,
}: {
  preview: Preview;
  walletAddress?: string;
  onSimulated: (preview: Preview) => void;
}) {
  const simulate = useSimulateWithAmount(fortressApi);
  const input = preview.input;
  const initial = input
    ? input.amount === "0"
      ? "1"
      : formatUnits(BigInt(input.amount), input.decimals)
    : "";
  const [value, setValue] = useState(initial);

  if (!input || !preview.rawIntent) return null;

  const dirty = value.trim() !== "" && value.trim() !== initial;

  function handleSimulate() {
    if (!walletAddress || !input || !dirty) return;
    haptics.press();
    let raw: bigint;
    try {
      raw = parseUnits(value.trim(), input.decimals);
    } catch {
      haptics.error();
      Alert.alert("Invalid amount", "Enter a valid number.");
      return;
    }
    if (raw <= BigInt(0)) {
      haptics.error();
      Alert.alert("Invalid amount", "Amount must be greater than zero.");
      return;
    }
    simulate.mutate(
      { walletAddress, intent: preview.rawIntent, amount: raw.toString() },
      {
        onSuccess: (next) => {
          haptics.success();
          onSimulated(next);
        },
        onError: (e) => {
          haptics.error();
          Alert.alert("Simulation failed", e instanceof Error ? e.message : "Try a different amount.");
        },
      },
    );
  }

  return (
    <View style={styles.amountRow}>
      <View style={styles.amountRowTop}>
        <Text style={styles.amountLabel}>Amount</Text>
        <View style={styles.amountInputWrap}>
          <TextInput
            style={styles.amountInput}
            value={value}
            onChangeText={(v) => setValue(v.replace(/[^0-9.]/g, ""))}
            keyboardType="decimal-pad"
            placeholder="1"
            placeholderTextColor="#54545c"
          />
          <Text style={styles.amountToken}>{input.symbol}</Text>
        </View>
      </View>
      {dirty && (
        <Pressable style={styles.simulateButton} onPress={handleSimulate} disabled={simulate.isPending}>
          <Text style={styles.simulateButtonText}>
            {simulate.isPending ? "Simulating…" : `Simulate with ${value.trim()} ${input.symbol}`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// Skeleton loader instead of a spinner — previews the exact layout the
// result lands in (metric row + steps card, same shapes/colors as the real
// result below) so the real data fills into the same slots instead of
// swapping to an unrelated screen. Ported from apps/web's RightGenerating /
// GhostMetricRow / GhostStepList.
function GhostBar({ w, delay = 0 }: { w: number; delay?: number }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, delay: delay * 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, delay]);

  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.85] });
  return <Animated.View style={[styles.ghostBar, { width: w, opacity }]} />;
}

function GhostMetricRow() {
  return (
    <View style={styles.metricsRow}>
      <View style={styles.metricCard}>
        <GhostBar w={52} />
        <View style={{ height: 8 }} />
        <GhostBar w={70} delay={0.1} />
      </View>
      <View style={styles.metricCard}>
        <GhostBar w={40} delay={0.15} />
        <View style={{ height: 8 }} />
        <GhostBar w={30} delay={0.25} />
      </View>
    </View>
  );
}

function GhostStepRow({ w, i }: { w: number; i: number }) {
  return (
    <View>
      {i > 0 && <View style={styles.ghostChevronWrap}><Text style={styles.chevron}>⌄</Text></View>}
      <View style={styles.row}>
        <View style={styles.indexCol}>
          <Text style={styles.indexText}>{i + 1}</Text>
        </View>
        <View style={styles.inset}>
          <View style={styles.row1}>
            <GhostBar w={w} delay={i * 0.15} />
            <GhostBar w={30} delay={i * 0.15 + 0.1} />
          </View>
          <View style={styles.divider} />
          <View style={styles.row2}>
            <View style={styles.protocolGroup}>
              <GhostBar w={16} delay={i * 0.15} />
              <GhostBar w={38} delay={i * 0.15 + 0.05} />
            </View>
            <GhostBar w={26} delay={i * 0.15 + 0.2} />
          </View>
        </View>
      </View>
    </View>
  );
}

function GeneratingSkeleton({ elapsed }: { elapsed: number }) {
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const widths = [72, 58, 66, 50];

  return (
    <View style={styles.generatingWrap}>
      <Text style={styles.generatingTitle}>Building your strategy</Text>
      <Text style={styles.generatingCaption}>This usually takes a few seconds</Text>

      <GhostMetricRow />

      <View style={styles.stepsCard}>
        <View style={styles.stepsCardHeader}>
          <Text style={styles.stepsCardTitle}>Assembling</Text>
          <Text style={styles.stepsCardCount}>
            {mm}:{ss}
          </Text>
        </View>
        <View style={styles.stepsCardBody}>
          {widths.map((w, i) => (
            <GhostStepRow key={i} w={w} i={i} />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0B" },
  centered: { alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 16 },
  notConnectedTitle: { color: "rgba(255,255,255,0.9)", fontSize: 16, fontWeight: "700" },
  notConnectedBody: { color: "rgba(255,255,255,0.4)", fontSize: 13, textAlign: "center" },
  connectButton: { backgroundColor: "#FAFAFA", borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24, marginTop: 8 },
  connectButtonText: { color: "#0A0A0B", fontSize: 13.5, fontWeight: "700" },

  header: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", zIndex: 1 },
  title: { color: "#FAFAFA", fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  addressChip: {
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingLeft: 5,
    paddingRight: 12,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  addressChipIcon: { width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
  addressChipText: { color: "rgba(255,255,255,0.85)", fontSize: 11.5, fontWeight: "600", fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }) },

  emptyCenter: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 30, gap: 20, zIndex: 1 },
  headline: { color: "#FAFAFA", fontSize: 20, fontWeight: "700", letterSpacing: -0.2, textAlign: "center", lineHeight: 27 },

  templatesDivider: { flexDirection: "row", alignItems: "center", gap: 10, width: "100%", marginTop: 6 },
  templatesDividerLine: { flex: 1, height: 1, backgroundColor: "#161619" },
  templatesDividerText: { color: "#5e5e66", fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1.4 },

  templatesWrap: { width: "100%", gap: 8 },
  templateCard: { backgroundColor: "rgba(19,19,22,0.7)", borderWidth: 1, borderColor: "#161619", borderRadius: 14, padding: 14 },
  templateTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  templateTitle: { color: "#FAFAFA", fontSize: 13.5, fontWeight: "600" },
  templateSub: { color: "#8a8a93", fontSize: 12, lineHeight: 17, marginTop: 6 },

  generatingWrap: { flex: 1, paddingHorizontal: 20, paddingTop: 20, zIndex: 1 },
  generatingTitle: { color: "#FAFAFA", fontSize: 17, fontWeight: "800", letterSpacing: -0.2 },
  generatingCaption: { color: "#5e5e66", fontSize: 12, marginTop: 3, marginBottom: 16, fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }) },
  ghostBar: { height: 9, borderRadius: 5, backgroundColor: "rgba(255,255,255,0.1)" },
  ghostChevronWrap: { alignItems: "center", paddingVertical: 3 },
  chevron: { color: "rgba(255,255,255,0.18)", fontSize: 14 },
  row: { flexDirection: "row", backgroundColor: "#161619", borderRadius: 14 },
  indexCol: { width: 28, alignItems: "center", paddingTop: 11 },
  indexText: { fontSize: 15, fontWeight: "700", color: "rgba(255,255,255,0.14)" },
  inset: { flex: 1, backgroundColor: "#0e0e11", borderRadius: 10, margin: 6, marginLeft: 0 },
  row1: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.05)", marginHorizontal: 12 },
  row2: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10 },
  protocolGroup: { flexDirection: "row", alignItems: "center", gap: 6 },

  errorBox: { marginHorizontal: 20, marginTop: 60, borderRadius: 14, borderWidth: 1, borderColor: "rgba(239,68,68,0.25)", backgroundColor: "rgba(239,68,68,0.05)", padding: 20, alignItems: "center", gap: 8, zIndex: 1 },
  errorTitle: { color: "#ef4444", fontSize: 14, fontWeight: "700" },
  errorBody: { color: "rgba(255,255,255,0.5)", fontSize: 12.5, textAlign: "center" },
  retryButton: { marginTop: 8, borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", paddingHorizontal: 16, paddingVertical: 8 },
  retryButtonText: { color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: "500" },

  resultHeaderRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14 },
  backButton: { flexDirection: "row", alignItems: "center", gap: 4 },
  backButtonText: { color: "#8a8a93", fontSize: 13, fontWeight: "600" },
  resultTitle: { color: "#FAFAFA", fontSize: 18, fontWeight: "800", letterSpacing: -0.2, flexShrink: 1, flex: 1 },
  shareButton: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  resultScrollContent: { paddingHorizontal: 20, paddingBottom: 20, gap: 12 },

  metricsRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
  metricCard: { flex: 1, backgroundColor: "#131316", borderWidth: 1, borderColor: "#1e1e22", borderRadius: 16, padding: 14 },
  metricLabel: { color: "#5e5e66", fontSize: 9, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 },
  metricValue: { color: "#FAFAFA", fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"] },

  stepsCard: { backgroundColor: "rgba(255,255,255,0.02)", borderWidth: 1, borderColor: "#1c1c20", borderRadius: 18 },
  stepsCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: "#1c1c20" },
  stepsCardTitle: { color: "#FAFAFA", fontSize: 13, fontWeight: "700" },
  stepsCardCount: { color: "#5e5e66", fontSize: 11.5, fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }) },
  stepsCardBody: { padding: 10 },

  noStepsText: { color: "rgba(255,255,255,0.3)", fontSize: 12.5, textAlign: "center", paddingVertical: 20 },

  simFailBox: { marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: "rgba(239,68,68,0.25)", backgroundColor: "rgba(239,68,68,0.05)", padding: 12 },
  simFailText: { color: "#ef4444", fontSize: 12.5 },

  deployWrap: { paddingHorizontal: 20, paddingTop: 10 },
  saveRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 12, backgroundColor: "#131316", borderWidth: 1, borderColor: "#1e1e22", paddingHorizontal: 13, paddingVertical: 11, marginBottom: 10 },
  saveRowCount: { color: "#5e5e66", fontSize: 11.5 },
  saveRowAction: { color: "#cfcfca", fontSize: 12.5, fontWeight: "600" },
  saveRowActionDisabled: { color: "#5e5e66" },
  deployButton: { backgroundColor: "#FAFAFA", borderRadius: 16, height: 52, alignItems: "center", justifyContent: "center" },
  deployButtonText: { color: "#0A0A0B", fontSize: 15, fontWeight: "700" },

  composerWrap: { paddingHorizontal: 14, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#161619", zIndex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  nameInput: { color: "#FAFAFA", fontSize: 14, fontWeight: "600", paddingHorizontal: 6, paddingBottom: 10 },
  tokenChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: "#232328",
    backgroundColor: "#131316",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 8,
  },
  tokenChipText: { color: "#cfcfca", fontSize: 11.5, fontWeight: "700" },

  suggestionsWrap: { alignSelf: "stretch", gap: 6, marginTop: 4 },
  suggestionText: { color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 17 },
  suggestionChip: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.3)",
    backgroundColor: "rgba(52,211,153,0.1)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  suggestionChipText: { color: "#34D399", fontSize: 12, fontWeight: "600" },

  amountRow: {
    borderRadius: 12,
    backgroundColor: "#131316",
    borderWidth: 1,
    borderColor: "#1e1e22",
    paddingHorizontal: 13,
    paddingVertical: 9,
    marginBottom: 10,
    gap: 8,
  },
  amountRowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  amountLabel: { color: "#5e5e66", fontSize: 9.5, textTransform: "uppercase", letterSpacing: 1 },
  amountInputWrap: { flexDirection: "row", alignItems: "center", gap: 7 },
  amountInput: {
    color: "#FAFAFA",
    fontSize: 13.5,
    fontWeight: "700",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    textAlign: "right",
    minWidth: 80,
    borderWidth: 1,
    borderColor: "#232328",
    backgroundColor: "#0e0e11",
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  amountToken: { color: "#8a8a93", fontSize: 12, fontWeight: "600" },
  simulateButton: {
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.3)",
    backgroundColor: "rgba(52,211,153,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  simulateButtonText: { color: "#34D399", fontSize: 12.5, fontWeight: "700" },
  composerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#0e0e11",
    borderWidth: 1,
    borderColor: "#1f1f24",
    borderRadius: 22,
    padding: 8,
    overflow: "hidden",
  },
  iconButton: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  slashButton: { backgroundColor: "#161a17", borderWidth: 1, borderColor: "rgba(52,211,153,0.35)" },
  slashButtonText: { color: "#34D399", fontSize: 14, fontWeight: "700", fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }) },
  composerInput: { flex: 1, color: "#FAFAFA", fontSize: 15, paddingVertical: 8, paddingHorizontal: 4, maxHeight: 100, minHeight: 22 },
  sendButton: { backgroundColor: "#1c1c1f", opacity: 0.6 },
  sendButtonActive: { backgroundColor: "#34D399" },
  composerCaption: { textAlign: "center", marginTop: 7, marginBottom: 4, color: "#5e5e66", fontSize: 10.5 },
  mono: { color: "#8a8a93", fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }) },

});
