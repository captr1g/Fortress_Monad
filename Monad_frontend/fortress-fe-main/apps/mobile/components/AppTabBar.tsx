import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View, type ColorValue } from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { colors } from "@/lib/theme";
import { tap } from "@/lib/haptics";

// Structural subset of @react-navigation/bottom-tabs' BottomTabBarProps —
// that package isn't directly resolvable here (expo-router keeps it as an
// internal dependency), so we type only the fields this bar actually uses.
type TabBarProps = {
  state: { index: number; routes: Array<{ key: string; name: string }> };
  descriptors: Record<
    string,
    {
      options: {
        title?: string;
        tabBarAccessibilityLabel?: string;
        tabBarIcon?: (props: { focused: boolean; color: ColorValue; size: number }) => React.ReactNode;
      };
    }
  >;
  navigation: {
    emit: (event: { type: "tabPress"; target?: string; canPreventDefault: true }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
};

// Content height of the bar above the home-indicator inset. Screens that scroll
// under the bar add TAB_BAR_BASE_HEIGHT + insets.bottom to their bottom padding.
export const TAB_BAR_BASE_HEIGHT = 56;

const INDICATOR_WIDTH = 56;
const INDICATOR_HEIGHT = 30;

// Glass tab bar: real BlurView (content scrolls beneath it), a springing pill
// indicator behind the active icon, and a haptic tick on every switch.
export function AppTabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const [barWidth, setBarWidth] = useState(0);

  const tabCount = state.routes.length;
  const tabWidth = barWidth / Math.max(tabCount, 1);

  const indicatorX = useSharedValue(0);
  useEffect(() => {
    if (!tabWidth) return;
    indicatorX.value = withSpring(state.index * tabWidth + (tabWidth - INDICATOR_WIDTH) / 2, {
      damping: 18,
      stiffness: 220,
    });
  }, [state.index, tabWidth, indicatorX]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.value }],
  }));

  return (
    <View
      onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
      style={[styles.bar, { height: TAB_BAR_BASE_HEIGHT + insets.bottom, paddingBottom: insets.bottom }]}
    >
      <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
      {/* Blur alone is too transparent over bright content — deepen it. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(10,10,11,0.72)" }]} />
      <View style={styles.hairline} />

      {barWidth > 0 && (
        <Animated.View style={[styles.indicator, { top: (TAB_BAR_BASE_HEIGHT - INDICATOR_HEIGHT) / 2 - 4 }, indicatorStyle]} />
      )}

      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const focused = state.index === index;
        const label = options.title ?? route.name;
        const color = focused ? colors.greenBright : colors.faint;

        function onPress() {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            tap();
            navigation.navigate(route.name);
          }
        }

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
            onPress={onPress}
            style={styles.tab}
          >
            {options.tabBarIcon?.({ focused, color, size: 23 })}
            <Text style={[styles.label, { color: focused ? colors.fg : colors.faint }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    overflow: "hidden",
  },
  hairline: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  indicator: {
    position: "absolute",
    left: 0,
    width: INDICATOR_WIDTH,
    height: INDICATOR_HEIGHT,
    borderRadius: INDICATOR_HEIGHT / 2,
    backgroundColor: "rgba(52,211,153,0.10)",
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingTop: 6,
  },
  label: {
    fontSize: 10,
    fontWeight: "600",
  },
});
