# Inovio Gateway SDK — Node / TypeScript

Reference implementation (**W1** of the internal SDK plan). This SDK defines the
canonical method surface, naming, and conformance fixtures that the PHP, Python
and Java ports must match.

> **Status: alpha, local only.** Not published to any registry. The contract is
> not frozen until this passes review — per PLAN.md §3, *"nothing ports until W1
> passes conformance."*

## Install / build

```bash
npm install
npm run generate    # regenerate enums from spec/spec-enums.json
npm run build
npm test            # 34 tests: 18 shared conformance + 16 unit
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

## PCI note

`tokenize()` is a **server-side** call — the PAN passes through your server, so
you remain in PCI scope. The low-scope path is the browser Hosted Fields client
(**W-client**), which tokenizes without the PAN reaching your infrastructure.
That track is not built yet and is blocked on the client-side object-model
extension (PLAN.md §1).

## Enums are generated, not hand-written

`src/enums/generated.ts` is produced by `npm run generate` from
`spec/spec-enums.json` (196 values extracted from the v4.14 PDF). Do not edit
it. This is decision **D1** — one artifact drives all five languages so the
appendices cannot drift apart.

⚠️ The `retryable` / `terminal` / `stopRecurring` and AVS/CVV classifications are
**derived by this project, not stated in the spec**. They drive partner dunning
and risk logic — see [`spec/README.md`](spec/README.md) before relying on
them. In particular, AVS `partial` (street matches but postal does not, etc.) is
a *merchant risk-policy* decision; the SDK reports the classification and
deliberately does not decide for you.

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
does not. `CRPT.TOKEN_PKG` validates:

```
hmac_sha256(timestamp || unique_id || site_id, site_key)
```

Signing with the PAN included fails with error 121. This SDK follows the
gateway, verified against live T1.

**2. A token replaces the PAN only.** The transaction still needs the expiry
(and CVV where the processor asks), so `tokenize()` carries them forward onto
the returned token. Sending a bare `TOKEN_GUID` yields API 110 `Required field`
on `REF_FIELD=pmt_expiry`.

BIN metadata (`brand`, `bank`, `country`, ...) is best-effort: the service
returns those keys **empty** when the BIN is not in its lookup table, and the
SDK normalizes blanks to null/undefined so you can test for presence.

⚠️ This is a **server-side** call — the PAN passes through your infrastructure,
so you remain in PCI scope. The low-scope path is the browser Hosted Fields
client, which is not built yet.

## Vendored spec artifacts

This repo **stands alone**: `spec/spec-enums.json` and
`spec/conformance-fixtures.json` are committed copies, so a fresh clone builds,
tests and regenerates with no sibling checkout, submodule or network fetch.

They are not the editable source — they are produced upstream in the internal
`inoviov2` workspace (`api-sdk/spec/`), where the extraction pipeline and its
validator live. To pull an upstream change in:

```bash
./scripts/sync-spec.sh /path/to/inoviov2/api-sdk/spec
```

Then regenerate the enums, run the suite, and commit the spec change together
with the generated code it produces.

**This is a coordinated change.** The other Inovio SDK repos vendor the same two
files; if they are not synced in step, the SDKs silently stop agreeing — which
is exactly what the shared conformance corpus exists to prevent.

## Conformance

`test/conformance.test.mjs` runs the shared corpus in
`spec/conformance-fixtures.json`. Every language SDK runs these same fixtures
and must produce the same typed result. A fixture change is a coordinated change
across all five SDKs.

Not yet done: sandbox smoke tests against the live gateway (PLAN.md §5 item 3),
which need sandbox credentials.
