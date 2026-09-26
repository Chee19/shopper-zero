import { ALLOWED_TRANSITIONS, STATE_TO_STATUS, type CheckoutEventData, type CheckoutSession, type CheckoutState } from "./contracts";
import type { Ledger } from "./repo";
import { CheckoutError } from "./errors";

export function annotate(ledger: Ledger, session: CheckoutSession, message: string, now: string, data: CheckoutEventData = {}) {
  ledger.events.push({ id: ledger.events.length + 1, checkout_id: session.id, from_state: session.state,
    to_state: session.state, message, data: { ...data, simulated: true }, created_at: now });
  session.updated_at = now;
}
export function transition(ledger: Ledger, session: CheckoutSession, state: CheckoutState, message: string, now: string, data: CheckoutEventData = {}) {
  if (!ALLOWED_TRANSITIONS[session.state].includes(state)) {
    throw new CheckoutError("invalid_state", `Cannot move checkout from ${session.state} to ${state}.`, 409);
  }
  const from = session.state;
  session.state = state;
  session.status = STATE_TO_STATUS[state];
  session.updated_at = now;
  session.payment.handlers = [];
  ledger.events.push({ id: ledger.events.length + 1, checkout_id: session.id, from_state: from,
    to_state: state, message, data: { ...data, simulated: true }, created_at: now });
}
