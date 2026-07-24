/**
 * updateOrder() — CCTRANSUPDATE
 *
 * Attaches data to an order after the fact. The main use is receipts, which
 * Appendix G/J compliance requires for negative-option and trial billing.
 */
import { client, seedOrder, show } from './_harness.mjs';

const c = client();

const order = await seedOrder(c, 'UPDATE');
show('order', order.orderRef?.poId ?? '-');

const result = await c.updateOrder(order.orderRef, {
  receipt: `https://merchant.example.invalid/receipts/${order.orderRef?.poId}`,
  metadata: { udf: { '01': 'fulfilled-2026-07-23', '02': 'warehouse-B' } },
});

show('status', result.status);
show('use', 'receipts for MCC 5968 / Visa trial compliance');
