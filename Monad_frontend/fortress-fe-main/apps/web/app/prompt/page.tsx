import { Suspense } from "react";
import { StrategyBuilder } from "@/components/strategy/StrategyBuilder";

// The /prompt page is the whole flow now: splash → compose → generating → result,
// revealed in place. (The old /prompt/create route redirects here.)
export default function Page() {
  return (
    <Suspense>
      <StrategyBuilder />
    </Suspense>
  );
}
