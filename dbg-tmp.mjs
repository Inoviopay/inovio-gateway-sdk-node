import { InovioClient, Money, PaymentMethods } from './dist/index.js';
class Spy {
  constructor(){ this.calls=[]; }
  async post(url, body, h, t) {
    const { FetchHttpClient } = await import('./dist/transport/index.js');
    const res = await new FetchHttpClient().post(url, body, h, t);
    this.calls.push({ params: Object.fromEntries(new URLSearchParams(body)), body: res.body });
    return res;
  }
}
const spy = new Spy();
const c = new InovioClient(
  { reqUsername:'ellenscoffee@gmail.com', reqPassword:'Password123456789', siteId:'100103', merchAcctId:'147129' },
  { endpoint:'https://t1api.inoviopay.com/payment/pmt_service.cfm', httpClient: spy, timeoutMs:60000 });

const base = {
  customer:{ firstName:'T', lastName:'S', email:'sdk@example.invalid', ip:'203.0.113.10' },
  billingAddress:{ line1:'123 Main St', city:'Austin', state:'TX', zip:'78701', country:'US' },
};

// --- forceCredit: what action is actually sent?
try {
  await c.forceCredit({ paymentMethod: PaymentMethods.card('4622943123100647','122026','242'),
    lineItems:[{productId:'111205',count:1,value:Money.of('1.00','USD')}], ...base,
    idempotency:{xtlOrderId:`FC-${Date.now()}`} });
} catch(e) { console.log('forceCredit threw:', e.constructor.name, e.message.slice(0,60)); }
const fc = spy.calls.at(-1);
console.log('  sent REQUEST_ACTION =', fc.params.REQUEST_ACTION, '| FORCE_CREDIT =', fc.params.FORCE_CREDIT);
console.log('  resp:', fc.body.slice(0,150));

// Is CCCREDIT itself allowed on this site? (refund against a real order worked earlier)
const a = await c.authorize({ paymentMethod: PaymentMethods.card('4622943123100647','122026','242'),
  lineItems:[{productId:'111205',count:1,value:Money.of('1.00','USD')}], ...base,
  idempotency:{xtlOrderId:`REF-${Date.now()}`} });
await c.capture(a.orderRef, Money.of('1.00','USD'));
const r = await c.refund(a.orderRef, Money.of('1.00','USD'));
console.log('\nreferenced CCCREDIT (refund):', r.status, '-> CCCREDIT IS allowed');
console.log('  so 104 on forceCredit = FORCE_CREDIT not enabled for this merchant account');

// --- captureLineItem: what ref does the gateway give, and what do we send back?
const a2 = await c.authorize({ paymentMethod: PaymentMethods.card('4622943123100647','122026','242'),
  lineItems:[{productId:'111205',count:1,value:Money.of('1.00','USD')},
             {productId:'111205',count:1,value:Money.of('2.00','USD')}], ...base,
  idempotency:{xtlOrderId:`LI-${Date.now()}`} });
const authRaw = spy.calls.at(-1).body;
console.log('\nauthorize raw (line-item keys):',
  Object.entries(JSON.parse(authRaw)).filter(([k])=>k.startsWith('PO_LI')).map(([k,v])=>`${k}=${v}`).join(' '));
console.log('  lineItemRefs parsed =', a2.lineItemRefs.map(l=>l.poLiId));
try {
  await c.captureLineItem(a2.lineItemRefs[0], Money.of('1.00','USD'));
} catch(e) { console.log('  captureLineItem threw:', e.constructor.name, e.message.slice(0,50)); }
const li = spy.calls.at(-1);
console.log('  sent:', JSON.stringify({REQUEST_ACTION:li.params.REQUEST_ACTION, REQUEST_REF_PO_LI_ID:li.params.REQUEST_REF_PO_LI_ID, LI_VALUE_1:li.params.LI_VALUE_1}));
console.log('  resp:', li.body.slice(0,200));
