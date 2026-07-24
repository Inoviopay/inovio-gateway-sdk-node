/**
 * tokenize() — token_service.cfm
 *
 * Exchanges a PAN for a single-use TOKEN_GUID that replaces PMT_NUMB on a
 * later transaction. A new token is required per transaction.
 *
 * Needs a SITE KEY: a per-site HMAC secret from Inovio support, NOT your
 * gateway password. Without it the service answers error 121.
 *
 * ⚠️ This is a SERVER-SIDE call — the PAN passes through your infrastructure,
 * the card number passes through your server. The browser Hosted Fields client keeps it in the cardholder's browser.
 */
import { PaymentMethods, Money } from '../dist/index.js';
import { client, demo, show, tokenClient } from './_harness.mjs';

// Tokenize on the site that holds the HMAC key...
const t = await tokenClient().tokenize(PaymentMethods.card(demo.pan, demo.expiry, demo.cvv));

show('token', t.token.guid);
show('token req id', t.tokenReqId ?? '-');
// BIN metadata is best-effort — blank when the BIN is not in the lookup table.
show('card', [t.card.brand, t.card.type, t.card.bank].filter(Boolean).join(' / ') || '(BIN not found)');

// The token replaces the PAN ONLY: expiry (and CVV) still travel with it, which
// tokenize() carries forward for you.
// ...then transact on the gateway site.
const sale = await client().sale({
  paymentMethod: t.token,
  lineItems: [{ productId: demo.productId, count: 1, value: Money.of('10.00', 'USD') }],
  customer: demo.customer,
  billingAddress: demo.billingAddress,
  idempotency: { xtlOrderId: demo.orderId('TOK') },
});
show('sale with token', `${sale.status} order=${sale.orderRef?.poId ?? '-'}`);
