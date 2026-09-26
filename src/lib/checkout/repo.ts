import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { CheckoutError } from "./errors";
import type { CheckoutEvent, CheckoutSession, CreateCheckoutInput, Order } from "./contracts";
import { PRODUCT_FIXTURES, type ProductFixture, type Scenario } from "./fixtures";

export interface PaymentRecord {
  reference: string; checkout_id: string; amount: number; currency: string;
  status: "authorized" | "captured" | "voided"; simulated: true;
}
export interface MerchantOrder {
  id: string; checkout_id: string; payment_reference: string;
  status: "placed" | "canceled"; simulated: true;
}
export interface CheckoutEntry {
  session: CheckoutSession; input: CreateCheckoutInput; scenario: Scenario;
  payment_reference?: string;
}
export interface Ledger {
  version: 1;
  products: Record<string, ProductFixture>;
  checkouts: Record<string, CheckoutEntry>;
  orders: Record<string, Order>;
  payments: Record<string, PaymentRecord>;
  merchantOrders: Record<string, MerchantOrder>;
  events: CheckoutEvent[];
  idempotency: Record<string, { fingerprint: string; checkout_id: string }>;
  vendorCalls: { vendor: "stripe" | "woo"; operation: string; checkout_id: string; simulated: true }[];
}
export function emptyLedger(): Ledger {
  return { version: 1, products: Object.fromEntries(PRODUCT_FIXTURES.map(p => [p.id, { ...p }])),
    checkouts: {}, orders: {}, payments: {}, merchantOrders: {}, events: [], idempotency: {}, vendorCalls: [] };
}
export interface CheckoutRepository {
  transaction<T>(fn: (ledger: Ledger) => T | Promise<T>): Promise<T>;
}

/** Local demo persistence. A filesystem lock also serializes separate Next route workers. */
export class FileCheckoutRepository implements CheckoutRepository {
  constructor(public readonly filename: string) {}
  async transaction<T>(fn: (ledger: Ledger) => T | Promise<T>): Promise<T> {
    await mkdir(dirname(this.filename), { recursive: true });
    const lock = `${this.filename}.lock`;
    const deadline = Date.now() + 10_000;
    for (;;) {
      try { await mkdir(lock); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (Date.now() >= deadline) throw new CheckoutError("busy", "The demo ledger is busy. Try again.", 503);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    const temporary = `${this.filename}.${randomUUID()}.tmp`;
    try {
      let ledger: Ledger;
      try { ledger = JSON.parse(await readFile(this.filename, "utf8")); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        ledger = emptyLedger();
      }
      if (ledger.version !== 1) throw new Error("Unsupported mock ledger version");
      let result: T | undefined;
      let failure: CheckoutError | undefined;
      try { result = await fn(ledger); }
      catch (error) {
        // Business validation may first persist expiry. Unexpected exceptions roll back.
        if (!(error instanceof CheckoutError)) throw error;
        failure = error;
      }
      await writeFile(temporary, JSON.stringify(ledger), { mode: 0o600 });
      await rename(temporary, this.filename);
      if (failure) throw failure;
      return result as T;
    } finally {
      await rm(temporary, { force: true });
      await rm(lock, { recursive: true, force: true });
    }
  }
}
