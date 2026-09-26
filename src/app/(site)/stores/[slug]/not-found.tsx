import Link from "next/link";

export default function StoreNotFound() {
  return (
    <div className="mx-auto max-w-[760px] px-5 py-24 text-center md:px-7">
      <h1 className="text-[26px] font-semibold tracking-tight">No store with that name</h1>
      <p className="mt-2 text-ink-2">
        We haven&apos;t scanned it yet. <Link href="/" className="text-accent-text hover:underline">Scan it →</Link>
      </p>
    </div>
  );
}
