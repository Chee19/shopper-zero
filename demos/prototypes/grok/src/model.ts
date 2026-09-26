export const PASS = 64
export const PRICE_EUR = 79
export const RECOVERY = 0.7
export const HUMAN_RATE = 0.025

export type ShopUrl = {
  href: string
  host: string
  label: string
}

export type StepGroup = "base" | "deep"

export type ScoredStep = {
  id: string
  label: string
  group: StepGroup
  weight: number
  score: number
  human: number | null
  scanText: string
  problem: string
  fix: string
  gets: string
  short: string
}

export type AreaScore = {
  id: string
  label: string
  score: number
}

export type TileKind = "catalog" | "cart" | "cabinet"
export type FocusGroup = "product" | "checkout" | "payment"
export type CheckStatus = "done" | "error" | "skip"

export type NodeCheck = {
  label: string
  detail: string
  score: number | null
  status: CheckStatus
}

export type Fixable = {
  id: string
  label: string
  score: number
  fix: string
  gets: string
  short: string
}

export type WorkflowNode = Fixable & {
  group: FocusGroup
  kind: TileKind
  x: number
  y: number
  weight: number
  human: number
  scanText: string
  ok: boolean
  checks: NodeCheck[]
  spot: { x: number; y: number }
}

export type Report = {
  host: string
  steps: ScoredStep[]
  base: ScoredStep[]
  deepSteps: ScoredStep[]
  nodes: WorkflowNode[]
  overall: number
  humanOverall: number
  working: number
  worst: WorkflowNode[]
  areas: AreaScore[]
}

export type Money = {
  visits: number
  aov: number
  agentShare: number
  humanRate: number
  gapPercent: number
  agentShoppers: number
  wouldBuy: number
  grokFinishes: number
  lostOrders: number
  lostMoney: number
  lift: number
  yearlyLoss: number
  paybackDays: number | null
}

type CatalogStep = {
  id: string
  label: string
  group: StepGroup
  weight: number
  min: number
  max: number
  human: number | null
  scan: (host: string) => string
  problem: string
  fix: string
  gets: string
  short: string
}

const CATALOG: CatalogStep[] = [
  {
    id: "open",
    label: "Open the shop",
    group: "base",
    weight: 0.08,
    min: 80,
    max: 98,
    human: 98,
    scan: (host) => `Opening ${host}`,
    problem: "Grok has a hard time telling this is a shop.",
    fix: "Put the shop name and what you sell at the top, in normal words.",
    gets: "A clear shop name and what you sell, right at the top.",
    short: "how the shop introduces itself",
  },
  {
    id: "find",
    label: "Find a product",
    group: "base",
    weight: 0.12,
    min: 48,
    max: 90,
    human: 95,
    scan: (host) => `Looking for a product on ${host}`,
    problem: "Grok cannot tell what you sell.",
    fix: "Give every product a name, a photo, and one short line.",
    gets: "Products Grok can point to: a name, a photo, and a short line.",
    short: "finding a product",
  },
  {
    id: "price",
    label: "Read the price",
    group: "base",
    weight: 0.14,
    min: 36,
    max: 86,
    human: 97,
    scan: (host) => `Reading prices on ${host}`,
    problem: "The price is hard for Grok to read.",
    fix: "Show the price next to every product, before anyone has to hunt for it.",
    gets: "A price on every product, in the open.",
    short: "reading the price",
  },
  {
    id: "stock",
    label: "Check stock",
    group: "base",
    weight: 0.14,
    min: 28,
    max: 80,
    human: 93,
    scan: (host) => `Checking what is in stock on ${host}`,
    problem: "Grok cannot tell if you still have it.",
    fix: "Say if it is in stock, on the product, in plain words.",
    gets: "In stock or sold out, written on the product.",
    short: "stock",
  },
  {
    id: "cart",
    label: "Add to cart",
    group: "base",
    weight: 0.16,
    min: 24,
    max: 78,
    human: 96,
    scan: (host) => `Trying to add it to the cart on ${host}`,
    problem: "Adding to the cart is a puzzle.",
    fix: "Keep Add to cart obvious, and let one item go in without a puzzle.",
    gets: "An obvious Add to cart that works in one step.",
    short: "the cart",
  },
  {
    id: "checkout",
    label: "Reach checkout",
    group: "base",
    weight: 0.18,
    min: 14,
    max: 64,
    human: 91,
    scan: (host) => `Walking to checkout on ${host}`,
    problem: "Grok gets lost on the way to checkout.",
    fix: "Give a straight path from the cart to payment. Fewer pages, fewer popups.",
    gets: "A straight path from the cart to payment.",
    short: "the path to checkout",
  },
  {
    id: "pay",
    label: "Pay",
    group: "base",
    weight: 0.18,
    min: 10,
    max: 58,
    human: 94,
    scan: (host) => `Trying to pay on ${host}`,
    problem: "Grok cannot finish paying.",
    fix: "Show the total, then a normal way to pay, with the last step left open.",
    gets: "A visible total and a normal way to pay.",
    short: "paying",
  },
  {
    id: "shipping",
    label: "Shipping and returns",
    group: "deep",
    weight: 0,
    min: 22,
    max: 80,
    human: 90,
    scan: (host) => `Looking up delivery on ${host}`,
    problem: "Delivery cost and returns are hard to find.",
    fix: "Show delivery cost, how many days, and returns before checkout.",
    gets: "Delivery cost, timing, and returns in the open.",
    short: "shipping and returns",
  },
  {
    id: "reviews",
    label: "Reviews",
    group: "deep",
    weight: 0,
    min: 30,
    max: 88,
    human: 84,
    scan: (host) => `Reading reviews on ${host}`,
    problem: "Grok cannot see why someone should trust this.",
    fix: "Put a few real reviews on the product.",
    gets: "A few real reviews on the product.",
    short: "reviews",
  },
  {
    id: "options",
    label: "Sizes and options",
    group: "deep",
    weight: 0,
    min: 18,
    max: 76,
    human: 88,
    scan: (host) => `Checking sizes and options on ${host}`,
    problem: "Sizes and colors are hard to pick.",
    fix: "List sizes and colors as simple choices, with a price for each.",
    gets: "Sizes and colors as simple choices, each with a price.",
    short: "sizes and options",
  },
  {
    id: "bot",
    label: "Can a bot read this",
    group: "deep",
    weight: 0,
    min: 12,
    max: 70,
    human: null,
    scan: (host) => `Checking if assistants can read ${host}`,
    problem: "Shopping assistants get blocked.",
    fix: "Leave the pages open so a shopping assistant can read them.",
    gets: "Pages a shopping assistant is allowed to read.",
    short: "letting assistants read the shop",
  },
  {
    id: "facts",
    label: "Product facts",
    group: "deep",
    weight: 0,
    min: 16,
    max: 74,
    human: 86,
    scan: (host) => `Gathering product facts on ${host}`,
    problem: "The facts about a product are scattered.",
    fix: "Write what it is, what it costs, and whether you have it, in one clear block.",
    gets: "One clear block: what it is, the price, and whether you have it.",
    short: "product facts",
  },
  {
    id: "speed",
    label: "Speed",
    group: "deep",
    weight: 0,
    min: 45,
    max: 96,
    human: 80,
    scan: (host) => `Timing how fast ${host} answers`,
    problem: "The page is slow to show what you sell.",
    fix: "Make the first screen appear fast, so an assistant does not give up.",
    gets: "A first screen that shows the shop quickly.",
    short: "speed",
  },
  {
    id: "search",
    label: "Search",
    group: "deep",
    weight: 0,
    min: 32,
    max: 84,
    human: 92,
    scan: (host) => `Searching the catalog on ${host}`,
    problem: "Search misses the words a customer would use.",
    fix: "Let people search with the words a customer would actually say.",
    gets: "Search that understands the words a customer would use.",
    short: "search",
  },
]

function hashHost(host: string): number {
  let h = 2166136261
  const s = host.toLowerCase()
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type CheckDef = { label: string; ok: string; bad: string }

type NodeDef = {
  id: string
  label: string
  group: FocusGroup
  kind: TileKind
  weight: number
  source?: string
  min?: number
  max?: number
  human: number
  scan: (host: string) => string
  fix: string
  gets: string
  short: string
  spot: { x: number; y: number }
  checks: CheckDef[]
}

const WORKFLOW: NodeDef[] = [
  {
    id: "open",
    label: "Open the shop",
    group: "product",
    kind: "catalog",
    weight: 0.04,
    source: "open",
    human: 98,
    scan: (host) => `Opening ${host}`,
    fix: "Put the shop name and what you sell at the top, in normal words.",
    gets: "A clear shop name and what you sell, right at the top.",
    short: "how the shop introduces itself",
    spot: { x: 18, y: 8 },
    checks: [
      { label: "Page loads", ok: "Loads", bad: "Blocked" },
      { label: "Shop name", ok: "Clear", bad: "Only a logo" },
      { label: "What you sell", ok: "Said plainly", bad: "Hard to tell" },
    ],
  },
  {
    id: "read",
    label: "Read the page",
    group: "product",
    kind: "catalog",
    weight: 0.06,
    source: "facts",
    human: 94,
    scan: (host) => `Reading the page on ${host}`,
    fix: "Write what each product is, in text, not only inside pictures.",
    gets: "Product words Grok can read, not only pictures.",
    short: "reading the page",
    spot: { x: 50, y: 22 },
    checks: [
      { label: "Text, not images", ok: "Text", bad: "In images" },
      { label: "Headings", ok: "Clear", bad: "Missing" },
      { label: "Assistant allowed", ok: "Allowed", bad: "Blocked" },
    ],
  },
  {
    id: "find",
    label: "Find a product",
    group: "product",
    kind: "catalog",
    weight: 0.08,
    source: "find",
    human: 95,
    scan: (host) => `Looking for a product on ${host}`,
    fix: "Give every product a name, a photo, and one short line.",
    gets: "Products Grok can point to: a name, a photo, and a short line.",
    short: "finding a product",
    spot: { x: 82, y: 8 },
    checks: [
      { label: "Search box", ok: "Works", bad: "Hidden" },
      { label: "Product names", ok: "Clear", bad: "Vague" },
      { label: "Categories", ok: "Linked", bad: "Menu only" },
    ],
  },
  {
    id: "price",
    label: "Read the price",
    group: "product",
    kind: "catalog",
    weight: 0.1,
    source: "price",
    human: 97,
    scan: (host) => `Reading prices on ${host}`,
    fix: "Show the price next to every product, before anyone has to hunt for it.",
    gets: "A price on every product, in the open.",
    short: "reading the price",
    spot: { x: 30, y: 46 },
    checks: [
      { label: "Price shown", ok: "Visible", bad: "After a click" },
      { label: "Currency", ok: "€ shown", bad: "Missing" },
      { label: "Sale price", ok: "Clear", bad: "Confusing" },
    ],
  },
  {
    id: "stock",
    label: "Check stock",
    group: "product",
    kind: "catalog",
    weight: 0.08,
    source: "stock",
    human: 93,
    scan: (host) => `Checking what is in stock on ${host}`,
    fix: "Say if it is in stock, on the product, in plain words.",
    gets: "In stock or sold out, written on the product.",
    short: "stock",
    spot: { x: 64, y: 46 },
    checks: [
      { label: "In stock label", ok: "Shown", bad: "Missing" },
      { label: "Sold out", ok: "Marked", bad: "Unclear" },
    ],
  },
  {
    id: "options",
    label: "Pick size or option",
    group: "product",
    kind: "catalog",
    weight: 0.06,
    source: "options",
    human: 88,
    scan: (host) => `Picking a size on ${host}`,
    fix: "List sizes and colors as simple choices, with a price for each.",
    gets: "Sizes and colors as simple choices, each with a price.",
    short: "sizes and options",
    spot: { x: 46, y: 58 },
    checks: [
      { label: "Size list", ok: "Buttons", bad: "Custom widget" },
      { label: "Price per option", ok: "Shown", bad: "Changes silently" },
      { label: "Default picked", ok: "Yes", bad: "None" },
    ],
  },
  {
    id: "cart",
    label: "Add to cart",
    group: "checkout",
    kind: "cart",
    weight: 0.12,
    source: "cart",
    human: 96,
    scan: (host) => `Adding it to the cart on ${host}`,
    fix: "Keep Add to cart obvious, and let one item go in without a puzzle.",
    gets: "An obvious Add to cart that works in one step.",
    short: "the cart",
    spot: { x: 72, y: 62 },
    checks: [
      { label: "Add to cart button", ok: "Found", bad: "Hidden" },
      { label: "Works in one step", ok: "Yes", bad: "Popup first" },
      { label: "Cart updates", ok: "Confirmed", bad: "No signal" },
    ],
  },
  {
    id: "review",
    label: "Review cart",
    group: "checkout",
    kind: "cart",
    weight: 0.06,
    min: 30,
    max: 86,
    human: 95,
    scan: (host) => `Reviewing the cart on ${host}`,
    fix: "Show items, quantity, and a running total in the cart.",
    gets: "A cart that lists items and a running total.",
    short: "the cart page",
    spot: { x: 86, y: 14 },
    checks: [
      { label: "Items listed", ok: "Clear", bad: "Hidden" },
      { label: "Running total", ok: "Shown", bad: "Missing" },
    ],
  },
  {
    id: "shipping",
    label: "Shipping and delivery",
    group: "checkout",
    kind: "cabinet",
    weight: 0.07,
    source: "shipping",
    human: 90,
    scan: (host) => `Looking up delivery on ${host}`,
    fix: "Show delivery cost, how many days, and returns before checkout.",
    gets: "Delivery cost, timing, and returns in the open.",
    short: "shipping and returns",
    spot: { x: 50, y: 80 },
    checks: [
      { label: "Delivery cost", ok: "Before checkout", bad: "At the end" },
      { label: "Delivery time", ok: "Days shown", bad: "Missing" },
      { label: "Returns", ok: "Linked", bad: "Hard to find" },
    ],
  },
  {
    id: "form",
    label: "Checkout form",
    group: "checkout",
    kind: "cart",
    weight: 0.1,
    source: "checkout",
    human: 91,
    scan: (host) => `Filling the checkout on ${host}`,
    fix: "Give a straight path from the cart to payment. Fewer pages, fewer popups.",
    gets: "A straight path from the cart to payment.",
    short: "the path to checkout",
    spot: { x: 50, y: 40 },
    checks: [
      { label: "Guest checkout", ok: "Allowed", bad: "Account needed" },
      { label: "Field labels", ok: "Clear", bad: "Missing" },
      { label: "Popups", ok: "None", bad: "In the way" },
    ],
  },
  {
    id: "pay",
    label: "Pay",
    group: "payment",
    kind: "cabinet",
    weight: 0.15,
    source: "pay",
    human: 94,
    scan: (host) => `Trying to pay on ${host}`,
    fix: "Show the total, then a normal way to pay, with the last step left open.",
    gets: "A visible total and a normal way to pay.",
    short: "paying",
    spot: { x: 62, y: 70 },
    checks: [
      { label: "Total before paying", ok: "Shown", bad: "Appears late" },
      { label: "Card or wallet", ok: "Offered", bad: "Login only" },
      { label: "Final button", ok: "Reachable", bad: "Behind popup" },
    ],
  },
  {
    id: "confirmed",
    label: "Order confirmed",
    group: "payment",
    kind: "cabinet",
    weight: 0.08,
    min: 24,
    max: 84,
    human: 97,
    scan: (host) => `Waiting for the order on ${host}`,
    fix: "End on a clear confirmation page with an order number.",
    gets: "A clear confirmation with an order number.",
    short: "the order confirmation",
    spot: { x: 40, y: 30 },
    checks: [
      { label: "Confirmation page", ok: "Shown", bad: "Unclear" },
      { label: "Order number", ok: "Given", bad: "Missing" },
    ],
  },
]

export const MAP_W = 880
export const MAP_H = 380
const COL_X = [76, 216, 356, 496, 636, 776]
const ROW_Y = [96, 276]

function nodePosition(index: number): { x: number; y: number } {
  const row = index < 6 ? 0 : 1
  const col = row === 0 ? index : 11 - index
  return { x: COL_X[col], y: ROW_Y[row] }
}

export type EdgePoint = [number, number]

export function edgePoints(a: { x: number; y: number }, b: { x: number; y: number }): EdgePoint[] {
  if (a.y === b.y) {
    const dir = Math.sign(b.x - a.x)
    return [
      [a.x + dir * 54, a.y],
      [b.x - dir * 54, b.y],
    ]
  }
  const lane = a.x + 82
  return [
    [a.x + 54, a.y],
    [lane, a.y],
    [lane, b.y],
    [b.x + 54, b.y],
  ]
}

export function edgePath(points: EdgePoint[]): string {
  if (points.length === 2) {
    return `M${points[0][0]} ${points[0][1]} L${points[1][0]} ${points[1][1]}`
  }
  const [p0, p1, p2, p3] = points
  const r = 16
  return [
    `M${p0[0]} ${p0[1]}`,
    `H${p1[0] - r}`,
    `Q${p1[0]} ${p1[1]} ${p1[0]} ${p1[1] + r}`,
    `V${p2[1] - r}`,
    `Q${p2[0]} ${p2[1]} ${p2[0] - r} ${p2[1]}`,
    `H${p3[0]}`,
  ].join(" ")
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function buildNodes(
  host: string,
  byId: Record<string, number>,
  rand: () => number,
): WorkflowNode[] {
  return WORKFLOW.map((def, index) => {
    const own = rand()
    const score =
      def.source != null
        ? byId[def.source]
        : Math.round((def.min ?? 30) + own * ((def.max ?? 80) - (def.min ?? 30)))
    const ok = score >= PASS
    let hasError = false
    const checks: NodeCheck[] = def.checks.map((check, k) => {
      const jitter = (rand() - 0.5) * 44
      const skipRoll = rand()
      if (!ok && hasError && skipRoll < 0.35 && k === def.checks.length - 1) {
        return { label: check.label, detail: "Not reached", score: null, status: "skip" }
      }
      let value = Math.round(clamp(score + jitter, 6, 99))
      if (ok) value = Math.max(value, PASS)
      const passed = value >= PASS
      if (!passed) hasError = true
      return {
        label: check.label,
        detail: passed ? check.ok : check.bad,
        score: value,
        status: passed ? "done" : "error",
      }
    })
    if (!ok && !hasError) {
      const worstIndex = checks.reduce(
        (lowest, check, k) =>
          (check.score ?? 100) < (checks[lowest].score ?? 100) ? k : lowest,
        0,
      )
      const value = Math.min(checks[worstIndex].score ?? score, PASS - 6)
      checks[worstIndex] = {
        label: def.checks[worstIndex].label,
        detail: def.checks[worstIndex].bad,
        score: value,
        status: "error",
      }
    }
    return {
      id: def.id,
      label: def.label,
      group: def.group,
      kind: def.kind,
      ...nodePosition(index),
      weight: def.weight,
      score,
      human: def.human,
      scanText: def.scan(host),
      fix: def.fix,
      gets: def.gets,
      short: def.short,
      ok,
      checks,
      spot: def.spot,
    }
  })
}

export function partialScore(nodes: WorkflowNode[]): number {
  if (!nodes.length) return 0
  return weighted(nodes)
}

export function reach(nodes: { score: number }[]): number[] {
  let low = 100
  return nodes.map((node) => {
    low = Math.min(low, node.score)
    return low
  })
}

function weighted(steps: { score: number; weight: number }[]): number {
  const weight = steps.reduce((sum, step) => sum + step.weight, 0)
  const value = steps.reduce((sum, step) => sum + step.score * step.weight, 0)
  return Math.round(value / weight)
}

export function parseShopUrl(input: string): ShopUrl | null {
  const trimmed = input.trim()
  if (!trimmed || /\s/.test(trimmed)) return null
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(withProtocol)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (!url.hostname.includes(".")) return null
  url.hash = ""
  const host = url.hostname.replace(/^www\./i, "")
  const href = url.toString()
  return {
    href,
    host,
    label: `${url.host}${url.pathname}${url.search}`,
  }
}

export function shotUrl(href: string): string {
  const target = encodeURIComponent(href)
  return `https://api.microlink.io/?url=${target}&screenshot=true&meta=false&embed=screenshot.url&viewport.width=1280&viewport.height=900`
}

export function faviconUrl(host: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`
}

export function presets(bigger: boolean): { visits: number; aov: number; agentShare: number } {
  return bigger
    ? { visits: 18000, aov: 72, agentShare: 0.15 }
    : { visits: 1200, aov: 48, agentShare: 0.08 }
}

export function buildReport(host: string): Report {
  const rand = mulberry32(hashHost(host))
  const steps: ScoredStep[] = CATALOG.map((step) => {
    const unit = rand()
    const score = Math.round(step.min + unit * (step.max - step.min))
    return {
      id: step.id,
      label: step.label,
      group: step.group,
      weight: step.weight,
      score,
      human: step.human,
      scanText: step.scan(host),
      problem: step.problem,
      fix: step.fix,
      gets: step.gets,
      short: step.short,
    }
  })
  const base = steps.filter((step) => step.group === "base")
  const deepSteps = steps.filter((step) => step.group === "deep")
  const byId = Object.fromEntries(steps.map((step) => [step.id, step.score]))
  const nodes = buildNodes(host, byId, rand)
  const overall = weighted(nodes)
  const humanOverall = weighted(nodes.map((node) => ({ score: node.human, weight: node.weight })))
  const avg = (...ids: string[]) =>
    Math.round(ids.reduce((sum, id) => sum + byId[id], 0) / ids.length)
  const areas: AreaScore[] = [
    { id: "home", label: "Home", score: avg("open", "find", "speed", "search") },
    {
      id: "product",
      label: "Product",
      score: avg("find", "price", "stock", "options", "facts", "reviews"),
    },
    { id: "cart", label: "Cart", score: byId.cart },
    { id: "checkout", label: "Checkout", score: avg("checkout", "pay") },
    { id: "shipping", label: "Shipping", score: byId.shipping },
    { id: "trust", label: "Trust", score: byId.reviews },
    { id: "options", label: "Options", score: byId.options },
    { id: "bot", label: "Can a bot read this", score: avg("bot", "facts") },
  ]
  const worst = [...nodes].sort((a, b) => a.score - b.score || b.weight - a.weight).slice(0, 3)
  return {
    host,
    steps,
    base,
    deepSteps,
    nodes,
    overall,
    humanOverall,
    working: nodes.filter((node) => node.ok).length,
    worst,
    areas,
  }
}

export function computeMoney(input: {
  visits: number
  aov: number
  bigger: boolean
  overall: number
}): Money {
  const { agentShare } = presets(input.bigger)
  const gap = Math.max(0, 100 - input.overall) / 100
  const agentShoppers = input.visits * agentShare
  const wouldBuy = agentShoppers * HUMAN_RATE
  const grokFinishes = wouldBuy * (input.overall / 100)
  const lostOrders = wouldBuy * gap
  const lostMoney = lostOrders * input.aov
  const lift = lostMoney * RECOVERY
  return {
    visits: input.visits,
    aov: input.aov,
    agentShare,
    humanRate: HUMAN_RATE,
    gapPercent: 100 - input.overall,
    agentShoppers,
    wouldBuy,
    grokFinishes,
    lostOrders,
    lostMoney,
    lift,
    yearlyLoss: lostMoney * 12,
    paybackDays: lift > 0 ? Math.max(1, Math.round((PRICE_EUR / lift) * 30)) : null,
  }
}

export function projectedScore(overall: number): number {
  return Math.min(98, Math.round(overall + (100 - overall) * RECOVERY))
}

export function projectedStep(score: number): number {
  return Math.min(98, Math.round(score + (100 - score) * RECOVERY))
}

export function solutionSentence(worst: Fixable[]): string {
  if (worst.length < 3) return "Make the weak steps easy for Grok to finish."
  return `Fix ${worst[0].short}, ${worst[1].short}, and ${worst[2].short}. That is how those sales come back.`
}

export function formatEuro(value: number): string {
  if (value > 0 && value < 1) return "under €1"
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatInt(value: number): string {
  return Math.round(value).toLocaleString("en-IE")
}

export function formatOrders(value: number): string {
  if (value >= 100) return Math.round(value).toLocaleString("en-IE")
  if (value >= 10) return String(Math.round(value))
  const rounded = Math.round(value * 10) / 10
  return rounded.toLocaleString("en-IE", { maximumFractionDigits: 1 })
}

export function formatShare(value: number): string {
  const percent = Math.round(value * 1000) / 10
  return `${percent}%`
}

export function paybackLabel(days: number | null): string {
  if (days == null) return "The missed sales are already near zero."
  if (days <= 10) return "It pays for itself in about a week."
  if (days < 45) {
    const weeks = Math.max(1, Math.round(days / 7))
    return `It pays for itself in about ${weeks} ${weeks === 1 ? "week" : "weeks"}.`
  }
  const months = Math.max(1, Math.round(days / 30))
  return `It pays for itself in about ${months} ${months === 1 ? "month" : "months"}.`
}

export function passes(score: number): boolean {
  return score >= PASS
}
