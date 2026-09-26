import Link from "next/link";
import { MCP_PATH } from "@/lib/formats/ucp";
import { CopyButton } from "../ui/CopyButton";

const LINKS = [
  { href: "/", label: "Scan" },
  { href: "/stores", label: "Stores" },
  { href: "/checkouts/live", label: "Live checkout" },
];

export function TopBar({ mcpUrl }: { mcpUrl: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-page/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-4 px-5 md:px-7">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden="true" className="inline-block size-3.5 rounded-[4px] bg-ink" />
          ShoperZero
        </Link>
        <nav aria-label="Main" className="flex min-w-0 items-center gap-1 overflow-x-auto text-[14px]">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="shrink-0 rounded-lg px-2.5 py-1.5 text-ink-2 hover:bg-well hover:text-ink">
              {l.label}
            </Link>
          ))}
          <a href="/llms.txt" target="_blank" rel="noreferrer" className="hidden shrink-0 rounded-lg px-2.5 py-1.5 text-ink-2 hover:bg-well hover:text-ink sm:inline">
            Agent docs
          </a>
        </nav>
        <div className="ml-auto hidden items-center rounded-full border border-line bg-surface pl-3 md:flex">
          <code className="font-mono text-[12px] text-ink-2" title={mcpUrl}>…{MCP_PATH}</code>
          <CopyButton text={mcpUrl} label="MCP URL" className="[&>span]:sr-only" />
        </div>
      </div>
    </header>
  );
}
