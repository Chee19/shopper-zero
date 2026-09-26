"use client";

import { useState } from "react";
import Link from "next/link";
import type { ScanReport } from "../lib/contracts";
import { Button, ButtonLink } from "../ui/Button";
import { Card } from "../ui/Card";
import { ArrowRight } from "../ui/icons";

export type CtaResult = { error: string; blocked?: boolean } | null;

export function AgentReadyCta({
  scan, domain, slug, optedOut, onMakeReady,
}: {
  scan: ScanReport; domain: string; slug: string | null; optedOut: boolean;
  /** Starts indexing; resolves with an error to show, or null on success. */
  onMakeReady: () => Promise<CtaResult>;
}) {
  const [pending, setPending] = useState(false);
  const [started, setStarted] = useState(false); // navigation to ?run= is in flight: never POST a second crawl
  const [result, setResult] = useState<CtaResult>(null);
  const claimHref = slug ? `/claim/${slug}` : null;

  if (optedOut) {
    return (
      <Card className="px-5 py-5 md:px-7">
        <p className="font-[560]">The merchant opted out.</p>
        <p className="text-[14px] text-ink-2">ShoperZero doesn&apos;t index or publish this store.</p>
      </Card>
    );
  }

  async function run() {
    setPending(true);
    setResult(null);
    const r = await onMakeReady();
    setResult(r);
    setPending(false);
    if (!r) setStarted(true);
  }

  const fixable = scan.best_method === "api" || scan.best_method === "dom";
  const errorBox = result ? (
    <div role="alert" className="mt-3 rounded-xl border border-bad/40 bg-bad/8 px-4 py-3 text-[14px]">
      {result.blocked ? (
        <>
          Blocked by bot protection. The merchant can claim to opt in.
          {claimHref ? <Link href={claimHref} className="ml-2 text-accent-text hover:underline">Claim this store →</Link> : null}
        </>
      ) : (
        <>
          {result.error}
          <button type="button" onClick={run} className="ml-2 text-accent-text hover:underline">Retry</button>
        </>
      )}
    </div>
  ) : null;

  if (fixable) {
    return (
      <Card className="relative overflow-hidden border-accent/40 px-5 py-6 md:px-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="min-w-0 flex-1">
            <h2 className="text-[22px] font-semibold tracking-tight">Make it agent-ready</h2>
            <p className="mt-1 text-ink-2">
              We&apos;ll index the catalog using the {scan.best_method === "api" ? "API" : "web scraping"} path we just
              found and host UCP, MCP, products.json, an ACP feed and llms.txt for {domain}. No plugin, no code.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={run} pending={pending || started} className="h-12 px-6 text-[15px]">
              {pending || started ? "Starting…" : "Make it agent-ready"} {!pending && !started ? <ArrowRight size={16} /> : null}
            </Button>
            {claimHref ? (
              <Link href={claimHref} className="text-[14px] text-ink-2 hover:text-ink hover:underline">Is this your store? Claim it</Link>
            ) : null}
          </div>
        </div>
        {errorBox}
      </Card>
    );
  }

  return (
    <Card className="px-5 py-6 md:px-7">
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <h2 className="text-[22px] font-semibold tracking-tight">Only a merchant can fix this one</h2>
          <p className="mt-1 text-ink-2">No machine-readable catalog was found. Claim the store to connect a feed or install our plugin.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {claimHref ? <ButtonLink href={claimHref}>Claim this store</ButtonLink> : null}
          <Button variant="secondary" onClick={run} pending={pending || started}>Try indexing anyway</Button>
        </div>
      </div>
      {errorBox}
    </Card>
  );
}
