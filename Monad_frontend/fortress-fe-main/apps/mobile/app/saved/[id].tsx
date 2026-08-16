import { useLocalSearchParams } from "expo-router";
import { SavedStrategyDetailPage } from "@/components/strategy/SavedStrategyDetailPage";

export default function SavedDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SavedStrategyDetailPage id={id} />;
}
