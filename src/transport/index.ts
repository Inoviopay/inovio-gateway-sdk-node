/**
 * Transport — form-encoded POST to pmt_service.cfm, response normalization.
 *
 * Wire quirks are normalized ONCE, here, and never leak to the partner
 * (object model §2 principle 8):
 *   - responses are case-insensitive        -> keys upper-cased
 *   - REQUEST_INITATOR is misspelled in the wire protocol
 *   - XTL_ORDER_ID / XTL_PO_ID name the same thing
 *   - PMT_L4 / PMT_LAST4 name the same thing
 */
import { TimeoutError, TransportError } from '../errors/index.js';

export type Environment = 'SANDBOX' | 'PRODUCTION';

/** Spec §2.1. Sandbox host is configurable — confirm before non-local use. */
export const ENDPOINTS: Record<Environment, string> = {
  PRODUCTION: 'https://api.inoviopay.com/payment/pmt_service.cfm',
  SANDBOX: 'https://api-uap.inoviopay.com/payment/pmt_service.cfm',
};

export interface HttpResponse {
  status: number;
  body: string;
}

/** Injectable so hosts can supply their own client (and tests can mock). */
export interface HttpClient {
  post(
    url: string,
    body: string,
    headers: Record<string, string>,
    timeoutMs: number
  ): Promise<HttpResponse>;
}

export class FetchHttpClient implements HttpClient {
  async post(
    url: string,
    body: string,
    headers: Record<string, string>,
    timeoutMs: number
  ): Promise<HttpResponse> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: ac.signal,
      });
      return { status: res.status, body: await res.text() };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Spec §2.2: URL-encoded form body. */
export function formEncode(params: Record<string, string>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/** Field aliases that mean the same thing on the wire. */
const ALIASES: Record<string, string> = {
  XTL_PO_ID: 'XTL_ORDER_ID',
  PMT_LAST4: 'PMT_L4',
};

/**
 * Normalize a raw gateway response into an upper-cased field map.
 * Accepts JSON (what we request) and falls back to form-encoded text.
 */
export function normalizeResponse(body: string): Record<string, string> {
  const out: Record<string, string> = {};

  const put = (k: string, v: unknown) => {
    if (v === null || v === undefined) return;
    const key = String(k).toUpperCase().trim();
    const value = typeof v === 'string' ? v : String(v);
    out[key] = value;
    const alias = ALIASES[key];
    if (alias && out[alias] === undefined) out[alias] = value;
  };

  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      throw new TransportError('gateway returned malformed JSON', e);
    }
    const flatten = (obj: unknown, prefix = ''): void => {
      if (obj === null || obj === undefined) return;
      if (Array.isArray(obj)) {
        obj.forEach((v, i) => flatten(v, `${prefix}${i + 1}`));
        return;
      }
      if (typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (v !== null && typeof v === 'object') flatten(v, `${prefix}${k}_`);
          else put(`${prefix}${k}`, v);
        }
        return;
      }
      put(prefix.replace(/_$/, ''), obj);
    };
    flatten(parsed);
    return out;
  }

  // form-encoded fallback
  for (const pair of trimmed.split('&')) {
    if (!pair) continue;
    const idx = pair.indexOf('=');
    const k = idx === -1 ? pair : pair.slice(0, idx);
    const v = idx === -1 ? '' : pair.slice(idx + 1);
    put(decodeURIComponent(k), decodeURIComponent(v.replace(/\+/g, ' ')));
  }
  return out;
}

export interface TransportOptions {
  endpoint: string;
  httpClient: HttpClient;
  timeoutMs: number;
}

export async function send(
  opts: TransportOptions,
  params: Record<string, string>,
  idempotencyKey?: string
): Promise<Record<string, string>> {
  const body = formEncode(params);
  let res: HttpResponse;
  try {
    res = await opts.httpClient.post(
      opts.endpoint,
      body,
      {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      opts.timeoutMs
    );
  } catch (e) {
    const aborted =
      (e as { name?: string })?.name === 'AbortError' ||
      (e as { name?: string })?.name === 'TimeoutError';
    if (aborted) {
      throw new TimeoutError(
        `gateway did not respond within ${opts.timeoutMs}ms — transaction state is UNKNOWN`,
        opts.timeoutMs,
        idempotencyKey
      );
    }
    throw new TransportError(`gateway request failed: ${String(e)}`, e);
  }

  if (res.status < 200 || res.status >= 300) {
    throw new TransportError(`gateway returned HTTP ${res.status}`);
  }
  return normalizeResponse(res.body);
}
