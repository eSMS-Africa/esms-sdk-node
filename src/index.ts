import { HttpClient, type ClientOptions } from "./http.js";
import {
  BalanceResource,
  MessagesResource,
  RoutesResource,
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
  }

  /** The base URL requests are sent to. */
  get baseUrl(): string {
    return this.http.baseUrl;
  }
}

/** Alias for {@link Esms}. */
export const EsmsClient = Esms;
export default Esms;
