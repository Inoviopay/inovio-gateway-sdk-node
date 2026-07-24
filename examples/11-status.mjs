/**
 * status() — CCSTATUS
 *
 * Two distinct jobs:
 *
 *  1. RECONCILIATION. Partial captures, refunds and voids are separate
 *     transactions sharing one order — so the net position is an order-level
 *     question. One TransactionResult cannot answer "what did this order
 *     actually settle for". This can.
 *
 *  2. TIMEOUT RECOVERY. After a TimeoutError the state is unknown; status()
 *     resolves it. See 14-timeout-recovery.mjs.
 */
import { Money } from '../dist/index.js';
import { client, seedOrder, show } from './_harness.mjs';

const c = client();

// Build a multi-leg order: authorize 100, capture 60, refund 10.
const order = await seedOrder(c, 'STATUS', { amount: '100.00' });
await c.capture(order.orderRef, Money.of('60.00', 'USD'));
await c.refund(order.orderRef, Money.of('10.00', 'USD'));

const s = await c.status(order.orderRef);

show('legs', s.transactions.length);
show('authorized', s.authorized?.amount ?? '-');
show('captured', s.captured?.amount ?? '-');
show('refunded', s.refunded?.amount ?? '-');
show('net', `${s.net?.amount ?? '-'}   (captured - refunded)`);
show('outstanding', `${s.outstanding?.amount ?? '-'}   (authorized - captured)`);

console.log('\n  legs:');
for (const leg of s.transactions) {
  console.log(`    ${leg.action.padEnd(14)} ${leg.status.padEnd(9)} ${leg.amount?.amount ?? '-'}`);
}

// You can also look an order up by YOUR id:
//   await c.status(Refs.xtlOrder('ORDER-555'));
