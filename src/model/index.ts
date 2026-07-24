/** Shared request building blocks (object model §3.3). */
import type { Money } from './money.js';

export { Money } from './money.js';
export * from './payment-method.js';

/** CUST_* + XTL_IP */
export interface Customer {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  login?: string;
  password?: string;
  /** MM-DD-YYYY per spec §4.2 */
  birthday?: string;
  dln?: string;
  dlnState?: string;
  ssnLast4?: string;
  /** Brazil CPF/CNPJ — presence activates Credilink scrubbing */
  brCpfCnpj?: string;
  ip?: string;
  userAgent?: string;
}

/** BILL_ADDR_* / SHIP_ADDR_* */
export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  /** ISO-2 */
  country?: string;
  district?: string;
}

/** LI_*_n — the SDK owns the 1-based wire indexing. */
export interface LineItem {
  productId: string;
  xtlProductId?: string;
  /** LI_COUNT_n, max 10 per spec §4.4 */
  count: number;
  value: Money;
  type?: string;
}

/** PMT_DESCRIPTOR* */
export interface Descriptor {
  name: string;
  phone?: string;
  city?: string;
}

export type AvsMode = 'on' | 'off' | 'ignore' | 'conditional';
export type CvvMode = 'on' | 'off' | 'ignore' | 'conditional';

/** CHKAVS / CHKCVV / REQUEST_MAX_WAIT */
export interface RiskOptions {
  avs?: AvsMode;
  avsMatchSet?: string;
  cvv?: CvvMode;
  cvvMatchSet?: string;
  /**
   * Timeout Void (spec §14.3) — opt-in, NOT defaulted on (Q6). If the gateway
   * cannot answer within `seconds`, it voids rather than leaving the state
   * unknown. Valid range 30..600.
   */
  timeoutVoid?: { seconds: number };
}

/** PARTIAL_AUTH / PARTIAL_AUTH_MIN */
export interface PartialAuth {
  enabled: boolean;
  minimumAmount?: Money;
}

/**
 * Idempotency (Q6). `xtlOrderId` is the merchant's own order id and doubles as
 * the idempotency key. Mode maps to UNIQUE_XTL_ORDER_ID:
 *   OFF (0) — no uniqueness check
 *   DECLINE_DUP (1) — a duplicate is declined
 *   RETURN_ORIGINAL (2) — a duplicate returns the original result (retry-safe)
 * Defaults to RETURN_ORIGINAL when xtlOrderId is set.
 */
export type IdempotencyMode = 'OFF' | 'DECLINE_DUP' | 'RETURN_ORIGINAL';

export interface Idempotency {
  xtlOrderId: string;
  mode?: IdempotencyMode;
}

export type Initiator = 'CIT' | 'MIT';
export type RebillMode = 'NONE' | 'REBILL' | 'START_SUBSCRIPTION';
export type RebillType = 'NONE' | 'TRIAL' | 'INITIAL' | 'REBILL';

/** Card-on-file / recurring compliance flags (Appendices G/J/K). Phase v1.x. */
export interface Recurring {
  initiator?: Initiator;
  rebill?: RebillMode;
  rebillType?: RebillType;
  installment?: boolean;
  cardOnFile?: boolean;
  membershipXtlId?: string;
  trialConsent?: boolean;
  receipt?: string;
}

/** TAX_AMT / TAX_EXEMPT / CONVENIENCE_FEE */
export interface Fees {
  tax?: { amount: Money; exempt?: boolean };
  convenienceFee?: Money;
}

/** REQUEST_AFF_ID / REQUEST_AFF_ID_SUB */
export interface Affiliate {
  affId?: string;
  subAffId?: string;
}

/** XTL_UDF01..20, TPPE_ID, PROC_UDF01/02 */
export interface Metadata {
  udf?: Record<string, string>;
  tppeId?: string;
  procUdf1?: string;
  procUdf2?: string;
}

/** 3DS browser data — the gateway silently disables 3DS if any is missing. */
export interface BrowserData {
  language: string;
  userAgent: string;
  header: string;
}
