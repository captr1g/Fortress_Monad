import { redirect } from "next/navigation";

// Saved strategies now live on the profile page (Saved tab). Keep this route
// alive so old links and bookmarks still land somewhere sensible.
export default function Page() {
  redirect("/profile?tab=saved");
}
