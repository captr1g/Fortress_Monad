import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Stop } from "react-native-svg";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { colors } from "@/lib/theme";

// Bank-vault lock mechanism, abstracted: three concentric rings counter-rotating
// at very different speeds behind the logo, plus a soft breathing glow at the
// center. Strokes are a dim green→gold gradient — the app's one splash of color.
// Everything is transform-only (rotate/scale/opacity), so it runs entirely on
// the UI thread at 60fps.

function Ring({
  size,
  radius,
  strokeWidth,
  dash,
  opacity,
  durationMs,
  clockwise,
}: {
  size: number;
  radius: number;
  strokeWidth: number;
  dash: string;
  opacity: number;
  durationMs: number;
  clockwise: boolean;
}) {
  const turns = useSharedValue(0);

  useEffect(() => {
    turns.value = withRepeat(withTiming(1, { duration: durationMs, easing: Easing.linear }), -1);
  }, [turns, durationMs]);

  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turns.value * (clockwise ? 360 : -360)}deg` }],
  }));

  const c = size / 2;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.green} />
            <Stop offset="1" stopColor={colors.gold} />
          </LinearGradient>
        </Defs>
        <Circle
          cx={c}
          cy={c}
          r={radius}
          fill="none"
          stroke="url(#ringGrad)"
          strokeWidth={strokeWidth}
          strokeDasharray={dash}
          strokeLinecap="round"
          opacity={opacity}
        />
      </Svg>
    </Animated.View>
  );
}

function CenterGlow({ size }: { size: number }) {
  const breathe = useSharedValue(0);

  useEffect(() => {
    breathe.value = withRepeat(
      withTiming(1, { duration: 4800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true, // reverse — inhale, exhale
    );
  }, [breathe]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.5 + breathe.value * 0.5,
    transform: [{ scale: 0.94 + breathe.value * 0.12 }],
  }));

  const c = size / 2;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="glowGrad" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={colors.green} stopOpacity={0.14} />
            <Stop offset="0.6" stopColor={colors.green} stopOpacity={0.05} />
            <Stop offset="1" stopColor={colors.green} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={c} cy={c} r={c} fill="url(#glowGrad)" />
      </Svg>
    </Animated.View>
  );
}

export function VaultRings({ size }: { size: number }) {
  const scale = size / 460; // ring geometry designed on a 460pt square

  return (
    <Animated.View pointerEvents="none" style={{ width: size, height: size }}>
      <CenterGlow size={size} />
      {/* Outer dial — dense thin ticks, like the machined edge of a vault wheel. */}
      <Ring
        size={size}
        radius={212 * scale}
        strokeWidth={11 * scale}
        dash={`${1.6 * scale} ${20.6 * scale}`}
        opacity={0.16}
        durationMs={90_000}
        clockwise
      />
      {/* Middle ring — long segmented arcs. */}
      <Ring
        size={size}
        radius={168 * scale}
        strokeWidth={1.6 * scale}
        dash={`${84 * scale} ${42 * scale}`}
        opacity={0.2}
        durationMs={62_000}
        clockwise={false}
      />
      {/* Inner ring — one long arc with a gap, nearly solid. */}
      <Ring
        size={size}
        radius={128 * scale}
        strokeWidth={1.2 * scale}
        dash={`${300 * scale} ${100 * scale}`}
        opacity={0.13}
        durationMs={44_000}
        clockwise
      />
    </Animated.View>
  );
}
