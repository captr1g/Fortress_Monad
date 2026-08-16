import { redirect } from "next/navigation";

// Legacy route — the builder now lives at /prompt (splash → compose → result, in place).
export default function Page() {
  redirect("/prompt");
}
