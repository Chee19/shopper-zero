import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type {
  ComputerToolset20260801, ContentBlock, ContentBlockParam, ImageBlockParam, Message, MessageParam, TextBlock,
  ThinkingBlock, Tool, ToolResultBlockParam, ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import type { Page } from "playwright-core";
import type { AccessProbe, Capabilities, ProbeSignal } from "@/lib/contracts";
import { uploadScanScreenshot } from "@/lib/db";
import { flags, optionalEnv, requireEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { parsePrice } from "@/lib/money";
import { openBrowser, type BrowserHandle } from "../browser";
import { checkClick, checkType, type GuardResult } from "../browser-guard";
import { UsageMeter } from "../estimate";
import { CHECKOUT_URL_RE } from "../guard";
import { emptyProbe, statusFrom, type ProbeContext, type ProbeFn } from "../probe";

const BUDGET_MS = 150_000;
const MIN_START_MS = 40_000;
// A model turn needs this much wall clock left, or the loop stops with time_budget.
const MIN_TURN_MS = 10_000;
const MAX_ACTIONS = 40;

const COMPUTER: ComputerToolset20260801 = {
  type: "computer_toolset_20260801",
  configs: {
    zoom: { enabled: false }, hold_key: { enabled: false }, left_mouse_down: { enabled: false },
    left_mouse_up: { enabled: false }, middle_click: { enabled: false }, triple_click: { enabled: false },
    cursor_position: { enabled: false },
  },
};
const REPORT: Tool = {
  name: "report_result", strict: true, description: "Finish the test and report what was reached.",
  input_schema: {
    type: "object", additionalProperties: false,
    required: ["reached", "product_title", "price_text", "availability_text", "variant_selected", "notes"],
    properties: {
      reached: { type: "string", enum: ["home", "product", "cart", "checkout"] },
      product_title: { type: ["string", "null"] }, price_text: { type: ["string", "null"] },
      availability_text: { type: ["string", "null"] }, variant_selected: { type: "boolean" }, notes: { type: "string" },
    },
  },
};
const SYSTEM = "You operate a web browser to evaluate e-commerce stores for agent readiness. Use as few steps as possible. "
  + "Prefer clicking visible links and buttons over typing URLs. Payment and account actions are forbidden.";
const STOP_RULE = "ShoperZero stop rule: this action would start payment or enter payment or account details. "
  + "Do not retry. Call report_result now.";
const NOT_EXECUTED = "Not executed: an earlier computer action in this turn failed.";
const ACTION_LIMIT = "Not executed: the action limit for this test was reached. Call report_result now.";

type Stop = "reported" | "model_done" | "refusal" | "max_tokens" | "payment_guard" | "checkout_reached"
  | "blocked" | "time_budget" | "aborted" | "max_steps" | "max_actions";
const GOOD_STOPS = new Set<Stop>(["checkout_reached", "payment_guard", "reported"]);
const ASK_REPORT_AFTER = new Set<Stop>(["checkout_reached", "payment_guard", "max_steps", "max_actions"]);
const CLICKS = new Set(["left_click", "right_click", "double_click"]);

type Xy = [number, number];
type Step = NonNullable<AccessProbe["steps"]>[number];
interface ReportResult {
  reached: "home" | "product" | "cart" | "checkout";
  product_title: string | null; price_text: string | null; availability_text: string | null;
  variant_selected: boolean; notes: string;
}
interface CuInput {
  coordinate?: Xy; start_coordinate?: Xy; text?: string; duration?: number; repeat?: number;
  scroll_direction?: "up" | "down" | "left" | "right"; scroll_amount?: number;
}
interface Run {
  ctx: ProbeContext; b: BrowserHandle; model: string; usage: UsageMeter;
  startedAt: string; t0: number; until: number;
  steps: Step[]; screenshots: string[];
  stop: Stop | null; guardReason: string | null; report: ReportResult | null; actions: number; mouse: Xy;
}

const KEYS: Record<string, string> = {
  return: "Enter", enter: "Enter", backspace: "Backspace", page_down: "PageDown", page_up: "PageUp",
  ctrl: "Control", control: "Control", super: "Meta", cmd: "Meta", meta: "Meta", alt: "Alt", shift: "Shift",
  escape: "Escape", esc: "Escape", tab: "Tab", space: "Space", delete: "Delete", home: "Home", end: "End",
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
};
const toKey = (k: string) => KEYS[k.toLowerCase()] ?? k;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isToolUse = (c: ContentBlock): c is ToolUseBlock => c.type === "tool_use";

export const computerUseProbe: ProbeFn = async (ctx) => {
  const skip = precondition(ctx);
  if (skip) return skipped(...skip);
  const startedAt = new Date().toISOString();
  const b = await openBrowser({ target: ctx.target, robots: ctx.robots });
  if (!b) return skipped("no_browser", "No browser available (set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID, or install Chromium locally).");
  const model = optionalEnv("SCAN_MODEL") ?? "claude-opus-5-5";
  const t0 = Date.now();
  const run: Run = {
    ctx, b, model, usage: new UsageMeter(model), startedAt, t0, until: Math.min(t0 + BUDGET_MS, ctx.deadline - 8_000),
    steps: [], screenshots: [], stop: null, guardReason: null, report: null, actions: 0, mouse: [0, 0],
  };
  try {
    await drive(run);
    return finish(run);
  } catch (e) {
    const error = failure(run, e);
    if (error.code === "cu_error") log.error("scan.cu.failed", e, { scan_id: ctx.scanId });
    return finish(run, error);
  } finally {
    await b.close();
  }
};

function precondition(ctx: ProbeContext): [code: string, message: string] | null {
  if (!flags.scanCuEnabled()) return ["disabled", "Computer use is disabled (SCAN_CU_ENABLED=0)."];
  if (!allowlisted(ctx)) return ["not_allowlisted", "Computer use only runs against the demo stores (cost guard)."];
  if (!optionalEnv("ANTHROPIC_API_KEY")) return ["not_implemented", "Server is missing ANTHROPIC_API_KEY."];
  // Checked before opening a browser so no paid session is started just to be skipped.
  if (ctx.deadline - Date.now() < MIN_START_MS) return ["time_budget", "Less than 40 s left before the scan deadline."];
  return null;
}

// R4 cost guard: computer use only runs on the hosts of JS_SHOP_FIXTURE_URL or WOO_DEMO_URL.
function allowlisted(ctx: ProbeContext): boolean {
  const hosts = [optionalEnv("JS_SHOP_FIXTURE_URL"), optionalEnv("WOO_DEMO_URL")]
    .filter((u): u is string => !!u && URL.canParse(u))
    .map((u) => new URL(u).host);
  return [ctx.store.base_url, ctx.target.origin].some((u) => URL.canParse(u) && hosts.includes(new URL(u).host));
}

function skipped(code: string, message: string): AccessProbe {
  return { ...emptyProbe("computer_use", "skipped"), error: { code, message } };
}

function taskPrompt(ctx: ProbeContext): string {
  return `You are testing whether an AI shopping assistant could use this store: ${ctx.target.baseUrl}. `
    + "Starting from the homepage shown, find any product, open it, note its price and availability, choose a variant if one is required, "
    + "add one unit to the cart, open the cart, and go to the checkout page. STOP as soon as the checkout page is visible "
    + "- never enter personal details, never log in, never enter payment information, never place an order. "
    + "If a login wall, CAPTCHA or error blocks you, stop. Call report_result when done or stuck.";
}

async function drive(run: Run): Promise<void> {
  const { ctx, b } = run;
  const client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  await b.page.goto(ctx.target.baseUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
  run.stop = await afterAction(run);
  const first = await shoot(run, 0, "open homepage");
  if (run.stop) return;

  const messages: MessageParam[] = [];
  let next: ContentBlockParam[] = [{ type: "text", text: taskPrompt(ctx) }, first];
  for (let turn = 1; turn <= flags.scanCuMaxSteps(); turn++) {
    if (ctx.signal.aborted) { run.stop = "aborted"; return; }
    if (run.until - Date.now() < MIN_TURN_MS) { run.stop = "time_budget"; return; }
    messages.push({ role: "user", content: next });
    const res = await callModel(run, client, messages);
    // Append-only history: the assistant turn goes back unchanged, thinking blocks included.
    messages.push({ role: "assistant", content: res.content });
    const calls = res.content.filter(isToolUse);
    const early = earlyStop(res, calls.length);
    if (early) { run.stop = early; return; }
    next = await runCalls(run, calls);
    await shoot(run, turn, calls.map(describe).join("; "), reasoningOf(res.content));
    if (run.stop) break;
  }
  run.stop ??= "max_steps";
  await askForReport(run, client, messages, next)
    .catch((e: unknown) => log.warn("scan.cu.report_turn_failed", { scan_id: ctx.scanId, err: messageOf(e) }));
}

function earlyStop(res: Message, calls: number): Stop | null {
  if (res.stop_reason === "refusal") return "refusal";
  // A max_tokens turn may hold truncated tool calls, so none of them run.
  if (res.stop_reason === "max_tokens") return "max_tokens";
  return calls ? null : "model_done";
}

async function callModel(run: Run, client: Anthropic, messages: MessageParam[]): Promise<Message> {
  const timeout = AbortSignal.timeout(Math.max(run.until - Date.now(), 1_000));
  const res = await client.messages.create({
    model: run.model, max_tokens: 8000, system: SYSTEM, tools: [COMPUTER, REPORT], messages,
    thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "medium" },
    cache_control: { type: "ephemeral" },
  }, { signal: AbortSignal.any([run.ctx.signal, timeout]) });
  run.usage.add(res.usage);
  return res;
}

// The URL rule stops the loop before the model sees the checkout page, so report_result often never arrives.
// One more turn asks for it; any computer call in that turn is ignored, never executed.
async function askForReport(run: Run, client: Anthropic, messages: MessageParam[], results: ContentBlockParam[]): Promise<void> {
  if (run.report || !run.stop || !ASK_REPORT_AFTER.has(run.stop)) return;
  if (run.ctx.signal.aborted || run.until - Date.now() < MIN_TURN_MS) return;
  const text = `The test is over (${run.stop}). Do not use the computer again. Call report_result now with what you observed.`;
  messages.push({ role: "user", content: [...results, { type: "text", text }] });
  const res = await callModel(run, client, messages);
  const call = res.content.filter(isToolUse).find((c) => c.name === "report_result");
  if (call) run.report = call.input as ReportResult;
}

function cuResult(id: string, content: ToolResultBlockParam["content"], isError = false): ToolResultBlockParam {
  return { type: "tool_result", tool_use_id: id, toolset_name: "computer", content, ...(isError ? { is_error: true } : {}) };
}

// Sequential; after the first failure or stop, the remaining calls of the turn are answered but not executed.
async function runCalls(run: Run, calls: ToolUseBlock[]): Promise<ToolResultBlockParam[]> {
  const results: ToolResultBlockParam[] = [];
  let halted = false;
  for (const call of calls) {
    if (call.name === "report_result") {
      run.report = call.input as ReportResult;
      run.stop ??= "reported";
      results.push({ type: "tool_result", tool_use_id: call.id, content: "OK" });
      continue;
    }
    if (halted) { results.push(cuResult(call.id, NOT_EXECUTED)); continue; }
    if (++run.actions > MAX_ACTIONS) {
      run.stop = "max_actions";
      halted = true;
      results.push(cuResult(call.id, ACTION_LIMIT));
      continue;
    }
    try {
      const g = await guardFor(run, call);
      if (g.block) {
        onGuardBlock(run, g.reason);
        halted = true;
        results.push(cuResult(call.id, STOP_RULE, true));
        continue;
      }
      results.push(cuResult(call.id, await execute(run, call)));
    } catch (e) {
      halted = true;
      results.push(cuResult(call.id, `Action failed: ${messageOf(e).slice(0, 300)}`, true));
      continue;
    }
    const post = await afterAction(run);
    if (post) { run.stop = post; halted = true; }
  }
  return results;
}

async function guardFor(run: Run, call: ToolUseBlock): Promise<GuardResult> {
  const { page } = run.b;
  const i = call.input as CuInput;
  if (CLICKS.has(call.name)) return checkClick(page, ...(i.coordinate ?? run.mouse));
  if (call.name === "left_click_drag") {
    const start = await checkClick(page, ...(i.start_coordinate ?? run.mouse));
    return start.block ? start : checkClick(page, ...(i.coordinate ?? run.mouse));
  }
  if (call.name === "type" || call.name === "key") return checkType(page);
  return { block: false };
}

function onGuardBlock(run: Run, reason: string): void {
  run.stop = "payment_guard";
  run.guardReason = reason;
  log.info("scan.cu.guard_block", { scan_id: run.ctx.scanId, reason, url: run.b.page.url() });
}

async function afterAction(run: Run): Promise<Stop | null> {
  await run.b.guard.settled();
  if (run.b.guard.challenge) return "blocked";
  // URL rule: the model never gets a turn on a checkout page, so it cannot fill checkout forms.
  if (CHECKOUT_URL_RE.test(run.b.page.url())) return "checkout_reached";
  return run.ctx.signal.aborted ? "aborted" : null;
}

async function execute(run: Run, call: ToolUseBlock): Promise<ToolResultBlockParam["content"]> {
  const { page } = run.b;
  const i = call.input as CuInput;
  switch (call.name) {
    case "screenshot":
      return [imageBlock(await capture(page))];
    case "left_click":
    case "right_click":
    case "double_click": {
      run.mouse = i.coordinate ?? run.mouse;
      const [x, y] = run.mouse;
      const button = call.name === "right_click" ? "right" : "left";
      await withModifiers(page, i.text, () => page.mouse.click(x, y, { button, clickCount: call.name === "double_click" ? 2 : 1 }));
      break;
    }
    case "left_click_drag":
      await page.mouse.move(...(i.start_coordinate ?? run.mouse));
      await page.mouse.down();
      run.mouse = i.coordinate ?? run.mouse;
      await page.mouse.move(...run.mouse, { steps: 10 });
      await page.mouse.up();
      break;
    case "mouse_move":
      run.mouse = i.coordinate ?? run.mouse;
      await page.mouse.move(...run.mouse);
      break;
    case "scroll": {
      if (i.coordinate) {
        run.mouse = i.coordinate;
        await page.mouse.move(...run.mouse);
      }
      const px = (i.scroll_amount ?? 3) * 100;
      const dir = i.scroll_direction ?? "down";
      await page.mouse.wheel(dir === "left" ? -px : dir === "right" ? px : 0, dir === "up" ? -px : dir === "down" ? px : 0);
      break;
    }
    case "type":
      await page.keyboard.type((i.text ?? "").slice(0, 200), { delay: 15 });
      break;
    case "key": {
      const combo = (i.text ?? "").split("+").map(toKey).join("+");
      for (let n = 0; n < Math.min(i.repeat ?? 1, 10); n++) await page.keyboard.press(combo);
      break;
    }
    case "wait":
      await sleep(Math.min(i.duration ?? 1, 5) * 1000);
      break;
    default:
      throw new Error(`Unsupported action ${call.name}`);
  }
  await page.waitForLoadState("domcontentloaded", { timeout: 3_000 }).catch(() => {});
  await sleep(300);
  return "OK";
}

async function withModifiers(page: Page, text: string | undefined, act: () => Promise<void>): Promise<void> {
  const keys = text ? text.split("+").map(toKey) : [];
  for (const k of keys) await page.keyboard.down(k);
  try {
    await act();
  } finally {
    for (const k of keys.reverse()) await page.keyboard.up(k);
  }
}

// Viewport 1280x800 at CSS scale fits the image limits, so model coordinates need no scaling.
function capture(page: Page): Promise<Buffer> {
  return page.screenshot({ type: "jpeg", quality: 70, scale: "css", timeout: 10_000 });
}

function imageBlock(bytes: Buffer): ImageBlockParam {
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: bytes.toString("base64") } };
}

async function shoot(run: Run, i: number, action: string, reasoning?: string): Promise<ImageBlockParam> {
  const { ctx } = run;
  const bytes = await capture(run.b.page);
  const url = await uploadScanScreenshot(ctx.scanId, `cu-${String(i).padStart(2, "0")}.jpg`, bytes, "image/jpeg")
    .catch((e: unknown) => {
      log.warn("scan.cu.screenshot_upload_failed", { scan_id: ctx.scanId, step: i, err: messageOf(e) });
      return undefined;
    });
  if (url) run.screenshots.push(url);
  run.steps.push({ i, action, ...(reasoning ? { reasoning } : {}), ...(url ? { screenshot: url } : {}) });
  await ctx.update({ steps: [...run.steps], screenshots: [...run.screenshots], capabilities: capabilitiesFrom(run) })
    .catch((e: unknown) => log.warn("scan.cu.update_failed", { scan_id: ctx.scanId, err: messageOf(e) }));
  return imageBlock(bytes);
}

function describe(call: ToolUseBlock): string {
  if (call.name === "report_result") return `report_result (${(call.input as ReportResult).reached})`;
  const i = call.input as CuInput;
  if (i.coordinate) return `${call.name} (${i.coordinate.join(", ")})`;
  if (i.text) return `${call.name} '${i.text.slice(0, 40)}'`;
  return call.name;
}

function reasoningOf(content: ContentBlock[]): string | undefined {
  const thought = content.find((c): c is ThinkingBlock => c.type === "thinking" && c.thinking.trim() !== "");
  const text = content.find((c): c is TextBlock => c.type === "text");
  return (thought?.thinking ?? text?.text)?.trim().slice(0, 200) || undefined;
}

function capabilitiesFrom(run: Run): Capabilities {
  const { report: r, stop } = run;
  const reached = r?.reached ?? "home";
  const deep = reached === "cart" || reached === "checkout";
  return {
    catalog: reached !== "home",
    product_detail: Boolean(r?.product_title?.trim()),
    price_availability: parsePrice(r?.price_text, run.ctx.store.currency ?? "USD") !== null
      && (Boolean(r?.availability_text?.trim()) || deep),
    variants: r?.variant_selected === true,
    cart: deep || stop === "checkout_reached",
    checkout_reachable: stop === "checkout_reached" || reached === "checkout"
      || (stop === "payment_guard" && CHECKOUT_URL_RE.test(run.b.page.url())),
  };
}

function failure(run: Run, e: unknown): { code: string; message: string } {
  const code = run.ctx.signal.aborted ? "aborted" : Date.now() >= run.until ? "time_budget" : "cu_error";
  return { code, message: messageOf(e).slice(0, 300) };
}

function finish(run: Run, error?: { code: string; message: string }): AccessProbe {
  const caps = capabilitiesFrom(run);
  const ms = Date.now() - run.t0;
  const stop = run.stop ?? "error";
  const signals: ProbeSignal[] = [{
    id: "cu_stop", label: "Stopped because", ok: run.stop !== null && GOOD_STOPS.has(run.stop),
    detail: run.guardReason ? `${stop} (${run.guardReason})` : stop,
  }];
  const denied = run.b.guard.denied;
  if (denied.length) {
    signals.push({
      id: "cu_nav_denied", label: "Navigations blocked by the guard", ok: false,
      detail: denied.slice(0, 5).map((d) => `${d.reason} ${d.url.slice(0, 80)}`).join(", "),
    });
  }
  log.info("scan.cu.done", { scan_id: run.ctx.scanId, stop, actions: run.actions, usd: run.usage.usd() });
  return {
    ...emptyProbe("computer_use"),
    status: statusFrom(caps, stop === "blocked"),
    started_at: run.startedAt, finished_at: new Date().toISOString(), duration_ms: ms,
    signals, capabilities: caps, sample_products: caps.product_detail ? 1 : 0,
    est_seconds_per_task: Math.round(ms / 1000),
    est_usd_per_task: run.usage.usd() + (ms / 60_000) * run.b.costUsdPerMinute,
    steps: run.steps, screenshots: run.screenshots,
    ...(error ? { error } : {}),
  };
}
