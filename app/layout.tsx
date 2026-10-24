import type { Metadata } from "next";
import { Caveat, Cormorant_Garamond, Figtree } from "next/font/google";
import type { ReactNode } from "react";
import { ConvexClientProvider } from "@/components/providers/ConvexClientProvider";
import { IslandWorldProvider } from "@/components/world/IslandWorldProvider";
import "./globals.css";

const display = Cormorant_Garamond({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-cormorant", display: "swap" });
const sans = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap" });
const hand = Caveat({ subsets: ["latin"], weight: ["500"], variable: "--font-caveat", display: "swap" });

export const metadata: Metadata = {
  title: "Unwrap",
  description: "Turn what your friends remember into a gift you choose together.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${hand.variable}`}>
      <body className="min-h-screen antialiased" suppressHydrationWarning>
        <ConvexClientProvider><IslandWorldProvider>{children}</IslandWorldProvider></ConvexClientProvider>
      </body>
    </html>
  );
}
