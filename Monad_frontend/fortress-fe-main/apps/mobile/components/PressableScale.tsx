import { type ComponentProps } from "react";
import { Pressable } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { press as hapticPress } from "@/lib/haptics";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = ComponentProps<typeof Pressable> & {
  /** How far the element sinks while pressed. Default 0.97. */
  pressScale?: number;
  /** Fire the light-impact haptic on press-in. Default true. */
  haptic?: boolean;
};

// The app's standard tappable surface: sinks with a spring while pressed and
// ticks the haptic engine, so every button/card shares the same physical feel.
export function PressableScale({ pressScale = 0.97, haptic = true, style, onPressIn, onPressOut, ...rest }: Props) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      {...rest}
      style={[style as object, animatedStyle]}
      onPressIn={(e) => {
        scale.value = withSpring(pressScale, { damping: 22, stiffness: 420 });
        if (haptic) hapticPress();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, { damping: 18, stiffness: 320 });
        onPressOut?.(e);
      }}
    />
  );
}
