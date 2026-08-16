import { useEffect, useRef } from "react";
import { Animated, StyleSheet } from "react-native";
import Svg, { Defs, RadialGradient, Stop, Circle } from "react-native-svg";

// Ported from apps/web/components/strategy/RichPromptInput.tsx's inner
// composer glow — two soft drifting radial blobs behind the text, at low
// opacity, blurred. Web's version is sized relative to a tall (160px+)
// textarea card; the composer here is a short pill, so the blobs are tuned
// to pixel sizes that read as a gentle moving wash rather than the literal
// percentage geometry (which assumed a much taller box).
function driftLoop(value: Animated.Value, durationMs: number) {
  const loop = Animated.loop(
    Animated.sequence([
      Animated.timing(value, { toValue: 1, duration: durationMs / 2, useNativeDriver: true }),
      Animated.timing(value, { toValue: 0, duration: durationMs / 2, useNativeDriver: true }),
    ]),
  );
  loop.start();
  return () => loop.stop();
}

export function ComposerGlow() {
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;

  useEffect(() => driftLoop(a, 9000), [a]);
  useEffect(() => driftLoop(b, 11000), [b]);

  const aTranslateX = a.interpolate({ inputRange: [0, 1], outputRange: [-8, 18] });
  const aTranslateY = a.interpolate({ inputRange: [0, 1], outputRange: [-6, 10] });
  const bTranslateX = b.interpolate({ inputRange: [0, 1], outputRange: [10, -14] });
  const bTranslateY = b.interpolate({ inputRange: [0, 1], outputRange: [8, -8] });

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wrap]}>
      <Animated.View style={[styles.blobWrap, { left: -30, top: -30, transform: [{ translateX: aTranslateX }, { translateY: aTranslateY }] }, blurStyle(20)]}>
        <Svg width={140} height={140}>
          <Defs>
            <RadialGradient id="glowA" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#10b981" stopOpacity={0.6} />
              <Stop offset="0.6" stopColor="#10b981" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={70} cy={70} r={70} fill="url(#glowA)" />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.blobWrap, { right: -30, top: -20, transform: [{ translateX: bTranslateX }, { translateY: bTranslateY }] }, blurStyle(22)]}>
        <Svg width={130} height={130}>
          <Defs>
            <RadialGradient id="glowB" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#facc15" stopOpacity={0.42} />
              <Stop offset="0.6" stopColor="#facc15" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={65} cy={65} r={65} fill="url(#glowB)" />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

function blurStyle(radius: number) {
  return { filter: [{ blur: radius }] as any };
}

const styles = StyleSheet.create({
  wrap: { opacity: 0.16, overflow: "hidden" },
  blobWrap: { position: "absolute" },
});
