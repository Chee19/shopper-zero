"use client";

import { useEffect, useRef, useState } from "react";

/** 700 ms rAF tween to `value`; reduced motion jumps straight to it. */
export function CountUp({
  value, from, duration = 700, className, format,
}: { value: number; from?: number; duration?: number; className?: string; format?: (n: number) => string }) {
  const [shown, setShown] = useState(from ?? value);
  const shownRef = useRef(shown);

  useEffect(() => {
    const start = shownRef.current;
    if (start === value) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = reduce ? 1 : Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      const n = Math.round(start + (value - start) * eased);
      shownRef.current = n;
      setShown(n);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <span className={`tabular-nums ${className ?? ""}`}>{format ? format(shown) : shown.toLocaleString("en-US")}</span>;
}
