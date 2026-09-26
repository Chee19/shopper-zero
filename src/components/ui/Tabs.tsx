"use client";

import { useId, useState } from "react";
import { cx } from "./tone";

export function Tabs({ tabs, className }: { tabs: { id: string; label: string; content: React.ReactNode }[]; className?: string }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const base = useId();
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    setActive(tabs[next]!.id);
    document.getElementById(`${base}-tab-${tabs[next]!.id}`)?.focus();
  };
  return (
    <div className={className}>
      <div role="tablist" className="flex gap-1 overflow-x-auto rounded-xl bg-well p-1">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            id={`${base}-tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={active === t.id}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={active === t.id ? 0 : -1}
            onClick={() => setActive(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              "h-8 shrink-0 rounded-lg px-3 text-[13px] font-[560] transition",
              active === t.id ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          id={`${base}-panel-${t.id}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${t.id}`}
          hidden={active !== t.id}
          className="pt-4"
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
