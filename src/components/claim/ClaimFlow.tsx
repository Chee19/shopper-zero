"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ApiErrorBody, ClaimMethod } from "../lib/contracts";
import { ago } from "../lib/format";
import { useNow } from "../realtime/replay";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { CodeBlock, MonoCopy } from "../ui/CodeBlock";
import { Dialog } from "../ui/Dialog";
import { Check } from "../ui/icons";
import { ErrorState, Skeleton } from "../ui/States";
import type { CheckResult, ClaimAction, ClaimView } from "./types";

type Resp = { claim: ClaimView; check?: CheckResult };
type Fail = { status: number; message: string; check?: CheckResult };

async function callClaims(slug: string, action: ClaimAction, method?: ClaimMethod): Promise<{ ok: true; data: Resp } | { ok: false; fail: Fail }> {
  try {
    const res = await fetch("/api/v1/claims", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ slug, action, ...(method ? { method } : {}) }),
    });
    const body = (await res.json().catch(() => null)) as (Resp & Partial<ApiErrorBody>) | null;
    if (res.ok && body?.claim) return { ok: true, data: body };
    const details = body?.error?.details as { check?: CheckResult } | undefined;
    return { ok: false, fail: { status: res.status, message: body?.error?.message ?? `Request failed (${res.status})`, check: details?.check } };
  } catch {
    return { ok: false, fail: { status: 0, message: "Network error" } };
  }
}

const METHOD_LABEL: Record<ClaimMethod, string> = { dns_txt: "DNS TXT", meta_tag: "meta tag" };

export function ClaimFlow({ slug, domain, storeHref }: { slug: string; domain: string; storeHref: string }) {
  const [claim, setClaim] = useState<ClaimView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [checks, setChecks] = useState<Partial<Record<ClaimMethod, CheckResult>>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"rotate" | "opt_out" | null>(null);
  const now = useNow(Boolean(claim?.verified_at), 30_000);

  useEffect(() => {
    let alive = true;
    void callClaims(slug, "start").then((r) => {
      if (!alive) return;
      if (r.ok) {
        setClaim(r.data.claim);
        setLoadError(null);
      } else {
        setLoadError(r.fail.message);
      }
    });
    return () => { alive = false; };
  }, [slug, attempt]);

  async function act(action: ClaimAction, method?: ClaimMethod) {
    setBusy(`${action}:${method ?? ""}`);
    setActionError(null);
    const r = await callClaims(slug, action, method);
    setBusy(null);
    if (r.ok) {
      setClaim(r.data.claim);
      if (r.data.check) setChecks((c) => ({ ...c, [r.data.check!.method]: r.data.check }));
      if (action === "rotate") setChecks({});
      return;
    }
    if (r.fail.check) setChecks((c) => ({ ...c, [r.fail.check!.method]: r.fail.check }));
    setActionError(r.fail.status === 403 ? "We couldn't re-verify your domain, so nothing changed." : r.fail.message);
  }

  if (loadError) {
    return (
      <ErrorState title="Couldn't start the claim" action={<Button onClick={() => { setLoadError(null); setAttempt((a) => a + 1); }}>Retry</Button>}>
        {loadError}
      </ErrorState>
    );
  }
  if (!claim) {
    return (
      <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label="Loading claim">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    );
  }

  const verifyMethod: ClaimMethod = claim.method;
  const dialogs = (
    <Dialog
      open={confirm !== null}
      onClose={() => setConfirm(null)}
      title={confirm === "rotate" ? "Generate a new token?" : "Opt out of the index?"}
      className="w-[min(520px,94vw)]"
    >
      <p className="text-[14px] text-ink-2">
        {confirm === "rotate"
          ? "The current token stops working and the store becomes unverified until you publish the new one."
          : "Agents will no longer see this store's products. You can opt back in at any time."}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
        <Button
          onClick={() => {
            const c = confirm;
            setConfirm(null);
            if (c === "rotate") void act("rotate", claim.method);
            if (c === "opt_out") void act("opt_out", verifyMethod);
          }}
        >
          {confirm === "rotate" ? "Generate new token" : "Opt out"}
        </Button>
      </div>
    </Dialog>
  );
  const errorLine = actionError ? <p role="alert" className="text-[14px] text-bad-text">{actionError}</p> : null;

  if (claim.status === "verified" && claim.opted_out) {
    return (
      <Card className="px-5 py-6 md:px-7">
        <p className="text-[17px] font-[560]">Opted out. Agents no longer see this store.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => void act("opt_in", verifyMethod)} pending={busy?.startsWith("opt_in")}>Opt back in</Button>
          {errorLine}
        </div>
      </Card>
    );
  }

  if (claim.status === "verified") {
    return (
      <div className="flex flex-col gap-4">
        <Card className="px-5 py-6 md:px-7">
          <p className="flex flex-wrap items-center gap-2 text-[17px]">
            <Check size={18} className="text-good-text" />
            <span className="font-display text-[21px] italic">Verified merchant</span>
            <span className="text-ink-2">
              · {domain} · claimed {claim.verified_at && now != null ? ago(claim.verified_at, now) : "just now"} via {METHOD_LABEL[claim.method]}
            </span>
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-[14px]">
            <Link href={storeHref} className="text-accent-text hover:underline">Store page →</Link>
            <Link href={`${storeHref}#connect`} className="text-accent-text hover:underline">Agent surfaces →</Link>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button variant="secondary" onClick={() => setConfirm("opt_out")} pending={busy?.startsWith("opt_out")}>
              Opt out of the index
            </Button>
            {errorLine}
          </div>
        </Card>
        <Card className="px-5 py-5 md:px-7">
          <h2 className="eyebrow">Coming soon</h2>
          <ul className="mt-2 list-disc pl-5 text-[14px] text-ink-2">
            <li>Field overrides</li>
            <li>Live-price webhook</li>
            <li>Native checkout (plugin / Stripe Connect)</li>
            <li>Serving /.well-known/ucp from your own domain</li>
          </ul>
        </Card>
        {dialogs}
      </div>
    );
  }

  const dns = claim.instructions.dns_txt;
  const meta = claim.instructions.meta_tag;
  const apex = dns.alt_hosts[0];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-3 px-5 py-5">
          <h2 className="eyebrow">Option A · DNS TXT</h2>
          <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 text-[14px]">
            <span className="text-muted">Host</span><MonoCopy value={dns.host} />
            <span className="text-muted">Value</span><MonoCopy value={dns.value} />
          </div>
          {apex ? <p className="text-[12.5px] text-muted">Apex {apex} also works. DNS can take a few minutes.</p> : null}
          <div className="mt-auto flex flex-wrap items-center gap-3">
            <Button onClick={() => void act("verify", "dns_txt")} pending={busy === "verify:dns_txt"}>Verify DNS</Button>
          </div>
          <CheckLine check={checks.dns_txt} />
        </Card>
        <Card className="flex flex-col gap-3 px-5 py-5">
          <h2 className="eyebrow">Option B · Meta tag</h2>
          <CodeBlock code={meta.html} className="[&_pre]:whitespace-pre-wrap [&_pre]:break-all" />
          <p className="text-[13px] text-ink-2">Paste inside <code className="font-mono">&lt;head&gt;</code> of {meta.url}</p>
          <div className="mt-auto flex flex-wrap items-center gap-3">
            <Button onClick={() => void act("verify", "meta_tag")} pending={busy === "verify:meta_tag"}>Verify meta tag</Button>
          </div>
          <CheckLine check={checks.meta_tag} />
        </Card>
      </div>
      {errorLine}
      <button type="button" onClick={() => setConfirm("rotate")} className="self-start text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline">
        Generate a new token
      </button>
      {dialogs}
    </div>
  );
}

function CheckLine({ check }: { check: CheckResult | undefined }) {
  if (!check) return null;
  if (check.ok) return <p role="status" className="text-[13.5px] text-good-text">✓ Found it. Verified.</p>;
  return (
    <div role="status" className="text-[13px]">
      <p className="text-bad-text">
        ✗ {check.observed.length > 0 ? `We found: ${check.observed.join(", ")}` : "No record found yet."}
      </p>
      {check.hint ? <p className="mt-0.5 text-ink-2">{check.hint}</p> : null}
    </div>
  );
}
