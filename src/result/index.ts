/**
 * TransactionResult and OrderStatus (object model §3.5, §3.6).
 *
 * Two deliberate shapes here, both load-bearing:
 *
 * 1. NO derived `approved`/`declined` booleans. `status` is the only way to ask
 *    about outcome. Booleans invite `if (approved) {...} else {...}`, which
 *    silently treats PENDING as failure — exactly the card-shaped mental model
 *    the 5-state lifecycle exists to prevent.
 * 2. Reference keys are FLAT, not nested in a `refs` bag. They are the most
 *    touched fields on the result (`capture(result.orderRef, ...)`), so they do
 *    not sit one level down inside a container named for an implementation
 *    concern.
 */
import type { Money } from '../model/money.js';
import type {
  AvsCodeInfo,
  CvvCodeInfo,
  TransactionStatus,
} from '../enums/generated.js';
import type {
  BatchId,
  CustomerRef,
  LineItemRef,
  MembershipRef,
  OrderRef,
  ReqId,
  SavedCardRef,
  TransactionId,
  XtlOrderId,
} from '../refs/index.js';

/** One of the four layered response tiers (§1.3). */
export interface OutcomeTier {
  code?: number;
  advice?: string;
}

export interface ApiOutcomeTier extends OutcomeTier {
  /** Names the offending field on validation failures. */
  refField?: string;
}

/**
 * The four independent outcome tiers, outermost -> innermost.
 * `service` carries the decline taxonomy that dunning logic branches on.
 */
export interface Outcome {
  api: ApiOutcomeTier;
  service: OutcomeTier;
  processor: OutcomeTier;
  industry: OutcomeTier;
}

/** Service-tier classification, from the generated spec enums. */
export interface ServiceClassification {
  retryable: boolean;
  stopRecurring: boolean;
  terminal: boolean;
  approval: boolean;
}

export interface CardInfo {
  brand?: string;
  detail?: string;
  type?: string;
  class?: string;
  country?: string;
  bank?: string;
  prepaid?: boolean;
  balance?: string;
  last4?: string;
  /** TRANS_NTOKEN_USED: 0 | 1 | 2 */
  networkTokenUsed?: number;
  /** Automatic Account Updater (Appendix I) */
  accountUpdater?: {
    description?: string;
    date?: string;
    newExpiry?: string;
    newLast4?: string;
  };
}

/** What must happen next when a transaction is PENDING (§4.1). */
export type NextAction =
  | { kind: 'redirect'; url: string }
  | { kind: 'displayVoucher'; url?: string; barcode?: string }
  | { kind: 'displayQr'; url?: string; token?: string }
  | {
      kind: 'threeDSChallenge';
      redirectUrl?: string;
      jwt?: string;
      procTransId?: string;
      pareq?: string;
    }
  | { kind: 'awaitSettlement' };

export interface TransactionResult {
  /** APPROVED | DECLINED | PENDING | RUNNING | FAILED */
  readonly status: TransactionStatus;
  /** PENDING || RUNNING — a genuine grouping, not an alias for status. */
  readonly settling: boolean;
  /** Echoed REQUEST_ACTION. */
  readonly action: string;

  /* --- identity produced by this call (flat by design) --- */
  readonly orderRef?: OrderRef;
  readonly xtlOrderRef?: XtlOrderId;
  readonly transactionId?: TransactionId;
  readonly requestId?: ReqId;
  readonly batchId?: BatchId;
  readonly customerRef?: CustomerRef;
  readonly savedCardRef?: SavedCardRef;
  readonly membershipRef?: MembershipRef;
  readonly lineItemRefs: readonly LineItemRef[];

  readonly amount?: Money;

  /**
   * The FACT of settlement (TRANS_SETTLED). Written 0 at auth and flipped later
   * by batch, except for settle-on-auth processors — so this is usually false
   * at response time and is NOT a failure signal.
   */
  readonly settled: boolean;

  /**
   * Present ONLY when real currency conversion occurred (exchangeRate != null).
   * The wire's "settled" amount fields are a copy of the auth amount on
   * domestic transactions, so a block that was always present would mean
   * nothing. Named for what it reports: conversion, not settlement.
   */
  readonly conversion?: {
    amount: Money;
    exchangeRate: string;
  };

  readonly outcome: Outcome;
  /** Derived from the service code via the generated spec enums. */
  readonly serviceClassification?: ServiceClassification;
  readonly avs?: AvsCodeInfo & { raw: string };
  readonly cvv?: CvvCodeInfo & { raw: string };
  readonly card?: CardInfo;
  readonly nextAction?: NextAction;

  /** Escape hatch — every returned field, verbatim. */
  readonly raw: Readonly<Record<string, string>>;
}

/**
 * OrderStatus — the order is the aggregation root (§3.6).
 *
 * Partial capture, multi-capture, refund and void are SEPARATE transaction rows
 * sharing a PO_ID, not modifications of the original. So net position is an
 * order-level question. The SDK derives these figures the same way BATCH_PKG
 * does (sibling sum keyed on PO_ID) — partners must not be asked to sum legs
 * themselves.
 *
 * This makes `status()` the reconciliation primitive, not just the
 * timeout-recovery primitive.
 */
export interface OrderStatus {
  readonly ref: OrderRef;
  readonly xtlRef?: XtlOrderId;
  /** Every leg against this PO_ID: auth, captures, refunds, voids. */
  readonly transactions: readonly TransactionResult[];
  readonly authorized?: Money;
  readonly captured?: Money;
  readonly refunded?: Money;
  readonly net?: Money;
  readonly outstanding?: Money;
  readonly settled: boolean;
  readonly raw: Readonly<Record<string, string>>;
}

export interface HealthResult {
  readonly ok: boolean;
  readonly action: string;
  readonly outcome: Outcome;
  readonly raw: Readonly<Record<string, string>>;
}
