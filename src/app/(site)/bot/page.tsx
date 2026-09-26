import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { appUrl, crawlerUserAgent } from "../_lib/env";

export const metadata: Metadata = {
  title: "About ShoperZeroBot · ShoperZero",
  description: "What ShoperZeroBot and the discovery scanner do, what they respect, and how merchants opt out.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-6">
      <h2 className="text-[20px] font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-[15px] text-ink-2">{children}</div>
    </section>
  );
}

/** Static (no request-time APIs): prerendered at build (spec 05 §7.7, B16). */
export default function BotPage() {
  const host = new URL(appUrl()).hostname;
  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-8 px-5 py-14 md:px-7">
      <header>
        <p className="eyebrow">Crawler and scanner disclosure</p>
        <h1 className="mt-2 text-[34px] leading-tight font-semibold tracking-tight">About ShoperZeroBot</h1>
      </header>

      <Section title="What ShoperZeroBot is">
        <p>Our user agent string is:</p>
        <code className="block rounded-lg bg-well px-3 py-2 font-mono text-[13px] text-ink">{crawlerUserAgent()}</code>
        <p>
          It indexes public product pages so AI agents can find and buy products through standard protocols (UCP, MCP,
          products.json).
        </p>
      </Section>

      <Section title="What it does">
        <ul className="list-disc pl-5">
          <li>Fetches public, logged-out pages only.</li>
          <li>Calls platform APIs first, then sitemaps and JSON-LD.</li>
          <li>
            The <strong className="text-ink">discovery scan</strong> may drive a real browser (computer use) through home →
            product → cart → checkout page, and <strong className="text-ink">always stops before payment</strong>.
          </li>
          <li>Images are linked, never re-hosted.</li>
        </ul>
      </Section>

      <Section title="What it respects">
        <ul className="list-disc pl-5">
          <li>robots.txt <code className="font-mono text-[13px]">Disallow</code> and <code className="font-mono text-[13px]">Crawl-delay</code>.</li>
          <li><code className="font-mono text-[13px]">Content-Signal</code>.</li>
          <li><code className="font-mono text-[13px]">X-Robots-Tag: noindex/noai</code>.</li>
          <li>1–2 requests per second per host.</li>
          <li>It never solves CAPTCHAs or bypasses bot protection. Challenged stores are marked “blocked”.</li>
        </ul>
      </Section>

      <Section title="How to opt out">
        <p>1. In <code className="font-mono text-[13px]">robots.txt</code>:</p>
        <CodeBlock code={"User-agent: ShoperZeroBot\nDisallow: /"} />
        <p>
          2. Claim your store at <code className="font-mono text-[13px]">/claim/&#123;slug&#125;</code> and switch on “Opt out of the
          index”. It takes effect immediately.
        </p>
        <p>
          3. Email <a className="text-accent-text hover:underline" href={`mailto:bot@${host}`}>bot@{host}</a>.
        </p>
      </Section>

      <Section title="How to opt in or claim">
        <p>
          Find your store on the <Link href="/stores" className="text-accent-text hover:underline">stores page</Link> and open
          “Is this your store? Claim it”. Verification takes one DNS TXT record or one meta tag.
        </p>
      </Section>
    </div>
  );
}
