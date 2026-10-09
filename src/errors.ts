/**
 * Error hierarchy for the eSMS Africa SDK.
 *
 * Every failure raised by the client is an {@link EsmsError}. Inspect
 * `err.status` and `err.code` to branch, or catch a specific subclass.
 */

export interface EsmsErrorOptions {
  status?: number;
  code?: string;
  detail?: unknown;
  requestId?: string;
  cause?: unknown;
}

/** Base class for every error thrown by the SDK. */
export class EsmsError extends Error {
  /** HTTP status code, when the failure came from the API. */
  readonly status?: number;
  /** Machine-readable error code (e.g. `insufficient_balance`). */
  readonly code?: string;
  /** Raw `detail` payload returned by the API, if any. */
  readonly detail?: unknown;
  /** The `X-Request-Id` response header, useful for support tickets. */
  readonly requestId?: string;

  constructor(message: string, opts: EsmsErrorOptions = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = opts.status;
    this.code = opts.code;
    this.detail = opts.detail;
    this.requestId = opts.requestId;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The request never reached the API (DNS, TLS, timeout, offline). */
export class EsmsConnectionError extends EsmsError {}

/** 401 - the API key or token is missing or invalid. */
export class AuthenticationError extends EsmsError {}

/** 403 - authenticated, but not allowed to perform this action. */
export class PermissionError extends EsmsError {}

/** 404 - the requested resource does not exist. */
export class NotFoundError extends EsmsError {}

/** 400 / 409 / 413 / 422 - the request was rejected as invalid. */
export class InvalidRequestError extends EsmsError {}

/**
 * 402 `insufficient_balance` - the account does not have enough credit to
 * send. Exposes the shortfall so callers can prompt a top-up.
 */
export class InsufficientBalanceError extends InvalidRequestError {
  readonly balance?: number;
  readonly cost?: number;
  readonly currency?: string;

  constructor(message: string, opts: EsmsErrorOptions = {}) {
    super(message, opts);
    const d = (opts.detail ?? {}) as Record<string, unknown>;
    const num = (...vals: unknown[]) => vals.find((v) => typeof v === "number") as number | undefined;
    // Some paths report `available`/`required` instead of `balance`/`cost`.
    this.balance = num(d.balance, d.available);
    this.cost = num(d.cost, d.required);
    this.currency = typeof d.currency === "string" ? d.currency : undefined;
  }
}

/** 429 - too many requests; back off and retry later. */
export class RateLimitError extends EsmsError {}

/** 5xx - the API had an internal error. */
export class ApiError extends EsmsError {}

/**
 * Build the right error subclass from an HTTP status and parsed body.
 * @internal
 */
export function errorFromResponse(
  status: number,
  body: unknown,
  requestId?: string,
): EsmsError {
  const { code, message, detail, requestId: bodyRequestId } = parseErrorBody(status, body);
  const opts: EsmsErrorOptions = { status, code, detail, requestId: requestId || bodyRequestId };

  if (code === "insufficient_balance") return new InsufficientBalanceError(message, opts);
  switch (status) {
    case 401:
      return new AuthenticationError(message, opts);
    case 402:
      // Payment required without the insufficient_balance code is still a credit problem.
      return new InsufficientBalanceError(message, opts);
    case 403:
      return new PermissionError(message, opts);
    case 404:
      return new NotFoundError(message, opts);
    case 400:
    case 409:
    case 413:
    case 422:
      return new InvalidRequestError(message, opts);
    case 429:
      return new RateLimitError(message, opts);
    default:
      if (status >= 500) return new ApiError(message, opts);
      return new EsmsError(message, opts);
  }
}

/**
 * Pull code / message / detail out of an error body. The API returns
 * `{"detail": <string | object | list>, "error": {code, message, request_id}}`;
 * the rate limiter returns `{"error": "<text>"}`.
 * @internal
 */
export function parseErrorBody(
  status: number,
  body: unknown,
): { code?: string; message: string; detail: unknown; requestId?: string } {
  const obj = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : undefined;
  const detail: unknown = obj && "detail" in obj ? obj.detail : body;
  const envelope = obj && obj.error && typeof obj.error === "object"
    ? (obj.error as Record<string, unknown>)
    : undefined;

  let code: string | undefined;
  let message: string | undefined;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const d = detail as Record<string, unknown>;
    if (typeof d.code === "string") code = d.code;
    if (typeof d.message === "string") message = d.message;
  } else if (typeof detail === "string" && detail) {
    message = detail;
  } else if (Array.isArray(detail) && detail.length) {
    // 422 validation errors: [{loc: [...], msg: "..."}]
    const first = detail[0] as Record<string, unknown>;
    if (first && typeof first.msg === "string") {
      const loc = Array.isArray(first.loc) ? first.loc.join(".") : "";
      message = `Request validation failed: ${loc ? `${loc}: ` : ""}${first.msg}`;
    }
  }
  if (envelope) {
    if (!code && typeof envelope.code === "string") code = envelope.code;
    if (!message && typeof envelope.message === "string") message = envelope.message;
  } else if (obj && typeof obj.error === "string" && !message) {
    message = obj.error;
  }
  const requestId =
    envelope && typeof envelope.request_id === "string" && envelope.request_id
      ? envelope.request_id
      : undefined;
  return { code, message: message || `HTTP ${status}`, detail, requestId };
}
