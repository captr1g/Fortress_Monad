import { useEffect } from "react";
import type { DimensionValue } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

// Pulsing placeholder bar — the app-wide loading primitive (same breathing
// rhythm as PromptScreen's generating skeleton). All bars pulse in unison,
// which reads calmer than staggered shimmering.
export function SkeletonBar({
  width,
  height = 10,
  radius = 5,
}: {
  width: DimensionValue;
  height?: number;
  radius?: number;
}) {
  const pulse = useSharedValue(0.35);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.85, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [pulse]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius: radius, backgroundColor: "rgba(255,255,255,0.1)" },
        style,
      ]}
    />
  );
}
