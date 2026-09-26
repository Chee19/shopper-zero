"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UI_MOCK } from "../lib/flags";
import { startScan } from "../scan/api";
import { Button } from "../ui/Button";
import { Refresh } from "../ui/icons";

export function RescanButton({ url, replayId }: { url: string; replayId?: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setError(null);
    if (UI_MOCK) {
      router.push(`/scan/${replayId ?? "replay-dom"}`);
      return;
    }
    const r = await startScan(url);
    if (r.ok) return router.push(`/scan/${r.data.scan_id}`);
    setPending(false);
    setError(r.message);
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="secondary" onClick={onClick} pending={pending}>
        {!pending ? <Refresh size={15} /> : null} Re-scan
      </Button>
      {error ? <span role="alert" className="text-[12.5px] text-bad-text">{error}</span> : null}
    </div>
  );
}
