/**
 * Request objects and the model -> wire projection.
 *
 * This is where the SDK earns its keep: flat, uppercase, 1-indexed wire params
 * (LI_VALUE_1, BILL_ADDR_ZIP, REQUEST_INITATOR...) are produced from cohesive
 * objects so the partner never types a wire field name.
 */
import { ValidationError } from '../errors/index.js';
import type {
  Address,
  Affiliate,
  BrowserData,
  Customer,
  Descriptor,
  Fees,
  Idempotency,
  LineItem,
  Metadata,
  PartialAuth,
  Recurring,
  RiskOptions,
} from '../model/index.js';
import { assertV1PaymentMethod, type PaymentMethod } from '../model/payment-method.js';
import type { Money } from '../model/money.js';

export interface BaseTransactionRequest {
  paymentMethod: PaymentMethod;
  /** Optional when derivable from lineItems; required otherwise. */
  amount?: Money;
  lineItems: LineItem[];
  customer?: Customer;
  billingAddress?: Address;
  shippingAddress?: Address;
  descriptor?: Descriptor;
  risk?: RiskOptions;
  partialAuth?: PartialAuth;
  idempotency?: Idempotency;
  recurring?: Recurring;
  fees?: Fees;
  affiliate?: Affiliate;
  metadata?: Metadata;
  merchAcctId?: string;
  browser?: BrowserData;
}

export type SaleRequest = BaseTransactionRequest;
export type AuthorizeRequest = BaseTransactionRequest;

export interface CreditRequest extends BaseTransactionRequest {
  /** FORCE_CREDIT — a credit with no referenced original transaction. */
  force?: true;
}

/** CCTRANSUPDATE payload — receipts attached post-hoc (Appendix G compliance). */
export interface OrderUpdate {
  receipt?: string;
  metadata?: Metadata;
}

const IDEMPOTENCY_WIRE: Record<string, string> = {
  OFF: '0',
  DECLINE_DUP: '1',
  RETURN_ORIGINAL: '2',
};

const AVS_WIRE: Record<string, string> = {
  on: '1',
  off: '0',
  ignore: '2',
  conditional: '3',
};

function put(
  params: Record<string, string>,
  key: string,
  value: string | number | boolean | undefined | null
): void {
  if (value === undefined || value === null || value === '') return;
  params[key] = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
}

function applyAddress(
  params: Record<string, string>,
  prefix: 'BILL' | 'SHIP',
  addr?: Address
): void {
  if (!addr) return;
  put(params, `${prefix}_ADDR`, addr.line1);
  put(params, `${prefix}_ADDR2`, addr.line2);
  put(params, `${prefix}_ADDR_CITY`, addr.city);
  put(params, `${prefix}_ADDR_STATE`, addr.state);
  put(params, `${prefix}_ADDR_ZIP`, addr.zip);
  put(params, `${prefix}_ADDR_COUNTRY`, addr.country);
  put(params, `${prefix}_ADDR_DISTRICT`, addr.district);
}

/** Projects a request onto the wire parameter map. */
export function buildTransactionParams(req: BaseTransactionRequest): Record<string, string> {
  const p: Record<string, string> = {};

  assertV1PaymentMethod(req.paymentMethod);

  if (!req.lineItems || req.lineItems.length === 0) {
    throw new ValidationError('at least one line item is required', {
      refField: 'LI_VALUE_1',
    });
  }

  // --- payment method: absorbs the PMT_NUMB overload -------------------
  const pm = req.paymentMethod;
  switch (pm.kind) {
    case 'card':
      put(p, 'PMT_NUMB', pm.number);
      put(p, 'PMT_EXPIRY', pm.expiry);
      put(p, 'PMT_KEY', pm.cvv);
      break;
    case 'token':
      // The token stands in for the PAN only — the transaction service still
      // requires the expiry (and CVV where the processor asks for it).
      put(p, 'TOKEN_GUID', pm.guid);
      put(p, 'PMT_EXPIRY', pm.expiry);
      put(p, 'PMT_KEY', pm.cvv);
      break;
    case 'savedCard':
      put(p, 'PMT_ID', pm.pmtId);
      put(p, 'PMT_ID_XTL', pm.pmtIdXtl);
      put(p, 'CUST_ID', pm.custId);
      break;
  }

  // --- line items: the SDK owns the 1-based wire indexing --------------
  let currency: string | undefined = req.amount?.currency;
  req.lineItems.forEach((li, i) => {
    const n = i + 1;
    if (li.count > 10) {
      throw new ValidationError(
        `line item ${n}: count must be <= 10 (spec §4.4)`,
        { refField: `LI_COUNT_${n}` }
      );
    }
    put(p, `LI_PROD_ID_${n}`, li.productId);
    put(p, `LI_PROD_ID_XTL_${n}`, li.xtlProductId);
    put(p, `LI_COUNT_${n}`, li.count);
    put(p, `LI_VALUE_${n}`, li.value.toWire());
    put(p, `LI_TYPE_${n}`, li.type);
    if (!currency) currency = li.value.currency;
    else if (li.value.currency !== currency) {
      throw new ValidationError(
        `line item ${n} currency ${li.value.currency} does not match ${currency} — ` +
          'a single transaction cannot mix currencies'
      );
    }
  });
  put(p, 'REQUEST_CURRENCY', currency);

  // --- customer / addresses -------------------------------------------
  const c = req.customer;
  if (c) {
    put(p, 'CUST_FNAME', c.firstName);
    put(p, 'CUST_LNAME', c.lastName);
    put(p, 'CUST_EMAIL', c.email);
    put(p, 'CUST_PHONE', c.phone);
    put(p, 'CUST_LOGIN', c.login);
    put(p, 'CUST_PASSWORD', c.password);
    put(p, 'CUST_BIRTHDAY', c.birthday);
    put(p, 'CUST_DLN', c.dln);
    put(p, 'CUST_DLN_STATE', c.dlnState);
    put(p, 'CUST_SSN_L4', c.ssnLast4);
    put(p, 'CUST_BRCPFCNPJ', c.brCpfCnpj);
    put(p, 'XTL_IP', c.ip);
    put(p, 'USER_AGENT_XTL', c.userAgent);
  }
  applyAddress(p, 'BILL', req.billingAddress);
  applyAddress(p, 'SHIP', req.shippingAddress);

  // --- descriptor ------------------------------------------------------
  if (req.descriptor) {
    put(p, 'PMT_DESCRIPTOR', req.descriptor.name);
    put(p, 'PMT_DESCRIPTOR_PHONE', req.descriptor.phone);
    put(p, 'PMT_DESCRIPTOR_CITY', req.descriptor.city);
  }

  // --- risk ------------------------------------------------------------
  if (req.risk) {
    if (req.risk.avs) put(p, 'CHKAVS', AVS_WIRE[req.risk.avs]);
    put(p, 'AVS_MATCH_SET', req.risk.avsMatchSet);
    if (req.risk.cvv) put(p, 'CHKCVV', AVS_WIRE[req.risk.cvv]);
    put(p, 'CVV_MATCH_SET', req.risk.cvvMatchSet);
    if (req.risk.timeoutVoid) {
      const s = req.risk.timeoutVoid.seconds;
      if (s < 30 || s > 600) {
        throw new ValidationError(
          `risk.timeoutVoid.seconds must be between 30 and 600, got ${s}`,
          { refField: 'REQUEST_MAX_WAIT' }
        );
      }
      put(p, 'REQUEST_MAX_WAIT', s);
    }
  }

  // --- partial auth ----------------------------------------------------
  if (req.partialAuth?.enabled) {
    put(p, 'PARTIAL_AUTH', '1');
    if (req.partialAuth.minimumAmount) {
      put(p, 'PARTIAL_AUTH_MIN', req.partialAuth.minimumAmount.toWire());
    }
  }

  // --- idempotency (defaults to retry-safe) ----------------------------
  if (req.idempotency) {
    put(p, 'XTL_ORDER_ID', req.idempotency.xtlOrderId);
    const mode = req.idempotency.mode ?? 'RETURN_ORIGINAL';
    put(p, 'UNIQUE_XTL_ORDER_ID', IDEMPOTENCY_WIRE[mode]);
  }

  // --- recurring / COF -------------------------------------------------
  if (req.recurring) {
    const r = req.recurring;
    // NOTE: the wire field is misspelled "INITATOR". Normalized here so the
    // partner never sees it.
    if (r.initiator) put(p, 'REQUEST_INITATOR', r.initiator);
    if (r.rebill) {
      put(p, 'REQUEST_REBILL', { NONE: '0', REBILL: '1', START_SUBSCRIPTION: '2' }[r.rebill]);
    }
    if (r.rebillType) {
      put(p, 'TRANS_REBILL_TYPE', { NONE: '0', TRIAL: '1', INITIAL: '2', REBILL: '3' }[r.rebillType]);
    }
    put(p, 'INSTALLMENT', r.installment);
    put(p, 'CARD_ON_FILE', r.cardOnFile);
    put(p, 'MBSHP_ID_XTL', r.membershipXtlId);
    put(p, 'TRIAL_CONSENT', r.trialConsent);
    put(p, 'RECEIPT', r.receipt);
  }

  // --- fees / affiliate / metadata -------------------------------------
  if (req.fees?.tax) {
    put(p, 'TAX_AMT', req.fees.tax.amount.toWire());
    put(p, 'TAX_EXEMPT', req.fees.tax.exempt);
  }
  if (req.fees?.convenienceFee) {
    put(p, 'CONVENIENCE_FEE', req.fees.convenienceFee.toWire());
  }
  put(p, 'REQUEST_AFF_ID', req.affiliate?.affId);
  put(p, 'REQUEST_AFF_ID_SUB', req.affiliate?.subAffId);
  if (req.metadata) {
    put(p, 'TPPE_ID', req.metadata.tppeId);
    put(p, 'PROC_UDF01', req.metadata.procUdf1);
    put(p, 'PROC_UDF02', req.metadata.procUdf2);
    for (const [k, v] of Object.entries(req.metadata.udf ?? {})) {
      const n = String(k).padStart(2, '0');
      put(p, `XTL_UDF${n}`, v);
    }
  }

  // --- 3DS browser data (all three or none) ----------------------------
  if (req.browser) {
    put(p, 'P3DS_BROWSER_LANGUAGE', req.browser.language);
    put(p, 'USER_AGENT_XTL', req.browser.userAgent);
    put(p, 'P3DS_BROWSER_HEADER', req.browser.header);
  }

  put(p, 'MERCH_ACCT_ID', req.merchAcctId);
  return p;
}
