import * as Haptics from "expo-haptics";

// Thin haptics vocabulary so every screen speaks the same physical language.
// All fire-and-forget: haptic failures (unsupported hardware, muted engine)
// must never affect app behavior.

/** Subtle tick — selection changes, tab presses, wizard steps. */
export function tap() {
  Haptics.selectionAsync().catch(() => {});
}

/** Light thud — button presses, card taps. */
export function press() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** Something completed — plan generated, wallet connected, strategy saved. */
export function success() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** Destructive or cautionary — deletes, exits. */
export function warning() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

/** Something failed — generation error, network failure. */
export function error() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}
