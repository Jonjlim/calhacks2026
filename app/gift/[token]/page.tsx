import type { Metadata } from "next";
import { PublicGiftStory } from "@/components/story/PublicGiftStory";

export const metadata: Metadata = { title: "Your gift tag · Unwrap", robots: { index: false, follow: false } };

export default async function GiftTagPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicGiftStory token={token} />;
}
