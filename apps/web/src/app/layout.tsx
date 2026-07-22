import type { ReactNode } from "react";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "@aitg/ui/styles.css";
import { Providers } from "../components/Providers";

/**
 * IBM Plex, not Inter or Geist. Plex was commissioned to express the
 * relationship between people and machines, which is this product's entire
 * thesis: machine-written tests, human verification. Mono carries every path,
 * score, and label because this audience reads monospace natively.
 */
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata = {
  title: "AI Test Integrity Guard",
  description:
    "Mutation-tested quality gates for AI-generated code. Coverage is not quality.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${sans.variable} ${mono.variable}`}>
      <body
        style={{
          fontFamily: "var(--font-plex-sans), var(--font-sans)",
        }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
