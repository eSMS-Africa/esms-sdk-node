import { HttpClient, type ClientOptions } from "./http.js";
import {
  BalanceResource,
  MessagesResource,
  RoutesResource,
  VerifyResource,
  OptOutsResource,
} from "./resources.js";

export type { ClientOptions } from "./http.js";
export * from "./types.js";
export * from "./errors.js";

/**
 * The eSMS Africa SMS client.
 *
 * @example
 * import { Esms } from "@esms/sms";
 *
 * const esms = new Esms({ apiKey: process.env.ESMS_API_KEY! });
 * const res = await esms.messages.send({ to: "+256700000000", text: "Hi!" });
 */
export class Esms {
  /** Send and manage SMS messages. */
  readonly messages: MessagesResource;
  /** Read account balance. */
  readonly balance: BalanceResource;
  /** List available routes and pricing. */
  readonly routes: RoutesResource;
  /** Send and check one-time verification codes (managed OTP). */
  readonly verify: VerifyResource;
  /** Manage the opt-out (STOP / DND) list. */
  readonly optOuts: OptOutsResource;

  private readonly http: HttpClient;

  /**
   * @param options.apiKey  Your `esms_live_...` or `esms_test_...` key.
   * @param options         A raw key string is also accepted as a shorthand.
   */
  constructor(options: ClientOptions | string) {
    const opts: ClientOptions =
      typeof options === "string" ? { apiKey: options } : options;
    this.http = new HttpClient(opts);
    this.messages = new MessagesResource(this.http);
    this.balance = new BalanceResource(this.http);
    this.routes = new RoutesResource(this.http);
    this.verify = new VerifyResource(this.http);
    this.optOuts = new OptOutsResource(this.http);
  }

  /** The base URL requests are sent to. */
  get baseUrl(): string {
    return this.http.baseUrl;
  }

  /**
   * Verify an incoming webhook's HMAC-SHA256 signature (constant-time).
   *
   * @param rawBody   The exact raw request body (string or Buffer) - not re-serialized JSON.
   * @param signature The `X-Webhook-Signature` header value (e.g. `sha256=…`).
   * @param secret    Your webhook signing secret.
   *
   * @example
   * if (!(await Esms.verifyWebhook(req.rawBody, req.headers["x-webhook-signature"], secret))) {
   *   return res.status(401).end();
   * }
   */
  static async verifyWebhook(
    rawBody: string | Uint8Array,
    signature: string | undefined | null,
    secret: string,
  ): Promise<boolean> {
    if (!signature || !secret) return false;
    const enc = new TextEncoder();
    const body = (typeof rawBody === "string" ? enc.encode(rawBody) : rawBody) as BufferSource;
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(secret) as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, body);
    const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const expected = "sha256=" + hex;
    if (signature.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  }
}

/** Alias for {@link Esms}. */
export const EsmsClient = Esms;
export default Esms;
