/**
 * Wire response -> typed TransactionResult / OrderStatus.
 *
 * All the "is this approved" judgment lives here and in the generated spec
 * enums, so every language SDK classifies identically.
 */
import {
  AVS_CODES,
  CVV_CODES,
  SERVICE_RESPONSE_CODES,
  TRANSACTION_STATUS,
  type TransactionStatus,
} from '../enums/generated.js';
import { TransportError } from '../errors/index.js';
import { Money } from '../model/money.js';
import { Refs } from '../refs/index.js';
import type { OrderStatus, Outcome, TransactionResult, NextAction, CardInfo } from './index.js';

const num = (v?: string): number | undefined => {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const isTruthyFlag = (v?: string): boolean => v === '1' || v?.toUpperCase() === 'Y' || v?.toUpperCase() === 'TRUE';

function buildOutcome(r: Record<string, string>): Outcome {
  return {
    api: {
      code: num(r.API_RESPONSE),
      advice: r.API_ADVICE,
      refField: r.REF_FIELD,
    },
    service: { code: num(r.SERVICE_RESPONSE), advice: r.SERVICE_ADVICE },
    processor: { code: num(r.PROCESSOR_RESPONSE), advice: r.PROCESSOR_ADVICE },
    industry: { code: num(r.INDUSTRY_RESPONSE), advice: r.INDUSTRY_ADVICE },
  };
}

function buildCard(r: Record<string, string>): CardInfo | undefined {
  const has =
    r.CARD_BRAND_NAME ||
    r.PMT_L4 ||
    r.CARD_TYPE ||
    r.CARD_BANK ||
    r.CARD_COUNTRY;
  if (!has) return undefined;
  const card: CardInfo = {
    brand: r.CARD_BRAND_NAME,
    detail: r.CARD_DETAIL,
    type: r.CARD_TYPE,
    class: r.CARD_CLASS,
    country: r.CARD_COUNTRY,
    bank: r.CARD_BANK,
    prepaid: r.CARD_PREPAID === '1',
    balance: r.CARD_BALANCE,
    last4: r.PMT_L4,
    networkTokenUsed: num(r.TRANS_NTOKEN_USED),
  };
  if (r.PMT_AAU_UPDATE_DESC || r.PMT_AAU_UPDATE_DATE) {
    return {
      ...card,
      accountUpdater: {
        description: r.PMT_AAU_UPDATE_DESC,
        date: r.PMT_AAU_UPDATE_DATE,
        newExpiry: r.PMT_AAU_UPDATE_EXPIRY,
        newLast4: r.PMT_AAU_UPDATE_L4,
      },
    };
  }
  return card;
}

function buildNextAction(
  r: Record<string, string>,
  status: TransactionStatus
): NextAction | undefined {
  if (status !== TRANSACTION_STATUS.PENDING) return undefined;
  if (r.P3DS_PROCTRANSID || r.PAREQ || r.P3DS_JWT) {
    return {
      kind: 'threeDSChallenge',
      redirectUrl: r.PROC_REDIRECT_URL,
      jwt: r.P3DS_JWT,
      procTransId: r.P3DS_PROCTRANSID,
      pareq: r.PAREQ,
    };
  }
  if (r.PROC_BARCODE) {
    return { kind: 'displayVoucher', url: r.PROC_REDIRECT_URL, barcode: r.PROC_BARCODE };
  }
  if (r.PIX_TOKEN) {
    return { kind: 'displayQr', url: r.PROC_REDIRECT_URL, token: r.PIX_TOKEN };
  }
  if (r.PROC_REDIRECT_URL) {
    return { kind: 'redirect', url: r.PROC_REDIRECT_URL };
  }
  return { kind: 'awaitSettlement' };
}

function parseStatus(raw?: string): TransactionStatus {
  const s = (raw ?? '').toUpperCase().trim();
  if (s in TRANSACTION_STATUS) return s as TransactionStatus;
  // An unrecognized status must not silently read as approved.
  return TRANSACTION_STATUS.FAILED;
}

export function toTransactionResult(r: Record<string, string>): TransactionResult {
  const status = parseStatus(r.TRANS_STATUS_NAME);
  const serviceCode = num(r.SERVICE_RESPONSE);
  const svcInfo = serviceCode !== undefined ? SERVICE_RESPONSE_CODES[serviceCode] : undefined;

  const lineItemRefs = Object.keys(r)
    .filter((k) => /^PO_LI_ID_\d+$/.test(k))
    .sort((a, b) => Number(a.split('_').pop()) - Number(b.split('_').pop()))
    .map((k) => Refs.lineItem(r[k]));

  const amount =
    r.TRANS_VALUE && r.CURR_CODE_ALPHA
      ? Money.of(r.TRANS_VALUE, r.CURR_CODE_ALPHA)
      : undefined;

  // Conversion is reported ONLY on real FX — otherwise the "settled" fields are
  // just the auth amount echoed back and would mean nothing.
  const rate = r.TRANS_EXCH_RATE;
  const conversion =
    rate && Number(rate) !== 0 && r.TRANS_VALUE_SETTLED && r.CURR_CODE_ALPHA_SETTLED
      ? {
          amount: Money.of(r.TRANS_VALUE_SETTLED, r.CURR_CODE_ALPHA_SETTLED),
          exchangeRate: rate,
        }
      : undefined;

  const avsRaw = r.AVS_RESPONSE;
  const cvvRaw = r.CVV_RESPONSE;

  return {
    status,
    settling:
      status === TRANSACTION_STATUS.PENDING || status === TRANSACTION_STATUS.RUNNING,
    action: r.REQUEST_ACTION ?? '',
    orderRef: r.PO_ID ? Refs.order(r.PO_ID) : undefined,
    xtlOrderRef: r.XTL_ORDER_ID ? Refs.xtlOrder(r.XTL_ORDER_ID) : undefined,
    transactionId: r.TRANS_ID ? Refs.transaction(r.TRANS_ID) : undefined,
    requestId: r.REQ_ID ? Refs.req(r.REQ_ID) : undefined,
    batchId: r.BATCH_ID ? Refs.batch(r.BATCH_ID) : undefined,
    customerRef:
      r.CUST_ID || r.XTL_CUST_ID
        ? Refs.customer({ custId: r.CUST_ID, xtlCustId: r.XTL_CUST_ID })
        : undefined,
    savedCardRef:
      r.PMT_ID || r.PMT_ID_XTL
        ? Refs.savedCard({ pmtId: r.PMT_ID, pmtIdXtl: r.PMT_ID_XTL })
        : undefined,
    membershipRef:
      r.MBSHP_ID || r.MBSHP_ID_XTL
        ? Refs.membership({ mbshpId: r.MBSHP_ID, mbshpIdXtl: r.MBSHP_ID_XTL })
        : undefined,
    lineItemRefs,
    amount,
    settled: isTruthyFlag(r.TRANS_SETTLED),
    conversion,
    outcome: buildOutcome(r),
    serviceClassification: svcInfo
      ? {
          retryable: svcInfo.retryable,
          stopRecurring: svcInfo.stopRecurring,
          terminal: svcInfo.terminal,
          approval: svcInfo.approval,
        }
      : undefined,
    avs: avsRaw && AVS_CODES[avsRaw.toUpperCase()]
      ? { ...AVS_CODES[avsRaw.toUpperCase()], raw: avsRaw }
      : undefined,
    cvv: cvvRaw && CVV_CODES[cvvRaw.toUpperCase()]
      ? { ...CVV_CODES[cvvRaw.toUpperCase()], raw: cvvRaw }
      : undefined,
    card: buildCard(r),
    nextAction: buildNextAction(r, status),
    raw: Object.freeze({ ...r }),
  };
}

/**
 * Sum decimal-string amounts without going through binary floats.
 *
 * Amounts may be NEGATIVE: the gateway reports credit legs (CCCREDIT) with a
 * negative TRANS_VALUE, so a refund of 1.00 arrives as "-1". Confirmed against
 * the live T1 gateway.
 */
function sumAmounts(values: string[], currency: string): Money {
  const precision = values.reduce((m, v) => {
    const dot = v.indexOf('.');
    return Math.max(m, dot === -1 ? 0 : v.length - dot - 1);
  }, 0);
  const scale = 10 ** precision;
  const total = values.reduce((acc, v) => acc + Math.round(Number(v) * scale), 0);
  return Money.of((total / scale).toFixed(precision), currency);
}

/** Negate a decimal string without float round-tripping. */
function negate(v: string): string {
  return v.startsWith('-') ? v.slice(1) : `-${v}`;
}

/** Absolute value of a decimal string, preserving its textual form. */
function abs(v: string): string {
  return v.startsWith('-') ? v.slice(1) : v;
}

/**
 * Build an OrderStatus from a CCSTATUS response.
 *
 * Net position mirrors BATCH_PKG's sibling-sum keyed on PO_ID (§3.6): captures
 * and refunds are separate legs sharing the order, so the SDK aggregates them
 * rather than asking the partner to.
 */
export function toOrderStatus(
  r: Record<string, string>,
  legs: TransactionResult[]
): OrderStatus {
  const currency =
    legs.find((l) => l.amount)?.amount?.currency ?? r.CURR_CODE_ALPHA ?? 'USD';

  const amountsFor = (pred: (l: TransactionResult) => boolean): string[] =>
    legs.filter((l) => pred(l) && l.amount).map((l) => l.amount!.amount);

  // Three distinct leg kinds — conflating void with refund gets the maths wrong.
  //
  //   CCAUTHORIZE / CCAUTHCAP : establishes the authorized amount
  //   CCCAPTURE               : draws down against the authorization
  //   CCCREDIT                : refunds a capture (money returned)
  //   CCREVERSE / CCREVERSECAP: VOIDS — cancels an authorization or a capture.
  //                             A void is not a refund: it releases the hold,
  //                             so it must reduce `authorized`, not inflate
  //                             `refunded`. Verified on the live T1 gateway,
  //                             where a voided auth must settle to net 0 with
  //                             nothing outstanding.
  const isAuth = (l: TransactionResult) => /AUTHORIZE|AUTHCAP/i.test(l.action);
  // CCAUTHCAP authorizes AND captures in one leg, so it counts as both —
  // otherwise a `sale()` reports captured=0 with the full amount outstanding,
  // which is the opposite of what happened. Verified on the live T1 gateway.
  const isCapture = (l: TransactionResult) =>
    /CAPTURE|AUTHCAP/i.test(l.action) && !/REVERSECAP/i.test(l.action);
  const isVoid = (l: TransactionResult) => /REVERSE/i.test(l.action);
  const isRefund = (l: TransactionResult) => /CREDIT/i.test(l.action);

  const approved = (l: TransactionResult) => l.status === TRANSACTION_STATUS.APPROVED;

  const authorizedGross = sumAmounts(
    amountsFor((l) => isAuth(l) && approved(l)),
    currency
  );
  const captured = sumAmounts(amountsFor((l) => isCapture(l) && approved(l)), currency);
  // Credit and void legs both arrive with a negative TRANS_VALUE; take magnitudes.
  const voided = sumAmounts(
    amountsFor((l) => isVoid(l) && approved(l)).map(abs),
    currency
  );
  const refunded = sumAmounts(
    amountsFor((l) => isRefund(l) && approved(l)).map(abs),
    currency
  );

  // A void releases the authorization rather than returning captured funds.
  const authorized = sumAmounts(
    [authorizedGross.amount, negate(voided.amount)],
    currency
  );
  const net = sumAmounts([captured.amount, negate(refunded.amount)], currency);
  const outstanding = sumAmounts(
    [authorized.amount, negate(captured.amount)],
    currency
  );

  // CCSTATUS answers with a COLUMNS/DATA table that carries no top-level
  // PO_ID — the order id lives on each leg. Fall back to the legs so the
  // aggregate is still keyed correctly.
  const poId = r.PO_ID || legs.find((l) => l.orderRef)?.orderRef?.poId;
  if (!poId) {
    throw new TransportError('CCSTATUS response carried no PO_ID on any leg');
  }
  const xtl = r.XTL_ORDER_ID || legs.find((l) => l.xtlOrderRef)?.xtlOrderRef?.value;

  return {
    ref: Refs.order(poId),
    xtlRef: xtl ? Refs.xtlOrder(xtl) : undefined,
    transactions: legs,
    authorized,
    captured,
    refunded,
    net,
    outstanding,
    settled: legs.length > 0 && legs.every((l) => !isAuth(l) || l.settled),
    raw: Object.freeze({ ...r }),
  };
}
