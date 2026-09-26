import "server-only";
import type { Page, Request } from "playwright-core";
import { detectChallenge } from "@/features/crawl/fetch";
import type { RobotsInfo } from "@/features/crawl/robots";
import { assertPublicHost, type StoreTarget } from "@/features/crawl/url";
import { flags } from "@/shared/env";
import { PAY_RE, PAYMENT_FIELD_RE, PAYMENT_IFRAME_RE } from "./guard";

export interface GuardOptions { target: StoreTarget; robots: RobotsInfo; blockHeavy?: boolean }
export type GuardResult = { block: false } | { block: true; reason: string };
export interface GuardState {
  challenge: boolean;
  denied: { url: string; reason: "robots" | "private_host" | "off_site" }[];
  // Resolves once in-flight challenge checks of main-frame responses are done.
  settled(): Promise<void>;
}

const HEAVY = new Set(["image", "media", "font"]);
const HOSTED_CHECKOUT = [/^checkout\.shopify\.com$/, /\.myshopify\.com$/, /\.bigcommerce\.com$/, /\.squarespace\.com$/, /\.demandware\.net$/];
const ACCOUNT_AUTOCOMPLETE = /password|username|one-time-code|email/i;
const PASS: GuardResult = { block: false };
const noop = () => {};

const bareHost = (u: string) => new URL(u).hostname.toLowerCase().replace(/^www\./, "");

// ponytail: no public-suffix list, so a sibling subdomain (shop.x.com to pay.x.com) is off-site; add tldts if that matters.
function sameSite(url: string, target: StoreTarget): boolean {
  const host = bareHost(url);
  const store = bareHost(target.origin);
  return host === store || host.endsWith(`.${store}`) || HOSTED_CHECKOUT.some((re) => re.test(host));
}

// frame() throws for service worker requests, which are never main-frame navigations.
function isMainNav(page: Page, req: Request): boolean {
  try {
    return req.isNavigationRequest() && req.frame() === page.mainFrame();
  } catch {
    return false;
  }
}

async function denyReason(url: string, opts: GuardOptions): Promise<GuardState["denied"][number]["reason"] | null> {
  if (!URL.canParse(url) || !sameSite(url, opts.target)) return "off_site";
  if (!opts.robots.isAllowed(url)) return "robots";
  try {
    await assertPublicHost(url, flags.allowPrivateStoreHosts());
    return null;
  } catch {
    return "private_host";
  }
}

export async function installGuards(page: Page, opts: GuardOptions): Promise<GuardState> {
  const pending = new Set<Promise<void>>();
  const state: GuardState = { challenge: false, denied: [], settled: async () => { await Promise.all(pending); } };
  const track = (work: Promise<unknown>) => {
    const p = work.then(noop, noop);
    pending.add(p);
    void p.finally(() => pending.delete(p));
  };

  await page.route("**/*", async (route) => {
    const req = route.request();
    const reason = isMainNav(page, req) ? await denyReason(req.url(), opts) : null;
    if (reason) {
      state.denied.push({ url: req.url(), reason });
      // A 204 makes Chromium cancel the navigation and keep the current page, so no error page is shown.
      return route.fulfill({ status: 204 }).catch(noop);
    }
    if (opts.blockHeavy && HEAVY.has(req.resourceType())) return route.abort("blockedbyclient").catch(noop);
    return route.continue().catch(noop);
  });

  // Catches off-site hops the route guard cannot see, such as server redirects.
  page.on("framenavigated", (frame) => {
    const url = frame.url();
    if (frame !== page.mainFrame() || !/^https?:/i.test(url) || sameSite(url, opts.target)) return;
    state.denied.push({ url, reason: "off_site" });
    track(page.goBack({ timeout: 5_000 }));
  });

  page.on("response", (res) => {
    if (!isMainNav(page, res.request())) return;
    track(res.text().catch(() => "").then((body) => {
      if (detectChallenge(res.status(), new Headers(res.headers()), body) === "challenge") state.challenge = true;
    }));
  });

  return state;
}

interface Inspected { iframe: string | null; text: string; field: string; autocomplete: string; type: string }

function verdict(el: Inspected | null, typing: boolean): GuardResult {
  if (!el) return PASS;
  const payIframe = el.iframe !== null && PAYMENT_IFRAME_RE.test(el.iframe);
  if (payIframe) return { block: true, reason: "payment_iframe" };
  // Cross-origin iframe fields cannot be inspected, so typing into any iframe is refused.
  if (typing && el.iframe !== null) return { block: true, reason: "iframe_field" };
  if (PAY_RE.test(el.text)) return { block: true, reason: "payment_button" };
  if (/^cc-/i.test(el.autocomplete) || PAYMENT_FIELD_RE.test(el.field)) return { block: true, reason: "payment_field" };
  if (typing && (/^(password|email)$/i.test(el.type) || ACCOUNT_AUTOCOMPLETE.test(el.autocomplete))) {
    return { block: true, reason: "account_field" };
  }
  return PASS;
}

export async function checkClick(page: Page, x: number, y: number): Promise<GuardResult> {
  const el = await page.evaluate(([px, py]): Inspected | null => {
    const e = document.elementFromPoint(px, py);
    if (!e) return null;
    const t = e.closest("button,a,input,[role=button],label,summary");
    const textOf = (n: Element | null) => (n instanceof HTMLElement ? n.innerText || (n as HTMLInputElement).value || "" : "");
    // Without a clickable ancestor, only a short element's own text is a button label; long text is a container.
    const label = t ? textOf(t) : textOf(e).length <= 80 ? textOf(e) : "";
    return {
      iframe: e instanceof HTMLIFrameElement ? e.src : null,
      text: `${label} ${t?.getAttribute("aria-label") ?? ""}`.slice(0, 200),
      field: t?.getAttribute("name") ?? "",
      autocomplete: t?.getAttribute("autocomplete") ?? "",
      type: t?.getAttribute("type") ?? "",
    };
  }, [x, y] as const);
  return verdict(el, false);
}

// Guards type and key: the focused element must not be a payment, credential or pay-button target.
export async function checkType(page: Page): Promise<GuardResult> {
  const el = await page.evaluate((): Inspected | null => {
    const e = document.activeElement;
    if (!e || e === document.body) return null;
    const attr = (n: string) => e.getAttribute(n) ?? "";
    const submitValue = e instanceof HTMLInputElement && /^(submit|button)$/i.test(e.type) ? e.value : "";
    return {
      iframe: e instanceof HTMLIFrameElement ? e.src : null,
      text: `${e instanceof HTMLElement && !(e instanceof HTMLInputElement) ? e.innerText : ""} ${submitValue} ${attr("aria-label")}`.slice(0, 200),
      field: `${attr("name")} ${e.id} ${attr("placeholder")} ${attr("aria-label")}`,
      autocomplete: attr("autocomplete"),
      type: attr("type"),
    };
  });
  return verdict(el, true);
}
