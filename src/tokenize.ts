/**
 * Ephemeral tokenization (spec §4.8).
 *
 * This is NOT the transaction service: a different endpoint
 * (`token_service.cfm`), a different request shape, and HMAC header auth
 * instead of username/password. Exchanging a PAN here yields a single-use
 * `TOKEN_GUID` that replaces `PMT_NUMB` on a later sale/authorize.
 *
 * ## Signature construction
 *
 * ```
 * X-SIGNATURE = hex( HMAC_SHA256( siteKey, timestamp + uniqueId + siteId ) )
 * X-TIMESTAMP = YYYYMMDDHHMMSS, UTC, valid for 300 seconds
 * ```
 *
 * ⚠️ The v4.14 PDF is self-contradictory here. Its §4.8.1.2 note claims the
 * message also includes `card_pan`, and the worked example in the document is
 * consistent with that. The gateway does NOT do this — `CRPT.TOKEN_PKG`
 * validates `hmac_sha256(utc || unique_id || site_id, site_key)`. Signing with
 * the PAN included yields error 121 "Get CCtoken GUID signature match fail".
 * Verified against the live T1 token service; the implementation below follows
 * the gateway, not the document.
 *
 * The site key is provisioned per merchant site and is NOT the gateway
 * password — obtain it from Inovio support ("contact your gateway support
 * representative to obtain your key", §4.8).
 */
import { createHmac, randomBytes } from 'node:crypto';
import { ConfigurationError, ValidationError } from './errors/index.js';
import type { Card, Token } from './model/payment-method.js';
import { PaymentMethods } from './model/payment-method.js';
import { send, type HttpClient } from './transport/index.js';

/** BIN metadata the token service returns alongside the token. */
export interface TokenizedCardInfo {
  brand?: string;
  type?: string;
  bank?: string;
  country?: string;
  accountFundSource?: string;
  cardClass?: string;
}

export interface TokenizeResult {
  token: Token;
  /** Gateway-side IP recorded for the token request. */
  tokenIp?: string;
  /** Token service request id — quote this to support. */
  tokenReqId?: string;
  card: TokenizedCardInfo;
  raw: Readonly<Record<string, string>>;
}

/** UTC timestamp in the token service's YYYYMMDDHHMMSS format. */
export function tokenTimestamp(now: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`
  );
}

/**
 * Build the request signature.
 *
 * Exported so a caller can verify their site key independently of a live call.
 */
export function signTokenRequest(
  siteKey: string,
  timestamp: string,
  uniqueId: string,
  siteId: string
): string {
  return createHmac('sha256', siteKey)
    .update(`${timestamp}${uniqueId}${siteId}`)
    .digest('hex');
}

/**
 * Verify the response signature the token service returns.
 *
 * Per `CRPT.TOKEN_PKG`, the gateway signs
 * `timestamp + tokenReqId + rawResponseBody` with the same site key. The body
 * must be compared exactly as received (trailing whitespace trimmed).
 */
export function verifyTokenResponse(
  siteKey: string,
  timestamp: string,
  tokenReqId: string,
  rawBody: string,
  signature: string
): boolean {
  const expected = createHmac('sha256', siteKey)
    .update(`${timestamp}${tokenReqId}${rawBody.trim()}`)
    .digest('hex');
  return expected.toLowerCase() === (signature ?? '').toLowerCase();
}

const blankToUndefined = (v?: string): string | undefined =>
  v === undefined || v.trim() === '' ? undefined : v;

export interface TokenizeOptions {
  endpoint: string;
  httpClient: HttpClient;
  timeoutMs: number;
  siteId: string;
  /** HMAC secret provisioned per site by Inovio support. */
  siteKey: string;
  apiVersion: string;
  /** Override the generated id (max 32 chars) for correlation. */
  uniqueId?: string;
}

export async function tokenizeCard(
  card: Card,
  opts: TokenizeOptions
): Promise<TokenizeResult> {
  if (!opts.siteKey) {
    throw new ValidationError(
      'tokenize requires a siteKey — the per-site HMAC secret from Inovio support. ' +
        'It is NOT your gateway password.'
    );
  }
  const uniqueId = opts.uniqueId ?? randomBytes(16).toString('hex');
  if (uniqueId.length > 32) {
    throw new ValidationError('tokenize: uniqueId must be at most 32 characters');
  }
  const timestamp = tokenTimestamp();

  const raw = await send(
    {
      endpoint: opts.endpoint,
      httpClient: opts.httpClient,
      timeoutMs: opts.timeoutMs,
      headers: {
        'X-SIGNATURE': signTokenRequest(opts.siteKey, timestamp, uniqueId, opts.siteId),
        'X-TIMESTAMP': timestamp,
      },
    },
    {
      // The token service takes CARD_PAN — not PMT_NUMB, and no expiry or CVV.
      CARD_PAN: card.number,
      SITE_ID: opts.siteId,
      UNIQUE_ID: uniqueId,
      REQUEST_API_VERSION: opts.apiVersion,
      REQUEST_RESPONSE_FORMAT: 'JSON',
    }
  );

  const guid = raw.TOKEN_GUID;
  if (!guid) {
    const code = raw.ERROR_CODE;
    const message = raw.ERROR_MESSAGE ?? 'token service did not return a TOKEN_GUID';
    throw new ConfigurationError(
      code === '121'
        ? `${message} (signature mismatch — check the site key, and that the ` +
          `signed message is timestamp+uniqueId+siteId with NO card_pan)`
        : message,
      undefined,
      raw
    );
  }

  return {
    // Carry expiry/cvv forward: the token replaces the PAN, but the
    // transaction service still needs them (§4.8.2).
    token: PaymentMethods.token(guid, card.expiry, card.cvv),
    tokenIp: raw.TOKEN_IP,
    tokenReqId: raw.TOKEN_REQID,
    // BIN metadata is best-effort: the token service returns these keys with
    // EMPTY values when the BIN is not in its lookup table (observed on live
    // T1 for some test PANs). Normalize blanks to undefined so callers can
    // check presence rather than compare against "".
    card: {
      brand: blankToUndefined(raw.CARD_BRAND_NAME),
      type: blankToUndefined(raw.CARD_TYPE),
      bank: blankToUndefined(raw.CARD_BANK),
      country: blankToUndefined(raw.CARD_COUNTRY),
      accountFundSource: blankToUndefined(raw.CARD_ACCOUNT_FUND_SOURCE),
      cardClass: blankToUndefined(raw.CARD_CLASS),
    },
    raw,
  };
}
