/**
 * sale() — CCAUTHCAP
 *
 * Authorize and capture in one step. This is the common case for immediate
 * fulfilment (digital goods, services). Use authorize() + capture() instead
 * when you ship later.
 *
 * A DECLINE IS NOT AN ERROR — it returns normally with status 'DECLINED'.
 */
import { Money, PaymentMethods } from '../dist/index.js';
import { client, demo, show } from './_harness.mjs';

const result = await client().sale({
  paymentMethod: PaymentMethods.card(demo.pan, demo.expiry, demo.cvv),
  lineItems: [{ productId: demo.productId, count: 1, value: Money.of('10.00', 'USD') }],
  customer: demo.customer,
  billingAddress: demo.billingAddress,
  // Setting an order id makes the call retry-safe: a repeat returns the
  // original result instead of charging twice.
  idempotency: { xtlOrderId: demo.orderId('SALE') },
});

show('status', result.status);
show('order', result.orderRef?.poId ?? '-');
show('amount', result.amount ? `${result.amount.amount} ${result.amount.currency}` : '-');
show('card', `${result.card?.brand ?? '?'} ****${result.card?.last4 ?? '?'}`);

switch (result.status) {
  case 'APPROVED':
    show('next', 'fulfil the order');
    break;
  case 'DECLINED':
    // The service tier carries the decline taxonomy your dunning logic needs.
    show('next', result.serviceClassification?.retryable ? 'retry later' : 'do not retry');
    break;
  case 'PENDING':
    show('next', `complete ${result.nextAction?.kind}`);
    break;
  default:
    show('next', 'inspect result.outcome');
}
