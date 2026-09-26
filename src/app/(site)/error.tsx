"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ErrorState } from "@/components/ui/States";
import { Button } from "@/components/ui/Button";

export default function SiteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-[760px] px-5 py-16 md:px-7">
      <ErrorState
        title="Something went wrong on this page"
        action={
          <>
            <Button onClick={() => retry()}>Try again</Button>
            <Link href="/scan/replay-dom" className="inline-flex h-10 items-center px-2 text-[14px] text-ink-2 hover:text-ink">
              Watch a recorded scan →
            </Link>
          </>
        }
      >
        {error.digest ? <span className="font-mono text-[12px]">ref {error.digest}</span> : "Please try again."}
      </ErrorState>
    </div>
  );
}
