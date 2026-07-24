/**
 * Timeout recovery — the pattern that prevents double charges.
 *
 * A timeout does NOT mean the transaction failed. It means the state is
 * UNKNOWN: the gateway may have approved it and lost the response. Retrying
 * blindly can charge the customer twice.
 *
 * Two mechanisms work together:
 *
 *  1. IDEMPOTENCY. Setting idempotency.xtlOrderId defaults to RETURN_ORIGINAL,
 *     so a repeat of the same request returns the original result instead of
 *     creating a second charge.
 *  2. status(). TimeoutError carries your order id, so you can ask the gateway
 *     what actually happened.
 */
import { Money, PaymentMethods, Refs, TimeoutError } from '../dist/index.js';
import { client, demo, show } from './_harness.mjs';

/** A transport that always times out, so the example is deterministic. */
class AlwaysTimesOut {
  async post() {
    const e = new Error('aborted');
    e.name = 'AbortError';
    throw e;
  }
}

const orderId = demo.orderId('TIMEOUT');
const c = client({ httpClient: new AlwaysTimesOut(), timeoutMs: 50 });

try {
  await c.sale({
    paymentMethod: PaymentMethods.card(demo.pan, demo.expiry, demo.cvv),
    lineItems: [{ productId: demo.productId, count: 1, value: Money.of('10.00', 'USD') }],
    customer: demo.customer,
    billingAddress: demo.billingAddress,
    idempotency: { xtlOrderId: orderId },
  });
} catch (e) {
  if (!(e instanceof TimeoutError)) throw e;

  show('caught', e.constructor.name);
  show('order id', e.xtlOrderId ?? '(none — cannot resolve)');
  show('guidance', e.recoveryHint);

  // Resolve the true state instead of guessing:
  //   const actual = await client().status(Refs.xtlOrder(e.xtlOrderId));
  //   if (actual.transactions.length === 0) { /* safe to retry */ }
  show('do NOT', 'retry blindly — that risks a double charge');
}
