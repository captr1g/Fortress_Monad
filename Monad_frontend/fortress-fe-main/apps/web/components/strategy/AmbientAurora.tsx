// Ambient equalizer band — blurred vertical bars pulsing at the bottom edge.
// The app's one allowed splash of color (brand palette only); keep opacity low.
const EQ_PALETTE = ["var(--color-green)", "var(--color-green-bright)", "var(--color-gold)", "var(--color-amber)"];
const EQ_ANIMS = ["feq1", "feq2", "feq3"] as const;
const EQ_COLS = Array.from({ length: 18 }, (_, i) => ({
  c: EQ_PALETTE[i % EQ_PALETTE.length],
  anim: EQ_ANIMS[i % EQ_ANIMS.length],
  d: 2.2 + ((i * 0.37) % 1.6),
  delay: (i * 0.17) % 1.2,
}));

export function AmbientAurora({ opacity = 0.28 }: { opacity?: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-x-0 bottom-[-14%] flex h-[68%] w-full items-end gap-[3px]"
        style={{ filter: "blur(56px)", opacity }}
      >
        {EQ_COLS.map((col, i) => (
          <div
            key={i}
            className="flex-1"
            style={{
              height: "100%",
              transformOrigin: "bottom",
              background: `linear-gradient(to top, ${col.c}, transparent 82%)`,
              animation: `${col.anim} ${col.d}s ease-in-out ${col.delay}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
