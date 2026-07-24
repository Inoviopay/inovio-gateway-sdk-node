/**
 * forceCredit() — CCCREDIT + FORCE_CREDIT
 *
 * Pushes money to a card with NO original transaction to reference. Use it for
 * goodwill payments, or to refund an order taken outside the gateway.
 *
 * Because nothing constrains the amount, merchant accounts must have this
 * enabled explicitly. If it is NOT enabled the gateway rejects the request at
 * the API tier with 104 "Invalid service action" — which surfaces as an
 * AuthenticationError, not a decline. Observed on live T1 with a standard test
 * account, so expect to arrange provisioning before this works.
 */
import { AuthenticationError, Money, PaymentMethods } from '../dist/index.js';
import { client, demo, show } from './_harness.mjs';

try {
  const result = await client().forceCredit({
    paymentMethod: PaymentMethods.card(demo.pan, demo.expiry, demo.cvv),
    lineItems: [{ productId: demo.productId, count: 1, value: Money.of('10.00', 'USD') }],
    customer: demo.customer,
    billingAddress: demo.billingAddress,
    idempotency: { xtlOrderId: demo.orderId('FORCE') },
  });

  show('status', result.status);
  show('amount', result.amount?.amount ?? '-');

  if (result.status === 'DECLINED') {
    show('service code', `${result.outcome.service.code} "${result.outcome.service.advice ?? ''}"`);
  }
} catch (e) {
  if (e instanceof AuthenticationError) {
    show('rejected', e.message);
    show('cause', 'FORCE_CREDIT is not enabled on this merchant account');
    show('fix', 'ask Inovio support to enable it for the MID');
  } else {
    throw e;
  }
}
