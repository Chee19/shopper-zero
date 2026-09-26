import Link from "next/link";
import { cx } from "./tone";
import { Spinner } from "./icons";

type Variant = "primary" | "secondary" | "ghost";
const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110 shadow-card",
  secondary: "bg-surface text-ink border border-line hover:bg-well",
  ghost: "text-ink-2 hover:text-ink hover:bg-well",
};
const BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 h-10 text-[14px] font-[560] transition " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 disabled:cursor-not-allowed";

export function Button({
  variant = "primary", pending = false, disabled, className, children, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; pending?: boolean }) {
  return (
    <button {...rest} className={cx(BASE, VARIANT[variant], className)} disabled={pending || disabled}>
      {pending ? <Spinner size={15} /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({
  href, variant = "primary", className, children, external = false,
}: { href: string; variant?: Variant; className?: string; children: React.ReactNode; external?: boolean }) {
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cx(BASE, VARIANT[variant], className)}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cx(BASE, VARIANT[variant], className)}>
      {children}
    </Link>
  );
}
