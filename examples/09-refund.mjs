/**
 * refund() — CCCREDIT
 *
 * Returns captured funds to the cardholder. Pass an amount for a partial
 * refund; omit it to refund the full order.
 *
 * Refund legs arrive with a NEGATIVE amount. status() reports `refunded` as a
 * positive magnitude, so you rarely have to think about the sign.
 */
import { Money } from '../dist/index.js';
import { client, seedOrder, show } from './_harness.mjs';

const c = client();

// You can only refund what was captured.
const order = await seedOrder(c, 'REFUND', { capture: true });
show('captured order', order.orderRef?.poId ?? '-');

const refund = await c.refund(order.orderRef, Money.of('10.00', 'USD'));

show('status', refund.status);
show('amount', `${refund.amount?.amount ?? '-'}   (negative on the wire)`);

// Full refund instead:
//   await c.refund(order.orderRef);
