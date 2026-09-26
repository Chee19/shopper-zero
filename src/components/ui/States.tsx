import { cx } from "./tone";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("animate-pulse-dot rounded-xl bg-well", className)} />;
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line px-6 py-10 text-center">
      <p className="font-[560]">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-md text-[14px] text-ink-2">{children}</div> : null}
      {action ? <div className="mt-4 flex justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div role="alert" className="rounded-card border border-bad/40 bg-bad/8 px-6 py-6">
      <p className="font-[560] text-bad-text">{title}</p>
      {children ? <div className="mt-1 text-[14px] text-ink-2">{children}</div> : null}
      {action ? <div className="mt-4 flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

export function Banner({ tone, children, className }: { tone: "good" | "warn" | "bad" | "accent"; children: React.ReactNode; className?: string }) {
  const map = {
    good: "border-good/40 bg-good/10",
    warn: "border-warn/50 bg-warn/12",
    bad: "border-bad/40 bg-bad/10",
    accent: "border-accent/40 bg-accent/10",
  } as const;
  return <div role="status" className={cx("rounded-card border px-5 py-4", map[tone], className)}>{children}</div>;
}
