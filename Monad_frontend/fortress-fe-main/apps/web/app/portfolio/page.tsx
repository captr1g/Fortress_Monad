import { redirect } from "next/navigation";

// Portfolio now lives on the profile page (Portfolio tab). Keep this route
// alive so old links and bookmarks still land somewhere sensible.
export default function Page() {
  redirect("/profile");
}
