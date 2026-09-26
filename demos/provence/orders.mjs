import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export function commerceError(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

/** One storefront process owns the file; its queue serializes stock checks and writes. */
export async function openOrders(filename, variants) {
  let data;
  try { data = JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; data = { version: 1, sequence: 100231, orders: [] }; }
  if (data.version !== 1) throw new Error('Unsupported storefront order file');
  const orders = new Map(data.orders.map(order => [order.id, order]));
  let queue = Promise.resolve();
  const stock = sku => variants[sku].variant.stock - [...orders.values()].filter(o => o.status !== 'canceled').reduce((n, o) => n + o.cart.lines.filter(l => l.sku === sku).reduce((sum, l) => sum + l.qty, 0), 0);
  async function persist() {
    await mkdir(dirname(filename), { recursive: true });
    const temp = `${filename}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify({ version: 1, sequence: data.sequence, orders: [...orders.values()] }), { mode: 0o600 });
    await rename(temp, filename);
  }
  const serial = fn => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  return {
    orders, stock,
    place(input) { return serial(async () => {
      const requestHash = createHash('sha256').update(JSON.stringify({ checkout_id: input.checkout_id, payment_reference: input.payment_reference,
        lines: input.cart.lines.map(l => [l.sku, l.qty, l.unitPrice]), email: input.email, firstName: input.firstName, lastName: input.lastName,
        address1: input.address1, city: input.city, state: input.state, postalCode: input.postalCode, method: input.method, total: input.total })).digest('hex');
      const previous = input.checkout_id && [...orders.values()].find(o => o.checkout_id === input.checkout_id);
      if (previous) {
        if (previous.request_hash !== requestHash) throw commerceError('idempotency_conflict', 'Checkout already used with different order details.');
        return previous;
      }
      for (const line of input.cart.lines) {
        if (!variants[line.sku] || !Number.isInteger(line.qty) || line.qty < 1 || line.qty > 10 || stock(line.sku) < line.qty) {
          throw commerceError('out_of_stock', 'The requested quantity is unavailable.');
        }
      }
      const order = { ...input, id: `LDP${data.sequence++}`, status: 'placed', request_hash: requestHash, placedAt: new Date().toISOString() };
      orders.set(order.id, order);
      try { await persist(); } catch (error) { orders.delete(order.id); data.sequence--; throw error; }
      return order;
    }); },
    cancel(id, checkoutId) { return serial(async () => {
      const order = orders.get(id);
      if (!order || order.checkout_id !== checkoutId) throw commerceError('not_found', 'Order not found.', 404);
      if (order.status === 'canceled') return order;
      order.status = 'canceled';
      try { await persist(); } catch (error) { order.status = 'placed'; throw error; }
      return order;
    }); },
  };
}
