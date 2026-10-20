import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "PulseTwin | Digital Twin Health Monitor",
  description:
    "A synthetic-data proof of concept for fusing clinical history and wearable signals to explore personalized diabetes risk monitoring.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
