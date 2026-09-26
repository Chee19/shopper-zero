import type { Metadata } from "next";
import { ScanForm } from "@/components/scan/ScanForm";
import { demoPresets } from "../_lib/demo";

export const metadata: Metadata = { title: "Scan a store · ShoperZero" };

export default function ScanIndexPage() {
  return (
    <div className="mx-auto max-w-[760px] px-5 py-16 md:px-7">
      <p className="eyebrow">Agent Readiness Score</p>
      <h1 className="mt-2 text-[30px] font-semibold tracking-tight">Scan a store</h1>
      <p className="mt-2 mb-6 text-ink-2">We try an API first, then reading the page, then computer use, and stop at the first that works.</p>
      <ScanForm presets={demoPresets(process.env.WOO_DEMO_URL)} autoFocus />
    </div>
  );
}
