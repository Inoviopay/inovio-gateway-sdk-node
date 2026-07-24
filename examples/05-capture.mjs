/**
 * capture() — CCCAPTURE
 *
 * Takes funds against a prior authorize(). Pass an amount to capture less than
 * was authorized; omit it to capture the full amount.
 *
 * Captures are separate transactions sharing the order, so an order may have
 * several. Use status() for the net position.
 */
import { Money, PaymentMethods, Refs } from '../dist/index.js';
import { client, demo, show } from './_harness.mjs';

const c = client();

const auth = await c.authorize({
  paymentMethod: PaymentMethods.card(demo.pan, demo.expiry, demo.cvv),
  lineItems: [{ productId: demo.productId, count: 1, value: Money.of('10.00', 'USD') }],
  customer: demo.customer,
  billingAddress: demo.billingAddress,
  idempotency: { xtlOrderId: demo.orderId('CAP') },
});
show('authorized', `${auth.status} order=${auth.orderRef?.poId}`);

// Partial capture — ship half the order now.
const capture = await c.capture(auth.orderRef, Money.of('10.00', 'USD'));
show('captured', capture.status);
show('settled', `${capture.settled}  (batch flips this later — not a failure)`);

// Or capture the full authorized amount:
//   await c.capture(auth.orderRef);
//   await c.capture(Refs.order('18800001'));   // from a stored id
