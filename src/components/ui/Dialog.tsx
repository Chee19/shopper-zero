"use client";

import { useEffect, useRef } from "react";
import { X } from "./icons";
import { cx } from "./tone";

/** Native <dialog>, opened/closed from props. Escape and backdrop clicks call onClose. */
export function Dialog({
  open, onClose, title, children, className,
}: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={cx(
        "m-auto max-h-[92vh] w-[min(1100px,94vw)] rounded-card border border-line bg-surface p-0 text-ink shadow-card",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="text-[14px] font-[560]">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-ink-2 hover:bg-well hover:text-ink">
          <X size={16} />
        </button>
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  );
}
