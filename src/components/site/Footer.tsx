import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-2 gap-y-1 px-5 py-6 text-[13px] text-muted md:px-7">
        <span>ShoperZeroBot honors robots.txt and Content-Signal</span>
        <span aria-hidden="true">·</span>
        <Link href="/bot" className="underline-offset-2 hover:text-ink hover:underline">About our bot</Link>
        <span aria-hidden="true">·</span>
        <Link href="/stores" className="underline-offset-2 hover:text-ink hover:underline">Claim or opt out</Link>
      </div>
    </footer>
  );
}
