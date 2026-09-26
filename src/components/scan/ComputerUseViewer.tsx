"use client";

import { useState } from "react";
import type { AccessProbe } from "../lib/contracts";
import { CU_MAX_STEPS } from "../lib/methods";
import { Dialog } from "../ui/Dialog";
import { Lock } from "../ui/icons";
import { cx } from "../ui/tone";

type Step = NonNullable<AccessProbe["steps"]>[number];

/** Browser-window frame with the latest screenshot, filmstrip (zoom in a native <dialog>) and step log. */
export function ComputerUseViewer({ probe, domain }: { probe: AccessProbe; domain: string }) {
  const steps = probe.steps ?? [];
  const shots = probe.screenshots?.length ? probe.screenshots : steps.map((s) => s.screenshot).filter((s): s is string => Boolean(s));
  const latest = shots.at(-1) ?? null;
  const [zoom, setZoom] = useState<number | null>(null);
  const altFor = (i: number) => {
    const s = steps[i];
    return s ? `Step ${s.i}: ${s.action}` : `Screenshot ${i + 1}`;
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-xl border border-line bg-well">
        <div className="flex h-7 items-center gap-1.5 border-b border-line px-3">
          <span className="size-2 rounded-full bg-bad/70" />
          <span className="size-2 rounded-full bg-warn/70" />
          <span className="size-2 rounded-full bg-good/70" />
          <span className="ml-2 min-w-0 flex-1 truncate rounded-md bg-surface px-2 font-mono text-[11.5px] leading-[18px] text-muted">
            {domain}
          </span>
        </div>
        <div className="relative aspect-[16/10] w-full">
          {latest ? (
            // eslint-disable-next-line @next/next/no-img-element -- Storage public URLs / data: SVGs (spec 05 §4.7)
            <img key={latest} src={latest} alt={altFor(shots.length - 1)} className="absolute inset-0 size-full animate-fade object-contain" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="absolute inset-3 animate-pulse-dot rounded-lg bg-grid/50" />
              <span className="relative text-[13px] text-muted">Launching browser…</span>
            </div>
          )}
          <span className="absolute top-2 left-2 rounded-full bg-ink/80 px-2 py-0.5 font-mono text-[12px] text-page">
            Step {steps.length}/{CU_MAX_STEPS}
          </span>
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-ink/80 px-2 py-0.5 text-[12px] text-page">
            <Lock size={11} /> Stops before payment
          </span>
        </div>
      </div>

      {shots.length > 0 ? (
        <ul className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Screenshots">
          {shots.map((src, i) => (
            <li key={`${i}-${src.slice(-24)}`} className="shrink-0">
              <button
                type="button"
                onClick={() => setZoom(i)}
                aria-label={`Open ${altFor(i)}`}
                className={cx(
                  "block h-[35px] w-14 overflow-hidden rounded-md border bg-well",
                  i === shots.length - 1 ? "border-accent" : "border-line hover:border-ink-2",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="size-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <StepLog steps={steps} />

      <Dialog open={zoom != null} onClose={() => setZoom(null)} title={zoom != null ? altFor(zoom) : "Screenshot"}>
        {zoom != null && shots[zoom] ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shots[zoom]} alt={altFor(zoom)} className="max-h-[75vh] w-full rounded-lg object-contain" />
            {steps[zoom]?.reasoning ? <p className="mt-2 text-[13px] text-ink-2">{steps[zoom]!.reasoning}</p> : null}
          </>
        ) : null}
      </Dialog>
    </div>
  );
}

export function StepLog({ steps }: { steps: Step[] }) {
  // Newest last, the last 6 visible (the log never needs scrolling).
  const last = steps.slice(-6);
  if (steps.length === 0) return null;
  return (
    <ol className="flex flex-col gap-1" aria-label="Step log">
      {last.map((s) => (
        <li key={s.i} className="grid animate-rise grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-[12.5px]">
          <span className="font-mono text-muted">#{s.i}</span>
          <span className="min-w-0">
            <span className="font-mono">{s.action}</span>
            {s.reasoning ? <span className="block truncate text-muted" title={s.reasoning}>{s.reasoning}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
