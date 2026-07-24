/**
 * reverseCapture() — CCREVERSECAP
 *
 * VOIDS a capture rather than the original authorization. Reach for this when
 * you captured in error and the batch has not settled yet.
 *
 * After settlement, refund() is the correct operation instead.
 */
import { client, seedOrder, show } from './_harness.mjs';

const c = client();

// A capture to undo.
const order = await seedOrder(c, 'REVCAP', { capture: true });
show('captured order', order.orderRef?.poId ?? '-');

const result = await c.reverseCapture(order.orderRef);

show('status', result.status);
show('amount', result.amount?.amount ?? '-');
show('when to use', 'capture made in error, before batch settlement');
