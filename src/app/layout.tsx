import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { Footer } from "@/components/site/Footer";
import { TopBar } from "@/components/site/TopBar";
import { appUrl } from "./(site)/_lib/env";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrument = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: "400",
  style: ["italic"],
});

export const metadata: Metadata = {
  title: "ShoperZero · Agent Readiness Score",
  description: "Can an AI assistant shop your store? Scan it, get a grade, and make it agent-ready in one click.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrument.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <TopBar mcpUrl={`${appUrl()}/api/mcp`} />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
