import {
  EsmsConnectionError,
  errorFromResponse,
} from "./errors.js";

export interface ClientOptions {
  /** Your `esms_live_...` or `esms_test_...` API key. */
  apiKey: string;
  /** Override the API base URL. Defaults to `https://sms.esmsafrica.io/api`. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeout?: number;
  /** Retries for transient failures (network, 429, 5xx). Default 2. */
  maxRetries?: number;
  /** Inject a custom fetch (for testing or non-standard runtimes). */
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_BASE_URL = "https://sms.esmsafrica.io/api";
const VERSION = "1.0.0";

interface RequestOptions {
  method: string;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

/**
 * Thin HTTP layer shared by every resource: auth header, JSON encode/decode,
 * timeouts, error mapping, and retry-with-backoff for transient failures.
 * @internal
 */
export class HttpClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(opts: ClientOptions) {
    if (!opts || !opts.apiKey) {
      throw new Error(
        "An API key is required. Create one in the eSMS dashboard under Developers → API Keys.",
      );
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeout = opts.timeout ?? 30_000;
    this.maxRetries = opts.maxRetries ?? 2;
    const f = opts.fetch ?? globalThis.fetch;
    if (!f) {
      throw new Error(
        "No global fetch found. Use Node 18+, or pass a `fetch` implementation.",
      );
    }
    this.fetchImpl = f;
  }

  async request<T>(opts: RequestOptions): Promise<T> {
    const url = new URL(this.baseUrl + opts.path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "User-Agent": `esms-node/${VERSION}`,
    };
    let payload: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(opts.body);
    }

    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        const res = await this.fetchImpl(url.toString(), {
          method: opts.method,
          headers,
          body: payload,
          signal: controller.signal,
        });
        clearTimeout(timer);

        const requestId = res.headers.get("x-request-id") ?? undefined;
        const raw = await res.text();
        const parsed = raw ? safeJson(raw) : undefined;

        if (res.ok) return parsed as T;

        // Retry transient server-side statuses.
        if ((res.status === 429 || res.status >= 500) && attempt < this.maxRetries) {
          lastErr = errorFromResponse(res.status, parsed, requestId);
          await sleep(backoff(attempt, res.headers.get("retry-after")));
          continue;
        }
        throw errorFromResponse(res.status, parsed, requestId);
      } catch (err) {
        clearTimeout(timer);
        // A mapped API error: rethrow immediately (already handled retry above).
        if (err && typeof err === "object" && err.constructor?.name?.endsWith("Error") && "status" in err) {
          throw err;
        }
        // Network/timeout: retry, then surface as a connection error.
        lastErr = err;
        if (attempt < this.maxRetries) {
          await sleep(backoff(attempt, null));
          continue;
        }
        const aborted = err instanceof Error && err.name === "AbortError";
        throw new EsmsConnectionError(
          aborted
            ? `Request timed out after ${this.timeout}ms`
            : `Could not reach the eSMS API: ${(err as Error)?.message ?? err}`,
          { cause: err },
        );
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new EsmsConnectionError("Request failed");
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoff(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (!Number.isNaN(secs)) return Math.min(secs * 1000, 20_000);
  }
  // 0.5s, 1s, 2s … with jitter, capped at 10s.
  const base = Math.min(500 * 2 ** attempt, 10_000);
  return base + Math.floor(base * 0.2 * Math.random());
}
