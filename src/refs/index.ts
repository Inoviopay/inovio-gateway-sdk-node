/**
 * Typed identity wrappers (object model §3.4).
 *
 * There is no single transaction handle in the gateway — different follow-ups
 * consume different keys (§1.4). These branded types make it impossible to hand
 * `capture()` a customer id by mistake; the compiler rejects it.
 */

declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

/** Gateway order id (PO_ID) -> REQUEST_REF_PO_ID */
export type OrderRef = Brand<{ readonly poId: string }, 'OrderRef'>;
/** Merchant order id (XTL_ORDER_ID) -> REQUEST_REF_PO_ID_XTL; also the idempotency key */
export type XtlOrderId = Brand<{ readonly value: string }, 'XtlOrderId'>;
/** Gateway line-item id (PO_LI_ID_n) -> REQUEST_REF_PO_LI_ID */
export type LineItemRef = Brand<{ readonly poLiId: string }, 'LineItemRef'>;
/** Single transaction (TRANS_ID) — reporting/read */
export type TransactionId = Brand<{ readonly value: string }, 'TransactionId'>;
/** Request correlation id (REQ_ID) — support tickets */
export type ReqId = Brand<{ readonly value: string }, 'ReqId'>;
/** Settlement batch (BATCH_ID) */
export type BatchId = Brand<{ readonly value: string }, 'BatchId'>;
/** Customer (CUST_ID / XTL_CUST_ID) */
export type CustomerRef = Brand<
  { readonly custId?: string; readonly xtlCustId?: string },
  'CustomerRef'
>;
/** Saved card (PMT_ID / PMT_ID_XTL) */
export type SavedCardRef = Brand<
  { readonly pmtId?: string; readonly pmtIdXtl?: string },
  'SavedCardRef'
>;
/** Membership (MBSHP_ID / MBSHP_ID_XTL) -> REQUEST_REF_MBSHP_ID */
export type MembershipRef = Brand<
  { readonly mbshpId?: string; readonly mbshpIdXtl?: string },
  'MembershipRef'
>;

const make = <T>(v: unknown): T => v as T;

export const Refs = {
  order: (poId: string): OrderRef => {
    if (!poId) throw new TypeError('Refs.order: poId is required');
    return make<OrderRef>({ poId });
  },
  xtlOrder: (value: string): XtlOrderId => {
    if (!value) throw new TypeError('Refs.xtlOrder: value is required');
    return make<XtlOrderId>({ value });
  },
  lineItem: (poLiId: string): LineItemRef => {
    if (!poLiId) throw new TypeError('Refs.lineItem: poLiId is required');
    return make<LineItemRef>({ poLiId });
  },
  transaction: (value: string): TransactionId => make<TransactionId>({ value }),
  req: (value: string): ReqId => make<ReqId>({ value }),
  batch: (value: string): BatchId => make<BatchId>({ value }),
  customer: (r: { custId?: string; xtlCustId?: string }): CustomerRef =>
    make<CustomerRef>(r),
  savedCard: (r: { pmtId?: string; pmtIdXtl?: string }): SavedCardRef =>
    make<SavedCardRef>(r),
  membership: (r: { mbshpId?: string; mbshpIdXtl?: string }): MembershipRef =>
    make<MembershipRef>(r),
} as const;
