import type { Store } from "../lib/contracts";
import { Card } from "../ui/Card";
import { CodeBlock } from "../ui/CodeBlock";
import { CopyButton } from "../ui/CopyButton";
import { External } from "../ui/icons";

const CHECKOUT_COPY: Record<string, string> = {
  woo_store_api: "Native agent checkout (WooCommerce Store API)",
  magento_guest: "Native agent checkout (Magento guest cart)",
  handoff: "Handoff: agent gets a prefilled-cart link",
  browser: "Browser checkout (experimental)",
};

/** `mcpUrl` overrides store.urls.mcp: the composed agent server lives at WS3's MCP_PATH (/api/ucp/mcp). */
export function AgentSurfaces({ store, mcpUrl }: { store: Store; mcpUrl: string }) {
  const u = { ...store.urls, mcp: mcpUrl };
  const rows: { method: "GET" | "POST"; label: string; url: string; note: string; open: boolean }[] = [
    { method: "GET", label: "products.json", url: u.products_json, note: "Shopify-compatible", open: true },
    { method: "GET", label: "llms.txt", url: u.llms_txt, note: "agent instructions", open: true },
    { method: "GET", label: "UCP profile", url: u.ucp, note: "UCP 2026-08-25", open: true },
    { method: "GET", label: "ACP feed", url: u.feed, note: "JSONL per variant", open: true },
    {
      method: "POST", label: "MCP endpoint", url: u.mcp, open: false,
      note: "tools search_catalog, get_product, create_checkout, complete_checkout, scan_store, get_scan …",
    },
  ];
  const curl = `curl -s '${u.products_json}?limit=1' | jq '.products[0] | {id,title}'`;

  return (
    <Card className="px-5 py-5 md:px-7">
      <h2 className="eyebrow">Agent surfaces</h2>
      <ul className="mt-3 divide-y divide-line">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-2.5 md:grid-cols-[auto_9rem_minmax(0,1fr)_auto]">
            <span className={`rounded-md px-1.5 py-0.5 font-mono text-[11.5px] font-semibold ${r.method === "GET" ? "bg-good/13 text-good-text" : "bg-accent/13 text-accent-text"}`}>
              {r.method}
            </span>
            <span className="font-[560]">{r.label} <span className="font-normal text-muted md:hidden">· {r.note}</span></span>
            <span className="col-span-2 min-w-0 md:col-span-1">
              <code className="block truncate font-mono text-[12.5px]" title={r.url}>{r.url}</code>
              <span className="hidden truncate text-[12.5px] text-muted md:block" title={r.note}>{r.note}</span>
            </span>
            <span className="col-span-2 flex items-center gap-1 md:col-span-1">
              {r.open ? (
                <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12.5px] text-ink-2 hover:bg-well hover:text-ink">
                  Open <External size={12} />
                </a>
              ) : null}
              <CopyButton text={r.url} label={r.label} className="[&>span]:sr-only" />
            </span>
          </li>
        ))}
        <li className="py-2.5 text-[14px]">
          <span className="text-muted">Checkout: </span>
          {CHECKOUT_COPY[store.checkout_connector] ?? store.checkout_connector}
        </li>
      </ul>
      <CodeBlock code={curl} className="mt-3" />
    </Card>
  );
}
