/**
 * Shared harness for the runnable examples.
 *
 * Every example is real, executed code — not a markdown snippet — so it cannot
 * silently drift from the API. `npm run examples` runs them all.
 *
 * By default they run against a MOCK transport: no credentials, no network, no
 * money moves, safe in CI. Set INOVIO_LIVE=1 (plus credentials) to run the same
 * code against the real gateway.
 */
import { InovioClient } from '../dist/index.js';

export const LIVE = process.env.INOVIO_LIVE === '1';

/** Canned responses keyed by REQUEST_ACTION, shaped like the real gateway. */
const MOCK_RESPONSES = {
  CCAUTHORIZE: {
    REQUEST_ACTION: 'CCAUTHORIZE', TRANS_STATUS_NAME: 'APPROVED',
    TRANS_VALUE: '10.00', CURR_CODE_ALPHA: 'USD', PO_ID: '18800001',
    TRANS_ID: '2000000001', PO_LI_ID_1: '9000001',
    API_RESPONSE: '0', SERVICE_RESPONSE: '100',
    CARD_BRAND_NAME: 'Visa', PMT_L4: '0647', AVS_RESPONSE: 'Y', CVV_RESPONSE: 'M',
  },
  CCAUTHCAP: {
    REQUEST_ACTION: 'CCAUTHCAP', TRANS_STATUS_NAME: 'APPROVED',
    TRANS_VALUE: '10.00', CURR_CODE_ALPHA: 'USD', PO_ID: '18800002',
    TRANS_ID: '2000000002', API_RESPONSE: '0', SERVICE_RESPONSE: '100',
    CARD_BRAND_NAME: 'Visa', PMT_L4: '0647',
  },
  CCCAPTURE: {
    REQUEST_ACTION: 'CCCAPTURE', TRANS_STATUS_NAME: 'APPROVED',
    TRANS_VALUE: '10.00', CURR_CODE_ALPHA: 'USD', PO_ID: '18800001',
    TRANS_ID: '2000000003', API_RESPONSE: '0', SERVICE_RESPONSE: '100',
  },
  CCREVERSE: {
    REQUEST_ACTION: 'CCREVERSE', TRANS_STATUS_NAME: 'APPROVED',
    TRANS_VALUE: '-10.00', CURR_CODE_ALPHA: 'USD', PO_ID: '18800001',
    TRANS_ID: '2000000004', API_RESPONSE: '0', SERVICE_RESPONSE: '100',
  },
  CCREVERSECAP: {
    REQUEST_ACTION: 'CCREVERSECAP', TRANS_STATUS_NAME: 'APPROVED',
    TRANS_VALUE: '-10.00', CURR_CODE_ALPHA: 'USD', PO_ID: '18800001',
    TRANS_ID: '2000000005', API_RESPONSE: '0', SERVICE_RESPONSE: '100',
  },
  CCCREDIT: {
    REQUEST_ACTION: 'CCCREDIT', TRANS_STATUS_NAME: 'APPROVED',
    TRANS_VALUE: '-10.00', CURR_CODE_ALPHA: 'USD', PO_ID: '18800001',
    TRANS_ID: '2000000006', API_RESPONSE: '0', SERVICE_RESPONSE: '100',
  },
  CCTRANSUPDATE: {
    REQUEST_ACTION: 'CCTRANSUPDATE', TRANS_STATUS_NAME: 'APPROVED',
    PO_ID: '18800001', API_RESPONSE: '0', SERVICE_RESPONSE: '100',
  },
  TESTAUTH: {
    REQUEST_ACTION: 'TESTAUTH', API_RESPONSE: '0',
    SERVICE_RESPONSE: '100', SERVICE_ADVICE: 'User Authorized',
  },
  TESTGW: {
    REQUEST_ACTION: 'TESTGW', API_RESPONSE: '0',
    SERVICE_RESPONSE: '101', SERVICE_ADVICE: 'Service Available',
  },
};

/** CCSTATUS answers with a COLUMNS/DATA table, not flat fields. */
const MOCK_STATUS = {
  COLUMNS: ['REQUEST_ACTION', 'TRANS_STATUS_NAME', 'TRANS_VALUE', 'TRANS_ID', 'PO_ID', 'CURR_CODE_ALPHA'],
  DATA: [
    ['CCAUTHORIZE', 'APPROVED', 100.0, 'T-1', '18800001', 'USD'],
    ['CCCAPTURE', 'APPROVED', 60.0, 'T-2', '18800001', 'USD'],
    ['CCCREDIT', 'APPROVED', -10.0, 'T-3', '18800001', 'USD'],
  ],
};

const MOCK_TOKEN = {
  TOKEN_GUID: 'F76E1864D6E018BA5D98080167CDF86AD432FEBD',
  TOKEN_IP: '10.13.100.134', TOKEN_REQID: '4283012',
  CARD_BRAND_NAME: 'Visa', CARD_TYPE: 'VISA TRADITIONAL',
  CARD_BANK: 'CHASE BANK USA, NATIONAL ASSOCIATION',
  CARD_COUNTRY: 'USA', CARD_ACCOUNT_FUND_SOURCE: 'Credit', CARD_CLASS: 'CONSUMER',
};

class MockHttp {
  async post(url, body) {
    const p = Object.fromEntries(new URLSearchParams(body));
    if (url.includes('token_service')) {
      return { status: 200, body: JSON.stringify(MOCK_TOKEN) };
    }
    if (p.REQUEST_ACTION === 'CCSTATUS') {
      return { status: 200, body: JSON.stringify(MOCK_STATUS) };
    }
    const r = MOCK_RESPONSES[p.REQUEST_ACTION];
    if (!r) throw new Error(`no mock response for ${p.REQUEST_ACTION}`);
    return { status: 200, body: JSON.stringify(r) };
  }
}

/** A client wired for whichever mode is active. */
/**
 * The token service authenticates per SITE with an HMAC key, independent of the
 * gateway's username/password. A merchant is normally provisioned for both on
 * the same site — but on a shared test rig they may differ, so the token site
 * is configurable separately.
 */
export function tokenClient() {
  const siteId = process.env.INOVIO_TOKEN_SITE_ID ?? process.env.INOVIO_SITE_ID;
  return client({ siteId });
}

export function client(overrides = {}) {
  const { siteId: siteIdOverride, ...rest } = overrides;
  const creds = LIVE
    ? {
        reqUsername: process.env.INOVIO_USER,
        reqPassword: process.env.INOVIO_PASS,
        siteId: process.env.INOVIO_SITE_ID,
        merchAcctId: process.env.INOVIO_MERCH_ACCT_ID,
      }
    : { reqUsername: 'demo@example.invalid', reqPassword: 'demo', siteId: '100103' };

  return new InovioClient(
    siteIdOverride ? { ...creds, siteId: siteIdOverride } : creds,
    {
    endpoint: process.env.INOVIO_ENDPOINT ?? 'https://t1api.inoviopay.com/payment/pmt_service.cfm',
    httpClient: LIVE ? undefined : new MockHttp(),
    siteKey: process.env.INOVIO_SITE_KEY ?? 'demo-site-key',
      timeoutMs: 60_000,
      ...rest,
    }
  );
}

/** Values shared across examples so each file shows only its own operation. */
export const demo = {
  pan: process.env.INOVIO_TEST_PAN ?? '4622943123100647',
  expiry: process.env.INOVIO_TEST_EXPIRY ?? '122026',
  cvv: process.env.INOVIO_TEST_CVV ?? '242',
  productId: process.env.INOVIO_TEST_PRODUCT_ID ?? '111205',
  customer: {
    firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.invalid',
    // The processor rejects a missing IP with 'remote_ip is missing'.
    ip: '203.0.113.10',
  },
  billingAddress: {
    line1: '123 Main St', city: 'Austin', state: 'TX', zip: '78701',
    // Also processor-required, despite not being marked so in the spec.
    country: 'US',
  },
  orderId: (tag) => `EXAMPLE-${tag}-${Date.now()}`,
};

/**
 * Create a real authorized (and optionally captured) order to operate on.
 *
 * Follow-up operations need an order that actually exists, so examples that
 * demonstrate capture/refund/void build their own rather than hardcoding an id.
 */
export async function seedOrder(c, tag, { capture = false, amount = '10.00' } = {}) {
  const { Money, PaymentMethods } = await import('../dist/index.js');
  const auth = await c.authorize({
    paymentMethod: PaymentMethods.card(demo.pan, demo.expiry, demo.cvv),
    lineItems: [{ productId: demo.productId, count: 1, value: Money.of(amount, 'USD') }],
    customer: demo.customer,
    billingAddress: demo.billingAddress,
    idempotency: { xtlOrderId: demo.orderId(tag) },
  });
  if (capture && auth.orderRef) {
    await c.capture(auth.orderRef, Money.of(amount, 'USD'));
  }
  return auth;
}

export function show(label, value) {
  console.log(`  ${label.padEnd(22)} ${value}`);
}
