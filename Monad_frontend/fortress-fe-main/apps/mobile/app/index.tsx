import { Redirect } from "expo-router";

// No persisted auth check exists yet (that's the SIWE milestone) — always
// land on onboarding for now rather than the tabs.
export default function Index() {
  return <Redirect href="/onboarding" />;
}
