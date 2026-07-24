/**
 * reverse() — CCREVERSE
 *
 * VOIDS an authorization, releasing the hold. This is not a refund: nothing was
 * captured, so nothing is returned. Use it when an order is cancelled before
 * shipping.
 *
 * To void a CAPTURE instead, use reverseCapture().
 */
import { Money, PaymentMethods } from '../dist/index.js';
import { client, demo, show } from './_harness.mjs';

const c = client();

const auth = await c.authorize({
  paymentMethod: PaymentMethods.card(demo.pan, demo.expiry, demo.cvv),
  lineItems: [{ productId: demo.productId, count: 1, value: Money.of('10.00', 'USD') }],
  customer: demo.customer,
  billingAddress: demo.billingAddress,
  idempotency: { xtlOrderId: demo.orderId('REV') },
});
show('authorized', `${auth.status} order=${auth.orderRef?.poId}`);

const voided = await c.reverse(auth.orderRef);
show('reversed', voided.status);
// Void legs come back with a negative amount.
show('amount', voided.amount?.amount ?? '-');
show('effect', 'authorization released — order nets to zero');
