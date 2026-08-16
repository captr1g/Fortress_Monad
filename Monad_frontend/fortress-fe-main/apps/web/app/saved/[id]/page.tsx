import { SavedStrategyDetailPage } from "@/components/strategy/SavedStrategyDetailPage";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SavedStrategyDetailPage id={id} />;
}
