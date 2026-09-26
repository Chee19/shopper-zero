// A minimal Streamable HTTP MCP endpoint (after-mode only).
//
// Enough for spec 02 §6.3's `mcp_endpoint` signal to find result.tools[] over JSON-RPC,
// and honest enough that an agent can actually call the tools rather than just discover
// them. Tool results carry `structuredContent` in the UCP product shape (spec 03 §6.4),
// matching WS3's convention that structuredContent equals the REST body (DECISIONS B7).

import { PRODUCTS, productById } from './catalog.mjs';
import { toUcpProduct } from './formats/ucp.mjs';

const PROTOCOL_VERSION = '2025-06-18';

const TOOLS = [
  {
    name: 'search_catalog',
    description: 'Search the Lumière de Provence catalog by free-text query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text search over title, summary and category.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'lookup_catalog',
    description: 'Look up products by handle or SKU.',
    inputSchema: {
      type: 'object',
      properties: { handles: { type: 'array', items: { type: 'string' } } },
      required: ['handles'],
    },
  },
  {
    name: 'get_product',
    description: 'Fetch one product with every variant, price and availability.',
    inputSchema: {
      type: 'object',
      properties: { handle: { type: 'string' } },
      required: ['handle'],
    },
  },
];

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

const toolResult = payload => ({
  content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  structuredContent: payload,
});

function callTool(name, args = {}) {
  switch (name) {
    case 'search_catalog': {
      const q = String(args.query ?? '').trim().toLowerCase();
      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);
      const hits = q
        ? PRODUCTS.filter(p => `${p.name} ${p.summary} ${p.category}`.toLowerCase().includes(q))
        : [];
      return toolResult({ products: hits.slice(0, limit).map(p => toUcpProduct(p, 'summary')) });
    }
    case 'lookup_catalog': {
      const handles = Array.isArray(args.handles) ? args.handles : [];
      const found = handles.map(h => productById[h]).filter(Boolean);
      return toolResult({ products: found.map(p => toUcpProduct(p, 'full')) });
    }
    case 'get_product': {
      const p = productById[args.handle];
      if (!p) return null;
      return toolResult({ product: toUcpProduct(p, 'full') });
    }
    default:
      return null;
  }
}

/** Handles one JSON-RPC message. Returns a response object, or null for notifications. */
export function handleRpc(msg) {
  const { id, method, params } = msg ?? {};
  if (typeof method !== 'string') return fail(id ?? null, -32600, 'Invalid Request');
  if (method.startsWith('notifications/')) return null;

  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'lumiere-de-provence', version: '1.0.0' },
      });
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: TOOLS });
    case 'tools/call': {
      const result = callTool(params?.name, params?.arguments);
      return result ? ok(id, result) : fail(id, -32602, `Unknown tool or product: ${params?.name}`);
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

export { TOOLS, PROTOCOL_VERSION };
