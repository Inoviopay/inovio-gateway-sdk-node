/**
 * authorize() — CCAUTHORIZE
 *
 * Places a hold without taking funds. Pair with capture() when you ship, or
 * reverse() to release the hold.
 *
 * Keep result.orderRef — every follow-up operation consumes it.
 */
import { Money, PaymentMethods } from '../dist/index.js';
import { client, demo, show } from './_harness.mjs';

const auth = await client().authorize({
  paymentMethod: PaymentMethods.card(demo.pan, demo.expiry, demo.cvv),
  lineItems: [{ productId: demo.productId, count: 1, value: Money.of('10.00', 'USD') }],
  customer: demo.customer,
  billingAddress: demo.billingAddress,
  idempotency: { xtlOrderId: demo.orderId('AUTH') },
});

show('status', auth.status);
show('order', auth.orderRef?.poId ?? '-');
show('line items', auth.lineItemRefs.map((l) => l.poLiId).join(', ') || '-');
show('avs', auth.avs ? `${auth.avs.code} (${auth.avs.classification})` : '-');
show('cvv', auth.cvv ? `${auth.cvv.code} (${auth.cvv.classification})` : '-');

// AVS 'partial' means some elements matched and some did not. Whether that is
// acceptable is YOUR risk policy — the SDK reports, it does not decide.
if (auth.avs?.classification === 'partial') {
  show('note', 'partial AVS match — apply your risk policy');
}
