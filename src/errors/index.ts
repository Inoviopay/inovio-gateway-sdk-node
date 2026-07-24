/**
 * Exception hierarchy (object model §3.7).
 *
 * A DECLINE IS NEVER THROWN (Q1). A declined transaction is a normal return
 * value — `TransactionResult{status:'DECLINED'}` carrying the full outcome/AVS/
 * CVV detail. Exceptions are reserved for transport, auth, validation and
 * configuration failures: things that mean "your request never got a payment
 * answer", not "the answer was no".
 */

export class InovioError extends Error {
  readonly raw?: Readonly<Record<string, string>>;

  constructor(message: string, raw?: Record<string, string>) {
    super(message);
    this.name = new.target.name;
    this.raw = raw ? Object.freeze({ ...raw }) : undefined;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** API tier 100-106 — bad credentials, inactive user, bad site/service. */
export class AuthenticationError extends InovioError {
  readonly code?: number;
  constructor(message: string, code?: number, raw?: Record<string, string>) {
    super(message, raw);
    this.code = code;
  }
}

/** Client-side or API 110-120 — missing/invalid field. `refField` names it. */
export class ValidationError extends InovioError {
  readonly code?: number;
  readonly refField?: string;
  constructor(
    message: string,
    opts: { code?: number; refField?: string; raw?: Record<string, string> } = {}
  ) {
    super(message, opts.raw);
    this.code = opts.code;
    this.refField = opts.refField;
  }
}

/** Currency/product/merchant-account not configured (155, 165, 210, 500...). */
export class ConfigurationError extends InovioError {
  readonly code?: number;
  constructor(message: string, code?: number, raw?: Record<string, string>) {
    super(message, raw);
    this.code = code;
  }
}

/** Network-level failure — the request may or may not have been processed. */
export class TransportError extends InovioError {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

/**
 * The gateway did not answer in time. THE TRANSACTION STATE IS UNKNOWN — it may
 * still have been approved. Carries the idempotency key so the caller can
 * resolve the true state via `client.status(...)` rather than blindly retrying.
 */
export class TimeoutError extends TransportError {
  readonly xtlOrderId?: string;
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number, xtlOrderId?: string) {
    super(message);
    this.timeoutMs = timeoutMs;
    this.xtlOrderId = xtlOrderId;
  }

  /** Guidance surfaced on the error itself, since this is the trap case. */
  get recoveryHint(): string {
    return this.xtlOrderId
      ? `Transaction state is UNKNOWN. Resolve it with client.status(Refs.xtlOrder(${JSON.stringify(this.xtlOrderId)})) before retrying — a blind retry may double-charge.`
      : 'Transaction state is UNKNOWN. No idempotency key was set, so the state cannot be resolved by key; set idempotency.xtlOrderId on future requests.';
  }
}

/** API 100 — throttled. */
export class RateLimitError extends InovioError {
  constructor(message: string, raw?: Record<string, string>) {
    super(message, raw);
  }
}
