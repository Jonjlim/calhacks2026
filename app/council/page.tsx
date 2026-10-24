import type { Metadata } from "next";
import { CouncilPage } from "@/components/council/CouncilPage";

export const metadata: Metadata = {
  title: "AI Council · Unwrap",
  description: "Watch Unwrap's Fetch.ai-powered AI Council turn a memory into a gift charm and real recommendations.",
};

export default function Page() {
  return <CouncilPage />;
}
