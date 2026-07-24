/**
 * captureLineItem() — CCCAPTURE against one line item
 *
 * For multi-item orders shipped separately: capture each line item as it goes
 * out, rather than capturing an amount against the whole order.
 *
 * The gateway requires the PARENT ORDER and an amount alongside the line-item
 * id (spec §5.5.6) — passing the line-item ref alone is rejected.
 */
import { Money, PaymentMethods } from '../dist/index.js';
import { client, demo, show } from './_harness.mjs';

const c = client();

const auth = await c.authorize({
  paymentMethod: PaymentMethods.card(demo.pan, demo.expiry, demo.cvv),
  lineItems: [
    { productId: demo.productId, count: 1, value: Money.of('10.00', 'USD') },
    { productId: demo.productId, count: 1, value: Money.of('5.00', 'USD') },
  ],
  customer: demo.customer,
  billingAddress: demo.billingAddress,
  idempotency: { xtlOrderId: demo.orderId('LI') },
});
show('authorized', `${auth.status} lineItems=${auth.lineItemRefs.length}`);

const first = auth.lineItemRefs[0];
if (first) {
  // order + item + amount — all three are required.
  const captured = await c.captureLineItem(auth.orderRef, first, Money.of('10.00', 'USD'));
  show('captured item', `${first.poLiId} -> ${captured.status}`);

  const s = await c.status(auth.orderRef);
  show('outstanding', `${s.outstanding?.amount ?? '-'}   (the unshipped line item)`);
} else {
  show('note', 'gateway returned no line-item refs for this order');
}
