"use client";

import type { AccessMethod, ReadinessCheck, ScanReport } from "../lib/contracts";
import { formatSeconds, formatUsd } from "../lib/format";
import {
  METHOD_META, METHOD_ORDER, TYPICAL_COST, anyPassed, capabilityCount, costOf, probeFor, statusChip,
} from "../lib/methods";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { GradeTile } from "../ui/GradeTile";
import { ArrowRight, Check, X } from "../ui/icons";
import { ScoreRing } from "../ui/ScoreRing";
import { cx } from "../ui/tone";

const VERDICT: Record<AccessMethod | "none", (d: string) => string> = {
  api: (d) => `Agents can use ${d} through an API.`,
  dom: (d) => `Agents can reach ${d} only by scraping its pages.`,
  computer_use: (d) => `Agents can reach ${d} only by clicking through screenshots.`,
  none: (d) => `Agents can't use ${d} today.`,
};

export function ScoreReport({ scan, domain }: { scan: ScanReport; domain: string }) {
  const best = scan.best_method !== "none" ? costOf(probeFor(scan, scan.best_method)) : null;
  return (
    <div className="flex flex-col gap-4">
      <Card className="relative overflow-hidden px-5 py-6 md:px-7">
        <div className="flex flex-col gap-6 md:flex-row md:items-center">
          <div className="flex items-center gap-4">
            <ScoreRing score={scan.score} grade={scan.grade} />
            <GradeTile grade={scan.grade} size="xl" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="eyebrow">Agent Readiness Score</div>
            <h2 className="mt-1 text-[26px] leading-tight font-semibold tracking-tight md:text-[29px]">
              {VERDICT[scan.best_method](domain)}
            </h2>
            {best ? (
              <p className="mt-2 text-ink-2">
                An AI assistant needs <strong className="font-[560] text-ink">{formatSeconds(best.s)}</strong> and{" "}
                <strong className="font-[560] text-ink">{formatUsd(best.usd)}</strong> for every task here.
              </p>
            ) : (
              <p className="mt-2 text-ink-2">No access method worked, so no agent task can be completed here.</p>
            )}
          </div>
          {scan.after ? (
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-well px-4 py-3">
              <ArrowRight size={20} className="text-muted" />
              <div>
                <div className="eyebrow">With ShoperZero</div>
                <div className="mt-1 flex items-center gap-2">
                  <GradeTile grade={scan.after.grade} size="md" />
                  <div>
                    <div className="font-mono text-[22px] font-semibold tabular-nums">{scan.after.score}</div>
                    <div className="text-[12px] text-muted">projected</div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      <MethodComparison scan={scan} />

      <div className="grid gap-4 lg:grid-cols-2">
        <ChecksList checks={scan.checks} />
        <Recommendations items={scan.recommendations} />
      </div>
    </div>
  );
}

function logWidth(v: number, max: number): number {
  if (max <= 0) return 4;
  return Math.max(4, (100 * Math.log10(1 + v)) / Math.log10(1 + max));
}

function Bar({ value, max, label, tone }: { value: number; max: number; label: string; tone: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="h-2 min-w-0 flex-1 rounded-full bg-well">
        <div className={cx("h-2 rounded-full", tone)} style={{ width: `${logWidth(value, max)}%` }} />
      </div>
      <span className="w-[86px] shrink-0 font-mono text-[12.5px] tabular-nums">{label}</span>
    </div>
  );
}

export function MethodComparison({ scan }: { scan: ScanReport }) {
  const passed = anyPassed(scan);
  const rows = METHOD_ORDER.map((m) => {
    const p = probeFor(scan, m);
    return { m, p, c: costOf(p), chip: statusChip(p.status, passed) };
  });
  const api = rows[0]!.c;
  const cu = rows[2]!.c;
  const maxS = Math.max(...rows.map((r) => r.c.s), TYPICAL_COST.api.s);
  const maxCents = Math.max(...rows.map((r) => r.c.usd * 100), 1);

  return (
    <Card className="px-5 py-5 md:px-7">
      <h2 className="eyebrow">How agents can reach it</h2>
      <p className="mt-2 text-[17px] font-semibold tracking-tight">
        API {formatSeconds(api.s)} / {formatUsd(api.usd)} vs computer use {formatSeconds(cu.s)} / {formatUsd(cu.usd)} per task.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13.5px]">
          <thead>
            <tr className="text-left text-muted">
              <th className="eyebrow py-2 pr-3 font-[560]">Method</th>
              <th className="eyebrow py-2 pr-3 font-[560]">Result</th>
              <th className="eyebrow py-2 pr-3 font-[560]">Time / task</th>
              <th className="eyebrow py-2 pr-3 font-[560]">Cost / task</th>
              <th className="eyebrow py-2 font-[560]">Capabilities</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ m, p, c, chip }) => {
              const tried = p.status !== "skipped" && p.status !== "pending";
              return (
                <tr key={m} className={cx("border-t border-line", scan.best_method === m && "bg-accent/6")}>
                  <td className="py-2.5 pr-3 font-[560]">
                    {METHOD_META[m].label}
                    {scan.best_method === m ? <span className="ml-2 text-[12px] font-normal text-accent-text">← best found</span> : null}
                  </td>
                  <td className="py-2.5 pr-3"><Chip tone={chip.tone}>{chip.label}</Chip></td>
                  <td className="py-2.5 pr-3">
                    <Bar value={c.s} max={maxS} label={`${formatSeconds(c.s)}${c.typical ? "*" : ""}`} tone="bg-ink-2" />
                  </td>
                  <td className="py-2.5 pr-3">
                    <Bar value={c.usd * 100} max={maxCents} label={`${formatUsd(c.usd)}${c.typical ? "*" : ""}`} tone="bg-ink-2" />
                  </td>
                  <td className="py-2.5 font-mono text-[12.5px]">{tried ? `${capabilityCount(p.capabilities)}/6` : "—"}</td>
                </tr>
              );
            })}
            <tr className="border-t border-line bg-good/8">
              <td className="py-2.5 pr-3 font-semibold">Via ShoperZero <span className="font-normal text-muted">(UCP + MCP)</span></td>
              <td className="py-2.5 pr-3"><Chip tone="good">after indexing</Chip></td>
              <td className="py-2.5 pr-3"><Bar value={1} max={maxS} label="≈1 s" tone="bg-good" /></td>
              <td className="py-2.5 pr-3"><Bar value={0} max={maxCents} label="$0.00" tone="bg-good" /></td>
              <td className="py-2.5 font-mono text-[12.5px]">6/6 <span className="text-muted">(projected)</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      {rows.some((r) => r.c.typical) ? (
        <p className="mt-2 text-[12px] text-muted">* typical value for this method; it wasn&apos;t measured on this store.</p>
      ) : null}
    </Card>
  );
}

export function ChecksList({ checks }: { checks: ReadinessCheck[] }) {
  if (!Array.isArray(checks) || checks.length === 0) return null;
  return (
    <Card className="px-5 py-5 md:px-6">
      <h2 className="eyebrow">Checks</h2>
      <ul className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
        {checks.map((c) => (
          <li key={c.id} className="flex items-start gap-2">
            <span className={cx("mt-[3px] shrink-0", c.pass ? "text-good-text" : "text-bad-text")} aria-label={c.pass ? "pass" : "fail"}>
              {c.pass ? <Check size={14} /> : <X size={14} />}
            </span>
            <span className="min-w-0 text-[13.5px]">
              {c.label} <span className="font-mono text-[12px] text-muted">({c.weight})</span>
              {c.detail ? <span className="block truncate text-[12.5px] text-muted" title={c.detail}>{c.detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function Recommendations({ items }: { items: string[] }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <Card className="px-5 py-5 md:px-6">
      <h2 className="eyebrow">Recommendations</h2>
      <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-[14px] marker:font-mono marker:text-muted">
        {items.map((r, i) => <li key={i}>{r}</li>)}
      </ol>
    </Card>
  );
}
