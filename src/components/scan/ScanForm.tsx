"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UI_MOCK } from "../lib/flags";
import { Button } from "../ui/Button";
import { ArrowRight } from "../ui/icons";
import { normalizeStoreUrl, startScan } from "./api";

export type Preset = { label: string; url: string; note: string };

const FRIENDLY: Record<string, string> = {
  validation_error: "That doesn't look like a store URL",
  forbidden: "This merchant opted out",
  rate_limited: "Too many scans right now. Try again in a minute",
};

export function ScanForm({ presets = [], autoFocus = false }: { presets?: Preset[]; autoFocus?: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; offerReplay: boolean } | null>(null);
  const [fromPreset, setFromPreset] = useState(false);

  async function submit(raw: string, preset: boolean) {
    setError(null);
    const url = normalizeStoreUrl(raw);
    if (!url) {
      setError({ message: FRIENDLY.validation_error!, offerReplay: false });
      inputRef.current?.focus();
      return;
    }
    setPending(true);
    if (UI_MOCK) {
      router.push("/scan/replay-dom?demo=1");
      return;
    }
    const r = await startScan(url);
    if (r.ok) {
      router.push(`/scan/${r.data.scan_id}${preset ? "?demo=1" : ""}`);
      return;
    }
    setPending(false);
    if (r.status >= 400 && r.status < 500) {
      setError({ message: FRIENDLY[r.code] ?? r.message, offerReplay: false });
    } else {
      setError({ message: "Couldn't start the scan. Retry", offerReplay: true });
    }
  }

  return (
    <div className="w-full">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(value, fromPreset);
        }}
        className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-2 shadow-card sm:flex-row sm:items-center"
        noValidate
      >
        <label htmlFor="store-url" className="sr-only">Store URL</label>
        <span aria-hidden="true" className="hidden pl-3 text-[12.5px] whitespace-nowrap text-muted sm:inline">Store URL</span>
        <input
          ref={inputRef}
          id="store-url"
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          autoFocus={autoFocus}
          placeholder="https://www.yourstore.com"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setFromPreset(false);
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "scan-error" : undefined}
          className="h-12 min-w-0 flex-1 rounded-xl bg-transparent px-3 font-mono text-[15px] outline-none placeholder:text-muted focus-visible:bg-well"
        />
        <Button type="submit" pending={pending} className="h-12 px-6 text-[15px]">
          {pending ? "Starting…" : <>Scan <ArrowRight size={16} /></>}
        </Button>
      </form>

      {error ? (
        <p id="scan-error" role="alert" className="mt-2 text-[14px] text-bad-text">
          {error.message}
          {error.offerReplay ? (
            <Link href="/scan/replay-dom" className="ml-2 text-accent-text hover:underline">Watch a recorded scan →</Link>
          ) : null}
        </p>
      ) : null}

      {presets.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted">Try:</span>
          {presets.map((p) => (
            <button
              key={p.url}
              type="button"
              title="Click to fill, double-click to scan"
              onClick={() => {
                setValue(p.url);
                setFromPreset(true);
                setError(null);
              }}
              onDoubleClick={() => {
                setValue(p.url);
                setFromPreset(true);
                void submit(p.url, true);
              }}
              className="rounded-full border border-line bg-surface px-3 py-1 text-ink-2 hover:border-ink-2 hover:text-ink"
            >
              {p.label} <span className="text-muted">· {p.note}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
