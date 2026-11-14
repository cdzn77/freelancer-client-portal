
import { brand } from "../lib/brand";
import { Tooltips } from "@/components/tooltips";
import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";

import "./globals.css";
import "./brand.css";
import "@fontsource-variable/inter";
import "./obrack.css";
import "./search-intelligence.css";
import "./white-label.css";
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export const metadata: Metadata = {
  title: (brand.name + " | Studio workspace"),
  description:
    (brand.name + " project management. Strategy, design, and delivery."),
  icons: { icon: brand.faviconPath },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ "--brand-accent": brand.accentColor, "--brand-accent-text": brand.accentTextColor } as CSSProperties}>
        {children}
        <Tooltips />
      </body>
    </html>
  );
}
