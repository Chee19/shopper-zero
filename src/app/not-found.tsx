import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/Button";

export const metadata: Metadata = { title: "Not found · ShoperZero" };

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[1240px] px-5 py-24 text-center md:px-7">
      <p className="eyebrow">404</p>
      <h1 className="mt-2 text-[30px] font-semibold tracking-tight">Nothing here</h1>
      <p className="mx-auto mt-2 max-w-md text-ink-2">That page, scan or store doesn&apos;t exist. Scan a store to create one.</p>
      <div className="mt-6 flex justify-center gap-2">
        <ButtonLink href="/">Scan a store</ButtonLink>
        <ButtonLink href="/scan/replay-dom" variant="secondary">Watch a recorded scan</ButtonLink>
      </div>
    </div>
  );
}
