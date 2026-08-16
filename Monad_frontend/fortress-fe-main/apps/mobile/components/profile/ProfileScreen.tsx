import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import Reanimated, { FadeIn, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useAccount, useAppKit } from "@reown/appkit-react-native";
import { PortfolioContent } from "@/components/portfolio/PortfolioContent";
import { SavedContent } from "@/components/strategy/SavedStrategies";
import { PressableScale } from "@/components/PressableScale";
import { IdenticonAvatar } from "./IdenticonAvatar";
import { colors, monoFont, radius } from "@/lib/theme";
import * as haptics from "@/lib/haptics";

type Tab = "portfolio" | "saved";

const TABS: { id: Tab; label: string }[] = [
  { id: "portfolio", label: "Portfolio" },
  { id: "saved", label: "Saved" },
];

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// The personal hub: identity header + Portfolio | Saved tabs. Mirrors web's
// /profile page (apps/web/components/profile/ProfilePage.tsx).
export function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { open } = useAppKit();
  const { isConnected, address } = useAccount();
  const [tab, setTab] = useState<Tab>("portfolio");

  if (!isConnected || !address) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.notConnectedTitle}>Connect your wallet</Text>
        <Text style={styles.notConnectedBody}>Connect your wallet to see your portfolio and saved strategies.</Text>
        <PressableScale style={styles.connectButton} onPress={() => open()}>
          <Text style={styles.connectButtonText}>Connect Wallet</Text>
        </PressableScale>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <IdentityHeader address={address} onOpenAccount={() => open({ view: "Account" })} />
      <TabBar tab={tab} onSwitch={(t) => setTab(t)} />

      {tab === "portfolio" ? (
        <Reanimated.View key="portfolio" entering={FadeIn.duration(220)} style={{ flex: 1 }}>
          <PortfolioContent />
        </Reanimated.View>
      ) : (
        <Reanimated.View key="saved" entering={FadeIn.duration(220)} style={{ flex: 1 }}>
          <SavedContent />
        </Reanimated.View>
      )}
    </View>
  );
}

function IdentityHeader({ address, onOpenAccount }: { address: string; onOpenAccount: () => void }) {
  return (
    <View style={styles.header}>
      <IdenticonAvatar address={address} size={46} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Profile</Text>
        <Pressable
          onPress={() => {
            haptics.tap();
            onOpenAccount();
          }}
          hitSlop={8}
          style={styles.addressRow}
        >
          <Text style={styles.addressText}>{shortAddress(address)}</Text>
          <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={colors.faint} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M9 18l6-6-6-6" />
          </Svg>
        </Pressable>
      </View>
    </View>
  );
}

function TabBar({ tab, onSwitch }: { tab: Tab; onSwitch: (t: Tab) => void }) {
  const { width } = useWindowDimensions();
  // Full width minus the header's horizontal padding, split across the tabs.
  const tabWidth = (width - 32) / TABS.length;

  const underlineX = useSharedValue(0);
  useEffect(() => {
    const index = TABS.findIndex((t) => t.id === tab);
    underlineX.value = withSpring(index * tabWidth, { damping: 20, stiffness: 260 });
  }, [tab, tabWidth, underlineX]);

  const underlineStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: underlineX.value }],
  }));

  return (
    <View style={styles.tabBar}>
      {TABS.map((t) => {
        const active = t.id === tab;
        return (
          <Pressable
            key={t.id}
            onPress={() => {
              if (!active) {
                haptics.tap();
                onSwitch(t.id);
              }
            }}
            style={[styles.tabButton, { width: tabWidth }]}
          >
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
          </Pressable>
        );
      })}
      <Reanimated.View style={[styles.tabUnderline, { width: tabWidth }, underlineStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 16 },
  notConnectedTitle: { color: "rgba(255,255,255,0.9)", fontSize: 16, fontWeight: "700" },
  notConnectedBody: { color: "rgba(255,255,255,0.4)", fontSize: 13, textAlign: "center" },
  connectButton: { backgroundColor: colors.fg, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24, marginTop: 8 },
  connectButtonText: { color: colors.ink, fontSize: 13.5, fontWeight: "700" },

  header: { flexDirection: "row", alignItems: "center", gap: 13, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14 },
  title: { color: colors.fg, fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  addressRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2, alignSelf: "flex-start" },
  addressText: { color: colors.muted, fontSize: 12, fontFamily: monoFont },

  tabBar: {
    flexDirection: "row",
    marginHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
    marginBottom: 12,
  },
  tabButton: { alignItems: "center", paddingVertical: 10 },
  tabLabel: { color: colors.muted, fontSize: 13.5, fontWeight: "600" },
  tabLabelActive: { color: colors.fg },
  tabUnderline: {
    position: "absolute",
    bottom: -1,
    left: 0,
    height: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.fg,
  },
});
