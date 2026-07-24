// Full lifecycle smoke against T1 (QAT). Creates real QAT transactions.
import { InovioClient, Money, PaymentMethods, Refs } from './dist/index.js';

const client = new InovioClient(
  { reqUsername: 'ellenscoffee@gmail.com', reqPassword: 'Password123456789',
    siteId: '100103', merchAcctId: '147129' },
  { endpoint: 'https://t1api.inoviopay.com/payment/pmt_service.cfm', timeoutMs: 60000 });

const card = PaymentMethods.card('4622943123100647', '122026', '242');
const items = [{ productId: '111205', count: 1, value: Money.of('1.00', 'USD') }];
const stamp = Date.now();

const show = (label, r) => {
  console.log(`\n── ${label}`);
  console.log(`   status=${r.status} settling=${r.settling} settled=${r.settled}`);
  console.log(`   api=${r.outcome.api.code ?? '-'} service=${r.outcome.service.code ?? '-'} "${r.outcome.service.advice ?? ''}"`);
  console.log(`   processor=${r.outcome.processor.code ?? '-'} "${r.outcome.processor.advice ?? ''}"`);
  if (r.orderRef) console.log(`   orderRef=${r.orderRef.poId} txnId=${r.transactionId?.value ?? '-'}`);
  if (r.amount) console.log(`   amount=${r.amount.amount} ${r.amount.currency}`);
  if (r.avs) console.log(`   avs=${r.avs.code} (${r.avs.classification})`);
  if (r.cvv) console.log(`   cvv=${r.cvv.code} (${r.cvv.classification})`);
  if (r.card) console.log(`   card=${r.card.brand ?? '?'} ****${r.card.last4 ?? '?'}`);
  if (r.serviceClassification) console.log(`   class: retryable=${r.serviceClassification.retryable} terminal=${r.serviceClassification.terminal}`);
  if (r.nextAction) console.log(`   nextAction=${r.nextAction.kind}`);
};

try {
  // 1. AUTHORIZE
  const auth = await client.authorize({
    paymentMethod: card, lineItems: items,
    customer: { firstName: 'Test', lastName: 'Smoke', email: 'sdk-smoke@example.invalid',
               ip: '203.0.113.10', userAgent: 'inovio-sdk-smoke/0.1' },
    billingAddress: { line1: '123 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'US' },
    idempotency: { xtlOrderId: `SDK-SMOKE-${stamp}` },
  });
  show('1. authorize (CCAUTHORIZE)', auth);
  if (auth.status !== 'APPROVED') { console.log('\n⚠ auth not approved — stopping before capture'); process.exit(0); }

  // 2. CAPTURE
  const cap = await client.capture(auth.orderRef, Money.of('1.00', 'USD'));
  show('2. capture (CCCAPTURE)', cap);

  // 3. STATUS — the reconciliation primitive
  const st = await client.status(auth.orderRef);
  console.log(`\n── 3. status (CCSTATUS)`);
  console.log(`   legs=${st.transactions.length}`);
  console.log(`   authorized=${st.authorized?.amount} captured=${st.captured?.amount} refunded=${st.refunded?.amount}`);
  console.log(`   net=${st.net?.amount} outstanding=${st.outstanding?.amount} settled=${st.settled}`);
  st.transactions.forEach((l, i) => console.log(`     leg${i + 1}: ${l.action} ${l.status} ${l.amount?.amount ?? '-'}`));

  // 4. REFUND
  const ref = await client.refund(auth.orderRef, Money.of('1.00', 'USD'));
  show('4. refund (CCCREDIT)', ref);

  // 5. STATUS after refund
  const st2 = await client.status(auth.orderRef);
  console.log(`\n── 5. status after refund`);
  console.log(`   legs=${st2.transactions.length} authorized=${st2.authorized?.amount} captured=${st2.captured?.amount} refunded=${st2.refunded?.amount}`);
  console.log(`   net=${st2.net?.amount} outstanding=${st2.outstanding?.amount}`);
} catch (e) {
  console.log(`\n✗ THREW ${e.constructor.name}: ${e.message}`);
  if (e.refField) console.log(`  refField=${e.refField}`);
  if (e.raw) console.log(`  raw: ${JSON.stringify(e.raw).slice(0, 400)}`);
}
