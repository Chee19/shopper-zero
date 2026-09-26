"use client";

import { Fragment, useState } from "react";
import type { ScanReport } from "../lib/contracts";
import { formatSeconds, formatUsd } from "../lib/format";
import { METHOD_META, METHOD_ORDER, anyPassed, costOf, probeFor, statusChip } from "../lib/methods";
import { Chip } from "../ui/Chip";
import { ArrowRight } from "../ui/icons";
import { MethodCard } from "./MethodCard";

function Arrow() {
  return (
    <div aria-hidden="true" className="flex items-center justify-center gap-1 py-1 text-muted lg:flex-col lg:py-0 lg:pt-16">
      <span className="text-[11.5px] uppercase tracking-[.08em]">if it fails</span>
      <ArrowRight size={16} className="rotate-90 lg:rotate-0" />
    </div>
  );
}

/** Three method cards in cascade order. `collapsible` shows a one-row summary that expands (report phase). */
export function CascadeBoard({ scan, now, domain, collapsible = false }: {
  scan: ScanReport; now: number | null; domain: string; collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  const passed = anyPassed(scan);

  if (collapsible && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-line bg-surface px-5 py-3 text-left shadow-card hover:bg-well"
      >
        <span className="eyebrow">Cascade</span>
        {METHOD_ORDER.map((m, i) => {
          const p = probeFor(scan, m);
          const chip = statusChip(p.status, passed);
          const c = costOf(p);
          return (
            <span key={m} className="inline-flex items-center gap-2">
              {i > 0 ? <ArrowRight size={13} className="text-muted" /> : null}
              <span className="text-[13.5px] font-[560]">{METHOD_META[m].short}</span>
              <Chip tone={chip.tone}>{chip.label}</Chip>
              {p.status === "passed" || p.status === "partial" ? (
                <span className="font-mono text-[12px] text-muted">{formatSeconds(c.s)} · {formatUsd(c.usd)}</span>
              ) : null}
            </span>
          );
        })}
        <span className="ml-auto text-[13px] text-accent-text">Show details</span>
      </button>
    );
  }

  return (
    <div>
      {collapsible ? (
        <div className="mb-2 flex justify-end">
          <button type="button" onClick={() => setOpen(false)} aria-expanded className="text-[13px] text-accent-text hover:underline">
            Collapse cascade
          </button>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-start lg:gap-3">
        {METHOD_ORDER.map((m, i) => (
          <Fragment key={m}>
            {i > 0 ? <Arrow /> : null}
            <MethodCard
              probe={probeFor(scan, m)}
              index={i}
              isBest={scan.best_method === m}
              somethingPassed={passed}
              now={now}
              domain={domain}
            />
          </Fragment>
        ))}
      </div>
    </div>
  );
}
