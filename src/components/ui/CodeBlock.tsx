import { CopyButton } from "./CopyButton";
import { cx } from "./tone";

export function CodeBlock({ code, className, label }: { code: string; className?: string; label?: string }) {
  return (
    <div className={cx("relative rounded-xl bg-code text-code-ink", className)}>
      <pre className="overflow-x-auto p-4 pr-12 font-mono text-[12.5px] leading-relaxed whitespace-pre">{code}</pre>
      <div className="absolute top-2 right-2">
        <CopyButton text={code} label={label} className="text-code-ink/70 hover:bg-white/10 hover:text-code-ink" />
      </div>
    </div>
  );
}

/** One-line mono value with a copy button (URLs, selectors, tokens). */
export function MonoCopy({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cx("inline-flex max-w-full min-w-0 items-center gap-1 rounded-lg bg-well pl-2.5", className)}>
      <code className="min-w-0 truncate font-mono text-[12.5px]" title={value}>{value}</code>
      <CopyButton text={value} />
    </span>
  );
}
