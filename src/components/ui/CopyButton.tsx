"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "./icons";
import { cx } from "./tone";

/** Copies `text` (or the current page URL when `currentUrl` is set). The icon becomes a check for 1.5 s. */
export function CopyButton({
  text, currentUrl = false, label, className,
}: { text?: string; currentUrl?: boolean; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  async function onClick() {
    const value = currentUrl ? window.location.href : (text ?? "");
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions); nothing else to do.
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label ? `Copy ${label}` : "Copy"}
      title={copied ? "Copied" : "Copy"}
      className={cx(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[12.5px] text-ink-2 transition hover:bg-well hover:text-ink",
        "focus-visible:outline-2 focus-visible:outline-accent",
        className,
      )}
    >
      {copied ? <Check size={14} className="text-good-text" /> : <Copy size={14} />}
      {label ? <span>{copied ? "Copied" : label}</span> : null}
    </button>
  );
}
