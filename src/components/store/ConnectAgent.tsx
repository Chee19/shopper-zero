"use client";

import { Card } from "../ui/Card";
import { CodeBlock, MonoCopy } from "../ui/CodeBlock";
import { Tabs } from "../ui/Tabs";

export const TRY_PROMPT =
  "Using ShoperZero, find me a hoodie under $50 across the stores you can see and buy it in size M. Ship to Ada Lovelace, 1 Demo St, San Francisco, CA 94105, US, ada@example.com. Pay with the ShoperZero demo wallet.";

/** Connection snippets. Menu paths, the mcp-remote bridge and the claude CLI flags are UNVERIFIED (spec 05 §13). */
export function ConnectAgent({ appUrl, mcpUrl }: { appUrl: string; mcpUrl: string }) {
  const mcp = mcpUrl;
  const wallet = `${appUrl}/api/demo-wallet/mcp`;
  const desktopConfig = JSON.stringify(
    {
      mcpServers: {
        shoperzero: { command: "npx", args: ["-y", "mcp-remote", mcp] },
        "shoperzero-wallet": { command: "npx", args: ["-y", "mcp-remote", wallet] },
      },
    },
    null,
    2,
  );
  const cursor = JSON.stringify({ mcpServers: { shoperzero: { url: mcp } } }, null, 2);

  return (
    <Card id="connect" className="scroll-mt-20 px-5 py-5 md:px-7">
      <h2 className="eyebrow">Connect to Claude</h2>
      <Tabs
        className="mt-3"
        tabs={[
          {
            id: "desktop",
            label: "Claude Desktop",
            content: (
              <div className="flex flex-col gap-3 text-[14px]">
                <p className="text-ink-2">Settings → Connectors → Add custom connector, then add both:</p>
                <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center">
                  <span className="font-[560]">ShoperZero</span>
                  <MonoCopy value={mcp} />
                  <span className="font-[560]">ShoperZero Demo Wallet</span>
                  <MonoCopy value={wallet} />
                </div>
                <p className="text-[12.5px] text-muted">The wallet connector is test mode only: it pays on the buyer side.</p>
              </div>
            ),
          },
          {
            id: "config",
            label: "Config file",
            content: (
              <div className="flex flex-col gap-2 text-[14px]">
                <p className="text-ink-2"><code className="font-mono text-[13px]">claude_desktop_config.json</code></p>
                <CodeBlock code={desktopConfig} />
              </div>
            ),
          },
          {
            id: "code",
            label: "Claude Code",
            content: (
              <CodeBlock
                code={`claude mcp add --transport http shoperzero ${mcp}\nclaude mcp add --transport http shoperzero-wallet ${wallet}`}
              />
            ),
          },
          { id: "cursor", label: "Cursor / other", content: <CodeBlock code={cursor} /> },
        ]}
      />
      <div className="mt-5">
        <div className="eyebrow mb-2">Try this prompt</div>
        <CodeBlock code={TRY_PROMPT} className="[&_pre]:whitespace-pre-wrap" />
      </div>
    </Card>
  );
}
