import type { Metadata } from "next";
import { RecipientTwin } from "@/components/giftTwin/RecipientTwin";

export const metadata: Metadata = {
  title: "Your Gift Twin · Unwrap",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function RecipientTwinPage() {
  return <RecipientTwin />;
}
