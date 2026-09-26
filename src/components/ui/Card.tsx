import { cx } from "./tone";

export function Card({
  className, children, as: Tag = "section", ...rest
}: React.HTMLAttributes<HTMLElement> & { as?: "section" | "div" | "article" }) {
  return (
    <Tag className={cx("bg-surface border border-line rounded-card shadow-card", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, eyebrow, right, className }: {
  title?: React.ReactNode; eyebrow?: React.ReactNode; right?: React.ReactNode; className?: string;
}) {
  return (
    <header className={cx("flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-3 md:px-6", className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        {title ? <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2> : null}
      </div>
      {right ? <div className="flex items-center gap-2">{right}</div> : null}
    </header>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="eyebrow">{children}</h2>
      {right}
    </div>
  );
}
