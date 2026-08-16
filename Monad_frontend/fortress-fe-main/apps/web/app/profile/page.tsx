import { Suspense } from "react";
import { ProfilePage } from "@/components/profile/ProfilePage";

export const metadata = {
  title: "Profile | Fortress",
  description: "Your portfolio and saved strategies.",
};

export default function Page() {
  return (
    <Suspense>
      <ProfilePage />
    </Suspense>
  );
}
