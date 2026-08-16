// Shared Framer Motion timing so every page moves with the same eased voice.
// PANEL: layout-scale moves (panels sliding/resizing). PHASE: quick content swaps.
export const PANEL_TRANSITION = { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const };
export const PHASE_TRANSITION = { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const };

// Standard entrance for cards/panels: fade + small rise, staggered by index.
export function riseIn(index = 0) {
  return {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { ...PANEL_TRANSITION, delay: index * 0.06 },
  };
}
