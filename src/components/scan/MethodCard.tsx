"use client";

import { useState } from "react";
import type { AccessProbe, Capabilities, DomRecipe, ProbeSignal } from "../lib/contracts";
import { ago, elapsed, formatSeconds, formatUsd } from "../lib/format";
import { CAPABILITY_KEYS, CAPABILITY_LABELS, METHOD_META, costOf, statusChip } from "../lib/methods";
import { Chip } from "../ui/Chip";
import { Check, External, X } from "../ui/icons";
import { TONE, cx } from "../ui/tone";
import { ComputerUseViewer } from "./ComputerUseViewer";

export function MethodCard({
  probe, index, isBest, somethingPassed, now, domain,
}: {
  probe: AccessProbe; index: number; isBest: boolean; somethingPassed: boolean; now: number | null; domain: string;
}) {
  const m = probe.method;
  const chip = statusChip(probe.status, somethingPassed);
  const running = probe.status === "running";
  const duration =
    probe.duration_ms ?? (running && probe.started_at && now != null ? Math.max(0, now - Date.parse(probe.started_at)) : null);

  if (probe.status === "skipped") {
    return (
      <article
        aria-label={`${index + 1} ${METHOD_META[m].label}: ${chip.label}`}
        className="flex h-11 items-center gap-3 rounded-card border border-line bg-surface/60 px-4 text-ink-2"
      >
        <span className="font-mono text-[12px] text-muted">{index + 1}</span>
        <span className="truncate text-[14px] font-[560]">{METHOD_META[m].label}</span>
        <Chip tone="muted" className="ml-auto">{chip.label}</Chip>
      </article>
    );
  }

  return (
    <article
      aria-label={`${index + 1} ${METHOD_META[m].label}: ${chip.label}`}
      className={cx(
        "relative flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card",
        isBest && "ring-2 ring-accent",
      )}
    >
      <div
        aria-hidden="true"
        className={cx("h-[3px] w-full", running ? "shimmer-bar animate-shimmer" : TONE[chip.tone].strip)}
      />
      <header className="flex flex-wrap items-start gap-2 px-5 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-muted">{index + 1}</span>
            <h3 className="truncate text-[16px] font-semibold tracking-tight">{METHOD_META[m].label}</h3>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Chip tone={chip.tone} dot pulse={running}>{chip.label}</Chip>
            <Chip tone="muted">{METHOD_META[m].band} band</Chip>
            {isBest ? <Chip tone="accent">Best method found</Chip> : null}
          </div>
        </div>
        {duration != null ? (
          <span className="font-mono text-[12.5px] tabular-nums text-ink-2" aria-label="Duration">{elapsed(duration)}</span>
        ) : null}
      </header>

      <div className="flex flex-1 flex-col gap-3 px-5 pb-5">
        {probe.status === "blocked" ? (
          <p className="rounded-lg bg-warn/12 px-3 py-2 text-[13px] text-ink-2">We don&apos;t bypass challenges.</p>
        ) : null}
        {probe.status === "pending" ? (
          <p className="text-[13.5px] text-muted">{METHOD_META[m].blurb}</p>
        ) : (
          <SignalList signals={probe.signals} running={running} />
        )}

        {m === "computer_use" && (running || (probe.screenshots?.length ?? 0) > 0 || (probe.steps?.length ?? 0) > 0) ? (
          <ComputerUseViewer probe={probe} domain={domain} />
        ) : null}
        {m === "api" && probe.endpoints?.length ? <ApiEndpoints endpoints={probe.endpoints} /> : null}
        {m === "dom" && probe.recipe && Object.keys(probe.recipe).length > 0 ? (
          <DomRecipePreview recipe={probe.recipe} now={now} />
        ) : null}

        {probe.status !== "pending" ? <CapabilityRow capabilities={probe.capabilities} /> : null}
        <CostLine probe={probe} />
        {probe.error && probe.status !== "blocked" ? (
          <p className="text-[12.5px] text-bad-text"><span className="font-mono">{probe.error.code}</span> · {probe.error.message}</p>
        ) : null}
      </div>
    </article>
  );
}

export function SignalList({ signals, running }: { signals: ProbeSignal[]; running: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const list = Array.isArray(signals) ? signals : [];
  const shown = expanded ? list : list.slice(0, 8);
  return (
    <div>
      <ul aria-live="polite" className="flex flex-col gap-1.5">
        {shown.map((s, i) => (
          <li key={`${s.id}-${i}`} className="flex animate-rise items-start gap-2 text-[13.5px] leading-snug">
            <span className={cx("mt-[2px] shrink-0", s.ok ? "text-good-text" : "text-bad-text")} aria-label={s.ok ? "ok" : "failed"}>
              {s.ok ? <Check size={14} /> : <X size={14} />}
            </span>
            <span className="min-w-0">
              {s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">
                  {s.label} <External size={11} className="inline align-[-1px] text-muted" />
                </a>
              ) : (
                s.label
              )}
              {s.detail ? <span className="block truncate text-[12.5px] text-muted" title={s.detail}>{s.detail}</span> : null}
            </span>
          </li>
        ))}
        {running ? (
          <li className="flex items-center gap-2 text-[13px] text-muted">
            <span aria-hidden="true" className="inline-block size-3.5 animate-spin rounded-full border-2 border-muted/40 border-t-accent" />
            probing…
          </li>
        ) : null}
      </ul>
      {list.length > 8 && !expanded ? (
        <button type="button" onClick={() => setExpanded(true)} className="mt-1 text-[12.5px] text-accent-text hover:underline">
          +{list.length - 8} more
        </button>
      ) : null}
    </div>
  );
}

export function CapabilityRow({ capabilities }: { capabilities: Capabilities | null | undefined }) {
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Capabilities">
      {CAPABILITY_KEYS.map((k) => {
        const ok = Boolean(capabilities?.[k]);
        return (
          <li
            key={k}
            className={cx(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-[560]",
              ok ? "bg-good/13 text-good-text" : "bg-well text-muted",
            )}
          >
            {ok ? <Check size={11} /> : <X size={11} />}
            {CAPABILITY_LABELS[k]}
          </li>
        );
      })}
    </ul>
  );
}

export function CostLine({ probe }: { probe: AccessProbe }) {
  const c = costOf(probe);
  return (
    <p className="mt-auto border-t border-line pt-3 font-mono text-[12.5px] text-ink-2">
      {formatSeconds(c.s)} · {formatUsd(c.usd)} per agent task
      {c.typical ? <span className="text-muted"> (typical)</span> : null}
      {probe.sample_products > 0 ? <span className="text-muted"> · {probe.sample_products} sample products</span> : null}
    </p>
  );
}

export function ApiEndpoints({ endpoints }: { endpoints: string[] }) {
  return (
    <div>
      <div className="eyebrow mb-1">Endpoints</div>
      <ul className="flex flex-col gap-1">
        {endpoints.slice(0, 5).map((u) => (
          <li key={u} className="min-w-0">
            <a href={u} target="_blank" rel="noreferrer" title={u} className="block truncate font-mono text-[12px] text-accent-text hover:underline">
              {u.replace(/^https?:\/\//, "")}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

const RECIPE_ORDER: [keyof DomRecipe, string][] = [
  ["search_input", "Search"], ["product_card", "Product card"], ["title", "Title"], ["price", "Price"],
  ["variant_picker", "Variant picker"], ["add_to_cart", "Add to cart"], ["cart_link", "Cart"], ["checkout_link", "Checkout"],
];

export function DomRecipePreview({ recipe, now }: { recipe: DomRecipe; now: number | null }) {
  const [expanded, setExpanded] = useState(false);
  const rows = RECIPE_ORDER.filter(([k]) => recipe[k]);
  const shown = expanded ? rows : rows.slice(0, 6);
  return (
    <div className="rounded-xl bg-well px-3 py-2.5">
      <div className="eyebrow">Recipe</div>
      <p className="mb-1.5 text-[12.5px] text-muted">Reusable interaction recipe: where an agent reads and clicks.</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {shown.map(([k, label]) => {
          const v = recipe[k]!;
          return (
            <div key={k} className="contents animate-rise">
              <dt className="text-[12.5px] text-ink-2">{label}</dt>
              <dd className="truncate font-mono text-[12px]" title={v}>{v.length > 40 ? `${v.slice(0, 40)}…` : v}</dd>
            </div>
          );
        })}
      </dl>
      {rows.length > 6 && !expanded ? (
        <button type="button" onClick={() => setExpanded(true)} className="mt-1 text-[12.5px] text-accent-text hover:underline">
          +{rows.length - 6} more
        </button>
      ) : null}
      {recipe.notes ? <p className="mt-1.5 text-[12.5px] text-muted">{recipe.notes}</p> : null}
      {recipe.verified_at && now != null ? (
        <p className="text-[12px] text-muted">verified {ago(recipe.verified_at, now)}</p>
      ) : null}
    </div>
  );
}
