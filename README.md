# Inovio Gateway SDK — Node / TypeScript

The Inovio payment gateway for Node. Card transactions — authorize, capture,
refund, tokenize — with a typed, promise-based API.

> **Status: alpha.** Not yet published to npm.

## Install / build

```bash
npm install
npm run generate    # regenerate enums from spec/spec-enums.json
npm run build
npm test
```

## Quick start

```ts
import { InovioClient, Money, PaymentMethods, Refs } from '@inovio/gateway-sdk';

const client = new InovioClient(
  { reqUsername: process.env.INOVIO_USER!, reqPassword: process.env.INOVIO_PASS!, siteId: '123' },
  { environment: 'SANDBOX' }
);

const result = await client.sale({
  paymentMethod: PaymentMethods.card('4111111111111111', '122030', '123'),
  lineItems: [{ productId: 'SKU-1', count: 1, value: Money.of('10.00', 'USD') }],
  idempotency: { xtlOrderId: 'ORDER-555' },   // retry-safe by default
});

switch (result.status) {
  case 'APPROVED': /* fulfil */ break;
  case 'DECLINED': /* result.outcome.service, result.serviceClassification */ break;
  case 'PENDING':  /* result.nextAction — 3DS challenge, redirect, voucher */ break;
  case 'RUNNING':
  case 'FAILED':   break;
}
```

## Five things that will surprise you (and why)

**1. A decline is not an error.** `sale()` resolves normally with
`status: 'DECLINED'`. Exceptions are reserved for transport, auth, validation and
configuration failures — cases where you never got a payment answer at all.

**2. There are no `approved` / `declined` booleans.** Only `status`. Booleans
invite `if (approved) {...} else {...}`, which silently treats `PENDING` as
failure — and `PENDING` is a real, non-failed state (3DS challenge, ACH, Pix).
The five-state enum forces you to decide what to do about it.

**3. `settled` is almost always `false` at response time.** It is written `0` at
authorization and flipped later by batch settlement. It is *not* a failure
signal. Separately, `conversion` appears **only** when real FX occurred — on a
domestic transaction the wire's "settled amount" is just the auth amount echoed
back, so a block that was always present would tell you nothing.

**4. `status()` is the reconciliation primitive, not just timeout recovery.**
Partial capture, refund and void are *separate transactions sharing a `PO_ID`*,
not edits to the original. So net position is an order-level question:
`OrderStatus` gives you `authorized` / `captured` / `refunded` / `net` /
`outstanding`, derived the same way the gateway's own `BATCH_PKG` derives them.
One `TransactionResult` cannot answer "what did this order settle for."

**5. `Money` refuses JavaScript numbers.** `Money.of(1.25, 'USD')` throws; pass
`'1.25'`. Binary floats cannot represent decimal amounts exactly, and the wire
format is a decimal string. Rounding should be your explicit decision.

## What the SDK hides

Wire quirks are normalized once, internally, and never reach you:

| Wire | SDK |
|------|-----|
| `REQUEST_ACTION=CCAUTHCAP` | `client.sale()` |
| `REQUEST_INITATOR` (sic — misspelled in the protocol) | `recurring.initiator` |
| `XTL_ORDER_ID` / `XTL_PO_ID` (same thing) | `xtlOrderRef` |
| `PMT_L4` / `PMT_LAST4` (same thing) | `card.last4` |
| `PMT_NUMB` = PAN *or* bank account *or* IBAN | `PaymentMethod` variants |
| `LI_VALUE_1`, `LI_COUNT_1`, ... | `lineItems: LineItem[]` |
| case-inconsistent response keys | upper-cased map |

Every result also carries `raw` — the complete unmodified field map — as an
escape hatch.

## Timeout handling

A timeout means the transaction state is **unknown**; it may still have been
approved. `TimeoutError` carries your idempotency key so you can resolve the
truth instead of guessing:

```ts
try {
  await client.sale({ ...req, idempotency: { xtlOrderId: 'ORDER-555' } });
} catch (e) {
  if (e instanceof TimeoutError) {
    console.warn(e.recoveryHint);
    const actual = await client.status(Refs.xtlOrder('ORDER-555'));
    // a blind retry here could double-charge
  }
}
```

Idempotency defaults to `RETURN_ORIGINAL` when `xtlOrderId` is set, so a retry
returns the original result rather than charging twice.

## v1 scope

Cards only: `sale`, `authorize`, `capture`, `captureLineItem`, `reverse`,
`reverseCapture`, `refund`, `forceCredit`, `status`, `updateOrder`, `tokenize`,
`testAuth`, `testAvailability`. Payment methods: `Card`, `Token`, `SavedCard`.

Declared but not implemented (they fill existing seams, no breaking change):
ACH, EU direct debit, Boleto/Pix/PagoEfectivo, wallets, subscriptions, disputes,
`webhooks.parse`.

## Where the card number goes

`tokenize()` is a **server-side** call — the card number passes through your
server. To keep the number in the cardholder's browser instead, use the browser
Hosted Fields client (not yet available).

## Classifier fields are our interpretation, not the spec

Some fields the SDK gives you are **derived by us from the response codes, not
returned by the gateway** — and you will branch real logic on them, so it is
worth knowing which:

- **`serviceClassification.retryable` / `terminal` / `stopRecurring`** — your
  dunning logic decides whether to re-try a declined charge based on these. We
  set them from the service response code; the gateway does not send them.
- **`avs.classification`** — `positive` / `partial` / `negative` / `neutral`.
  `partial` means some elements matched and some did not (e.g. street matches
  but postal code does not). **Whether a partial AVS result is acceptable is
  your risk decision** — the SDK reports the classification and deliberately
  does not accept or reject for you.

If you need the raw gateway value instead of our label, every result carries a
`raw` map with the verbatim response fields.

## Tokenization (spec §4.8)

`tokenize()` exchanges a PAN for a single-use `TOKEN_GUID` that replaces
`PMT_NUMB` on a later sale or authorize. It hits a **different endpoint**
(`token_service.cfm`) with **different auth** — HMAC headers, not
username/password.

You need a **site key**: a per-site HMAC secret issued by Inovio support. It is
*not* your gateway password. Without it the service answers error 121.

Two things the SDK handles that the spec will mislead you on:

**1. The signed message excludes the PAN.** The v4.14 PDF's §4.8.1.2 note says
the HMAC covers `card_pan`, and its worked example agrees — but the gateway
does not. The gateway actually validates:

```
hmac_sha256(timestamp || unique_id || site_id, site_key)
```

Signing with the card number included fails with error 121. This SDK signs
the way the gateway expects.

**2. A token replaces the PAN only.** The transaction still needs the expiry
(and CVV where the processor asks), so `tokenize()` carries them forward onto
the returned token. Sending a bare `TOKEN_GUID` yields API 110 `Required field`
on `REF_FIELD=pmt_expiry`.

BIN metadata (`brand`, `bank`, `country`, ...) is best-effort: the service
returns those keys **empty** when the BIN is not in its lookup table, and the
SDK normalizes blanks to null/undefined so you can test for presence.

⚠️ `tokenize()` runs on your server, so the card number passes through it. To
keep the number in the cardholder's browser instead, use the browser Hosted
Fields client (not yet available).
