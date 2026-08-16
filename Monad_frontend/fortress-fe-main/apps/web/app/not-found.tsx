import Link from "next/link";

export default function NotFound() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/3 h-[40vw] w-[40vw] -translate-x-1/2 rounded-full blur-[140px]"
        style={{ background: "radial-gradient(circle, rgba(16,185,129,.18), transparent 70%)" }}
      />
      <div className="relative">
        <div className="mono text-[72px] font-semibold leading-none text-fg-soft">404</div>
        <h1 className="mt-4 text-[20px] font-bold tracking-tight">This page drifted off-chain</h1>
        <p className="mx-auto mt-2 max-w-[380px] text-[14px] text-muted">
          The page you&apos;re looking for doesn&apos;t exist or has moved.
        </p>
        <div className="mt-7 flex items-center justify-center gap-3">
          <Link
            href="/prompt"
            className="inline-flex h-10 items-center rounded-lg bg-fg px-5 text-[13.5px] font-semibold text-ink transition active:scale-[0.98]"
          >
            Build a strategy
          </Link>
          <Link
            href="/strategies"
            className="inline-flex h-10 items-center rounded-lg border border-line bg-surface px-5 text-[13.5px] font-medium text-fg-soft transition-colors hover:bg-surface-2"
          >
            My strategies
          </Link>
        </div>
      </div>
    </div>
  );
}
