import { StrategyDetail } from "@/components/strategy/StrategyDetail";

// Per-strategy page. Wallet-gated data is fetched client-side via useStrategy,
// with a demo-catalog fallback for mock ids.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StrategyDetail id={id} />;
}
