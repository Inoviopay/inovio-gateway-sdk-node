/** Unit tests for behavior not covered by the shared conformance corpus. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  InovioClient,
  Money,
  PaymentMethods,
  Refs,
  ValidationError,
  AVS_CODES,
  SERVICE_RESPONSE_CODES,
  TRANSACTION_STATUS,
  SPEC_API_VERSION,
} from '../dist/index.js';

/* ------------------------------------------------------------------ Money */

test('Money rejects numbers, accepts decimal strings', () => {
  assert.throws(() => Money.of(1.25, 'USD'), TypeError);
  assert.throws(() => Money.of('1.2.3', 'USD'), TypeError);
  assert.throws(() => Money.of('1.25', 'DOLLARS'), TypeError);
  const m = Money.of('1.25', 'usd');
  assert.equal(m.amount, '1.25');
  assert.equal(m.currency, 'USD');
  assert.equal(m.toWire(), '1.25');
});

test('Money.equals compares numerically', () => {
  assert.ok(Money.of('1.50', 'USD').equals(Money.of('1.5', 'USD')));
  assert.ok(!Money.of('1.50', 'USD').equals(Money.of('1.50', 'EUR')));
});

/* ---------------------------------------------------------- PaymentMethods */

test('card validates PAN and MMYYYY expiry', () => {
  assert.throws(() => PaymentMethods.card('41111', '122030'), TypeError);
  assert.throws(() => PaymentMethods.card('4111111111111111', '12/30'), TypeError);
  assert.throws(() => PaymentMethods.card('4111111111111111', '132030'), TypeError);
  const c = PaymentMethods.card('4111 1111 1111 1111', '122030', '123');
  assert.equal(c.number, '4111111111111111');
  assert.equal(c.kind, 'card');
});

test('savedCard requires an identifier', () => {
  assert.throws(() => PaymentMethods.savedCard({}), TypeError);
  assert.equal(PaymentMethods.savedCard({ pmtId: 'X' }).pmtId, 'X');
});

/* ------------------------------------------------------------ generated enums */

test('spec enums are present and classified', () => {
  assert.equal(SPEC_API_VERSION, '4.14');
  assert.equal(TRANSACTION_STATUS.APPROVED, 'APPROVED');
  assert.equal(Object.keys(TRANSACTION_STATUS).length, 5);

  // classifiers the object model depends on
  assert.equal(SERVICE_RESPONSE_CODES[640].retryable, true);
  assert.equal(SERVICE_RESPONSE_CODES[219].stopRecurring, true);
  assert.equal(SERVICE_RESPONSE_CODES[100].approval, true);

  // AVS 'A' is partial (street matches, postal does not) — not positive
  assert.equal(AVS_CODES.A.classification, 'partial');
  assert.equal(AVS_CODES.N.classification, 'negative');
  assert.equal(AVS_CODES.X.classification, 'positive');
});

/* ------------------------------------------------------------ request build */

class Capture {
  async post(_u, body) {
    this.params = Object.fromEntries(new URLSearchParams(body));
    return {
      status: 200,
      body: JSON.stringify({
        REQUEST_ACTION: 'CCAUTHCAP',
        TRANS_STATUS_NAME: 'APPROVED',
        TRANS_VALUE: '1.00',
        CURR_CODE_ALPHA: 'USD',
        PO_ID: 'PO-1',
        API_RESPONSE: '0',
        SERVICE_RESPONSE: '100',
      }),
    };
  }
}

const mk = (http) =>
  new InovioClient(
    { reqUsername: 'u', reqPassword: 'p', siteId: '7' },
    { httpClient: http, endpoint: 'https://x.invalid/pmt_service.cfm' }
  );

test('line items are 1-indexed and carry auth params', async () => {
  const http = new Capture();
  await mk(http).sale({
    paymentMethod: PaymentMethods.card('4111111111111111', '122030'),
    lineItems: [
      { productId: 'A', count: 1, value: Money.of('1.00', 'USD') },
      { productId: 'B', count: 2, value: Money.of('2.50', 'USD') },
    ],
  });
  assert.equal(http.params.LI_PROD_ID_1, 'A');
  assert.equal(http.params.LI_VALUE_1, '1.00');
  assert.equal(http.params.LI_PROD_ID_2, 'B');
  assert.equal(http.params.LI_COUNT_2, '2');
  assert.equal(http.params.REQUEST_CURRENCY, 'USD');
  assert.equal(http.params.REQUEST_ACTION, 'CCAUTHCAP');
  assert.equal(http.params.SITE_ID, '7');
  assert.equal(http.params.REQUEST_API_VERSION, '4.14');
});

test('the REQUEST_INITATOR wire misspelling is hidden from callers', async () => {
  const http = new Capture();
  await mk(http).sale({
    paymentMethod: PaymentMethods.card('4111111111111111', '122030'),
    lineItems: [{ productId: 'A', count: 1, value: Money.of('1.00', 'USD') }],
    recurring: { initiator: 'MIT', rebill: 'REBILL' },
  });
  assert.equal(http.params.REQUEST_INITATOR, 'MIT'); // sic — wire spelling
  assert.equal(http.params.REQUEST_REBILL, '1');
});

test('mixed-currency line items are rejected locally', async () => {
  await assert.rejects(
    () =>
      mk(new Capture()).sale({
        paymentMethod: PaymentMethods.card('4111111111111111', '122030'),
        lineItems: [
          { productId: 'A', count: 1, value: Money.of('1.00', 'USD') },
          { productId: 'B', count: 1, value: Money.of('1.00', 'EUR') },
        ],
      }),
    ValidationError
  );
});

test('empty line items rejected; count cap enforced', async () => {
  const c = mk(new Capture());
  const pm = PaymentMethods.card('4111111111111111', '122030');
  await assert.rejects(() => c.sale({ paymentMethod: pm, lineItems: [] }), ValidationError);
  await assert.rejects(
    () =>
      c.sale({
        paymentMethod: pm,
        lineItems: [{ productId: 'A', count: 11, value: Money.of('1.00', 'USD') }],
      }),
    ValidationError
  );
});

test('timeoutVoid range is validated', async () => {
  await assert.rejects(
    () =>
      mk(new Capture()).sale({
        paymentMethod: PaymentMethods.card('4111111111111111', '122030'),
        lineItems: [{ productId: 'A', count: 1, value: Money.of('1.00', 'USD') }],
        risk: { timeoutVoid: { seconds: 5 } },
      }),
    ValidationError
  );
});

test('token payment method sends TOKEN_GUID, not PAN', async () => {
  const http = new Capture();
  await mk(http).sale({
    paymentMethod: PaymentMethods.token('TG-123'),
    lineItems: [{ productId: 'A', count: 1, value: Money.of('1.00', 'USD') }],
  });
  assert.equal(http.params.TOKEN_GUID, 'TG-123');
  assert.equal(http.params.PMT_NUMB, undefined);
});

/* -------------------------------------------------------------- follow-ups */

test('capture/refund/reverse send the order reference', async () => {
  const order = Refs.order('PO-42');
  for (const [fn, action] of [
    ['capture', 'CCCAPTURE'],
    ['refund', 'CCCREDIT'],
    ['reverse', 'CCREVERSE'],
    ['reverseCapture', 'CCREVERSECAP'],
  ]) {
    const http = new Capture();
    await mk(http)[fn](order);
    assert.equal(http.params.REQUEST_REF_PO_ID, 'PO-42', fn);
    assert.equal(http.params.REQUEST_ACTION, action, fn);
  }
});

test('partial capture carries the amount', async () => {
  const http = new Capture();
  await mk(http).capture(Refs.order('PO-42'), Money.of('5.00', 'USD'));
  assert.equal(http.params.LI_VALUE_1, '5.00');
  assert.equal(http.params.REQUEST_CURRENCY, 'USD');
});

/* --------------------------------------------------------------- transport */

test('response field names are normalized case-insensitively', async () => {
  const http = {
    async post() {
      return {
        status: 200,
        body: JSON.stringify({
          request_action: 'CCAUTHCAP',
          trans_status_name: 'APPROVED',
          po_id: 'PO-LOWER',
          api_response: '0',
          service_response: '100',
        }),
      };
    },
  };
  const r = await mk(http).sale({
    paymentMethod: PaymentMethods.card('4111111111111111', '122030'),
    lineItems: [{ productId: 'A', count: 1, value: Money.of('1.00', 'USD') }],
  });
  assert.equal(r.status, 'APPROVED');
  assert.equal(r.orderRef.poId, 'PO-LOWER');
});

test('XTL_PO_ID aliases to XTL_ORDER_ID', async () => {
  const http = {
    async post() {
      return {
        status: 200,
        body: JSON.stringify({
          REQUEST_ACTION: 'CCAUTHCAP',
          TRANS_STATUS_NAME: 'APPROVED',
          XTL_PO_ID: 'ORD-9',
          API_RESPONSE: '0',
        }),
      };
    },
  };
  const r = await mk(http).sale({
    paymentMethod: PaymentMethods.card('4111111111111111', '122030'),
    lineItems: [{ productId: 'A', count: 1, value: Money.of('1.00', 'USD') }],
  });
  assert.equal(r.xtlOrderRef.value, 'ORD-9');
});

test('credentials are validated at construction', () => {
  assert.throws(() => new InovioClient({ reqUsername: 'u' }), ValidationError);
});
