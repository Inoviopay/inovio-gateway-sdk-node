/**
 * InovioClient — the v1 card-core surface (object model §3.1).
 *
 * Partners call `client.sale()`, never `REQUEST_ACTION=CCAUTHCAP`.
 */
import { REQUEST_ACTION, SPEC_API_VERSION, TRANSACTION_STATUS } from './enums/generated.js';
import {
  API_RESPONSE_CODES,
} from './enums/generated.js';
import {
  AuthenticationError,
  ConfigurationError,
  RateLimitError,
  ValidationError,
} from './errors/index.js';
import type { Card, PaymentMethod, Token } from './model/payment-method.js';
import { PaymentMethods } from './model/payment-method.js';
import type { Money } from './model/money.js';
import { buildTransactionParams, type AuthorizeRequest, type CreditRequest, type OrderUpdate, type SaleRequest } from './request/index.js';
import type { LineItemRef, OrderRef, XtlOrderId } from './refs/index.js';
import { toOrderStatus, toTransactionResult } from './result/mapper.js';
import type { HealthResult, OrderStatus, TransactionResult } from './result/index.js';
import {
  ENDPOINTS,
  FetchHttpClient,
  send,
  type Environment,
  type HttpClient,
} from './transport/index.js';

export interface Credentials {
  reqUsername: string;
  reqPassword: string;
  siteId: string;
  merchAcctId?: string;
}

export interface ClientOptions {
  environment?: Environment;
  /** Overrides the environment endpoint entirely (local stack, proxy). */
  endpoint?: string;
  apiVersion?: string;
  /** Default 120_000 — matches the gateway's own window. */
  timeoutMs?: number;
  httpClient?: HttpClient;
  /** Token service endpoint (spec §4.8), if different from the default. */
  tokenEndpoint?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export class InovioClient {
  private readonly creds: Credentials;
  private readonly endpoint: string;
  private readonly tokenEndpoint: string;
  private readonly apiVersion: string;
  private readonly timeoutMs: number;
  private readonly httpClient: HttpClient;

  constructor(creds: Credentials, options: ClientOptions = {}) {
    if (!creds?.reqUsername || !creds?.reqPassword || !creds?.siteId) {
      throw new ValidationError(
        'credentials require reqUsername, reqPassword and siteId'
      );
    }
    this.creds = creds;
    const env: Environment = options.environment ?? 'SANDBOX';
    this.endpoint = options.endpoint ?? ENDPOINTS[env];
    this.tokenEndpoint =
      options.tokenEndpoint ?? this.endpoint.replace(/pmt_service\.cfm$/, 'token_service.cfm');
    this.apiVersion = options.apiVersion ?? SPEC_API_VERSION;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.httpClient = options.httpClient ?? new FetchHttpClient();
  }

  /* ------------------------------------------------------------------ */

  private authParams(action: string): Record<string, string> {
    const p: Record<string, string> = {
      REQ_USERNAME: this.creds.reqUsername,
      REQ_PASSWORD: this.creds.reqPassword,
      SITE_ID: this.creds.siteId,
      REQUEST_ACTION: action,
      REQUEST_API_VERSION: this.apiVersion,
      REQUEST_RESPONSE_FORMAT: 'JSON',
    };
    if (this.creds.merchAcctId) p.MERCH_ACCT_ID = this.creds.merchAcctId;
    return p;
  }

  /**
   * Raise for API-tier failures only. A DECLINE IS NOT AN ERROR — it returns
   * normally as TransactionResult{status:'DECLINED'} (Q1).
   */
  private raiseIfApiError(r: Record<string, string>): void {
    const code = Number(r.API_RESPONSE);
    if (!Number.isFinite(code)) return;
    const info = API_RESPONSE_CODES[code];
    // The approval band for the API tier is "no error reported".
    if (!info || code === 0) return;
    // A successful transaction still carries an API_RESPONSE; only treat known
    // error codes as failures.
    const message = `${info.description}${info.recommendation ? ` — ${info.recommendation}` : ''}`;
    switch (info.mapsToException) {
      case 'RateLimitError':
      case 'RateLimitException':
        throw new RateLimitError(message, r);
      case 'AuthenticationException':
        throw new AuthenticationError(message, code, r);
      case 'ValidationException':
        throw new ValidationError(message, { code, refField: r.REF_FIELD, raw: r });
      case 'ConfigurationException':
        throw new ConfigurationError(message, code, r);
      default:
        return;
    }
  }

  private async call(
    action: string,
    params: Record<string, string>,
    idempotencyKey?: string
  ): Promise<Record<string, string>> {
    const merged = { ...this.authParams(action), ...params };
    const raw = await send(
      { endpoint: this.endpoint, httpClient: this.httpClient, timeoutMs: this.timeoutMs },
      merged,
      idempotencyKey
    );
    this.raiseIfApiError(raw);
    return raw;
  }

  private async transact(
    action: string,
    req: SaleRequest | AuthorizeRequest,
    extra: Record<string, string> = {}
  ): Promise<TransactionResult> {
    const params = { ...buildTransactionParams(req), ...extra };
    const raw = await this.call(action, params, req.idempotency?.xtlOrderId);
    return toTransactionResult(raw);
  }

  /* ---------------------------- operations -------------------------- */

  /** CCAUTHCAP — authorize and capture in one step. */
  sale(req: SaleRequest): Promise<TransactionResult> {
    return this.transact(REQUEST_ACTION.CCAUTHCAP, req);
  }

  /** CCAUTHORIZE — authorization only; capture later. */
  authorize(req: AuthorizeRequest): Promise<TransactionResult> {
    return this.transact(REQUEST_ACTION.CCAUTHORIZE, req);
  }

  /** CCCAPTURE — capture a previous authorization. Partial-capable. */
  async capture(order: OrderRef, amount?: Money): Promise<TransactionResult> {
    const p: Record<string, string> = { REQUEST_REF_PO_ID: order.poId };
    if (amount) {
      p.LI_VALUE_1 = amount.toWire();
      p.LI_COUNT_1 = '1';
      p.REQUEST_CURRENCY = amount.currency;
    }
    return toTransactionResult(await this.call(REQUEST_ACTION.CCCAPTURE, p));
  }

  /** CCCAPTURE against a single line item. */
  async captureLineItem(item: LineItemRef, amount?: Money): Promise<TransactionResult> {
    const p: Record<string, string> = { REQUEST_REF_PO_LI_ID: item.poLiId };
    if (amount) {
      p.LI_VALUE_1 = amount.toWire();
      p.LI_COUNT_1 = '1';
      p.REQUEST_CURRENCY = amount.currency;
    }
    return toTransactionResult(await this.call(REQUEST_ACTION.CCCAPTURE, p));
  }

  /** CCREVERSE — void the original authorization. */
  async reverse(order: OrderRef): Promise<TransactionResult> {
    return toTransactionResult(
      await this.call(REQUEST_ACTION.CCREVERSE, { REQUEST_REF_PO_ID: order.poId })
    );
  }

  /** CCREVERSECAP — void a CCCAPTURE (not the original auth). */
  async reverseCapture(order: OrderRef): Promise<TransactionResult> {
    return toTransactionResult(
      await this.call(REQUEST_ACTION.CCREVERSECAP, { REQUEST_REF_PO_ID: order.poId })
    );
  }

  /** CCCREDIT — refund against an existing order. Partial-capable. */
  async refund(order: OrderRef, amount?: Money): Promise<TransactionResult> {
    const p: Record<string, string> = { REQUEST_REF_PO_ID: order.poId };
    if (amount) {
      p.LI_VALUE_1 = amount.toWire();
      p.LI_COUNT_1 = '1';
      p.REQUEST_CURRENCY = amount.currency;
    }
    return toTransactionResult(await this.call(REQUEST_ACTION.CCCREDIT, p));
  }

  /** CCCREDIT + FORCE_CREDIT — a credit with no referenced original. */
  forceCredit(req: CreditRequest): Promise<TransactionResult> {
    return this.transact(REQUEST_ACTION.CCCREDIT, req, { FORCE_CREDIT: '1' });
  }

  /**
   * CCSTATUS — the reconciliation primitive AND the unknown-state recovery path.
   *
   * Returns order-level net position (captured/refunded/outstanding) derived
   * from every leg sharing the PO_ID. For any order with more than one leg this
   * is the only correct source of net figures.
   */
  async status(ref: OrderRef | XtlOrderId): Promise<OrderStatus> {
    const p: Record<string, string> =
      'poId' in ref
        ? { REQUEST_REF_PO_ID: ref.poId }
        : { REQUEST_REF_PO_ID_XTL: ref.value };
    const raw = await this.call(REQUEST_ACTION.CCSTATUS, p);
    const legs = extractLegs(raw).map(toTransactionResult);
    return toOrderStatus(raw, legs.length ? legs : [toTransactionResult(raw)]);
  }

  /** CCTRANSUPDATE — attach receipts to an existing order (Appendix G/J). */
  async updateOrder(order: OrderRef, update: OrderUpdate): Promise<TransactionResult> {
    const p: Record<string, string> = { REQUEST_REF_PO_ID: order.poId };
    if (update.receipt) p.RECEIPT = update.receipt;
    for (const [k, v] of Object.entries(update.metadata?.udf ?? {})) {
      p[`XTL_UDF${String(k).padStart(2, '0')}`] = v;
    }
    return toTransactionResult(await this.call(REQUEST_ACTION.CCTRANSUPDATE, p));
  }

  /**
   * Ephemeral tokenization (spec §4.8) — exchanges a PAN for a single-use
   * TOKEN_GUID so the PAN does not have to be re-sent.
   *
   * NOTE: this server-side call still touches the PAN and therefore keeps the
   * caller in PCI scope. The lower-scope path is the browser Hosted Fields
   * client (W-client), which tokenizes without the PAN reaching your server.
   */
  async tokenize(card: Card): Promise<Token> {
    const p = {
      ...this.authParams('TOKENIZE'),
      PMT_NUMB: card.number,
      PMT_EXPIRY: card.expiry,
      ...(card.cvv ? { PMT_KEY: card.cvv } : {}),
    };
    const raw = await send(
      {
        endpoint: this.tokenEndpoint,
        httpClient: this.httpClient,
        timeoutMs: this.timeoutMs,
      },
      p
    );
    this.raiseIfApiError(raw);
    const guid = raw.TOKEN_GUID ?? raw.TOKEN ?? raw.TOKEN_ID;
    if (!guid) {
      throw new ConfigurationError(
        'token service did not return a TOKEN_GUID',
        undefined,
        raw
      );
    }
    return PaymentMethods.token(guid);
  }

  /** TESTAUTH — verify credentials. */
  async testAuth(): Promise<HealthResult> {
    const raw = await this.call(REQUEST_ACTION.TESTAUTH, {});
    return this.toHealth(raw);
  }

  /** TESTGW — verify gateway availability. */
  async testAvailability(): Promise<HealthResult> {
    const raw = await this.call(REQUEST_ACTION.TESTGW, {});
    return this.toHealth(raw);
  }

  private toHealth(raw: Record<string, string>): HealthResult {
    const result = toTransactionResult(raw);
    return {
      ok:
        result.status === TRANSACTION_STATUS.APPROVED ||
        Number(raw.SERVICE_RESPONSE) === 100 ||
        Number(raw.SERVICE_RESPONSE) === 101,
      action: raw.REQUEST_ACTION ?? '',
      outcome: result.outcome,
      raw: result.raw,
    };
  }
}

/**
 * CCSTATUS returns multiple transactions. The gateway flattens them with
 * indexed keys; split them back into per-leg field maps.
 */
function extractLegs(raw: Record<string, string>): Record<string, string>[] {
  const indexed = new Map<number, Record<string, string>>();
  for (const [k, v] of Object.entries(raw)) {
    const m = /^(.*?)_(\d+)$/.exec(k);
    if (!m) continue;
    const [, base, idxStr] = m;
    // only treat transaction-level fields as legs
    if (!/^(TRANS_|REQUEST_ACTION|SERVICE_|PROCESSOR_|API_|AVS_|CVV_|PO_ID)/.test(base)) continue;
    const idx = Number(idxStr);
    if (!indexed.has(idx)) indexed.set(idx, {});
    indexed.get(idx)![base] = v;
  }
  // Order-level fields apply to every leg — notably CURR_CODE_ALPHA, without
  // which a leg has no currency and its amount cannot be constructed.
  const inherited: Record<string, string> = {};
  for (const k of ['PO_ID', 'XTL_ORDER_ID', 'CURR_CODE_ALPHA', 'MERCH_ACCT_ID']) {
    if (raw[k] !== undefined) inherited[k] = raw[k];
  }
  return [...indexed.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, fields]) => ({ ...inherited, ...fields }));
}
