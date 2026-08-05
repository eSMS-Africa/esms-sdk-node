import type { HttpClient } from "./http.js";
import type {
  Balance,
  BulkSendParams,
  ListParams,
  Message,
  MessageList,
  Route,
  SendParams,
  SendResult,
} from "./types.js";

/** Operations on SMS messages. */
export class MessagesResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Send a single SMS.
   *
   * @example
   * const res = await esms.messages.send({
   *   to: "+256700000000",
   *   text: "Your code is 123456",
   *   senderId: "eSMSAfrica",
   * });
   * console.log(res.id, res.status);
   */
  async send(params: SendParams): Promise<SendResult> {
    const scheduledAt =
      params.scheduledAt instanceof Date
        ? params.scheduledAt.toISOString()
        : params.scheduledAt;
    const body = {
      to: params.to,
      text: params.text,
      sender_id: params.senderId,
      route: params.route,
      schedule_mode: params.scheduleMode,
      scheduled_at: scheduledAt,
    };
    const raw = await this.http.request<Record<string, unknown>>({
      method: "POST",
      path: "/messages/send",
      body: prune(body),
    });
    return mapSendResult(raw);
  }

  /**
   * Schedule an SMS for later delivery (5 minutes to 7 days out).
   * Convenience wrapper around {@link send}.
   */
  async schedule(
    params: Omit<SendParams, "scheduleMode"> & { scheduledAt: string | Date },
  ): Promise<SendResult> {
    return this.send({ ...params, scheduleMode: "scheduled" });
  }

  /** List messages, most recent first. */
  async list(params: ListParams = {}): Promise<MessageList> {
    const raw = await this.http.request<Record<string, unknown>>({
      method: "GET",
      path: "/messages",
      query: {
        page: params.page,
        limit: params.limit,
        status: params.status,
      },
    });
    return {
      messages: ((raw.messages as Record<string, unknown>[]) ?? []).map(mapSummary),
      total: Number(raw.total ?? 0),
      page: Number(raw.page ?? 0),
      limit: Number(raw.limit ?? 0),
    };
  }

  /** Fetch a single message with its full delivery timeline. */
  async get(messageId: string): Promise<Message> {
    const raw = await this.http.request<Record<string, unknown>>({
      method: "GET",
      path: `/messages/${encodeURIComponent(messageId)}`,
    });
    return mapMessage(raw);
  }

  /** Retry a failed message. */
  async retry(messageId: string): Promise<SendResult> {
    const raw = await this.http.request<Record<string, unknown>>({
      method: "POST",
      path: `/messages/${encodeURIComponent(messageId)}/retry`,
    });
    return mapSendResult(raw);
  }

  /** Send one message to every contact in the given contact lists. */
  async sendBulk(params: BulkSendParams): Promise<Record<string, unknown>> {
    return this.http.request<Record<string, unknown>>({
      method: "POST",
      path: "/messages/send-bulk",
      body: prune({
        contact_list_ids: params.contactListIds,
        text: params.text,
        sender_id: params.senderId,
        route: params.route,
      }),
    });
  }
}

/** Account balance and credit. */
export class BalanceResource {
  constructor(private readonly http: HttpClient) {}

  /** Get the current account balance and an SMS estimate. */
  async get(): Promise<Balance> {
    const raw = await this.http.request<Record<string, unknown>>({
      method: "GET",
      path: "/balance",
    });
    return {
      balance: Number(raw.balance ?? 0),
      currency: String(raw.currency ?? ""),
      smsEstimate:
        raw.sms_estimate !== undefined ? Number(raw.sms_estimate) : undefined,
    };
  }
}

/** Available SMS routes and their pricing. */
export class RoutesResource {
  constructor(private readonly http: HttpClient) {}

  /** List all active routes (one per country you can reach). */
  async list(): Promise<Route[]> {
    const raw = await this.http.request<Record<string, unknown>[]>({
      method: "GET",
      path: "/routes",
    });
    return (raw ?? []).map((r) => ({
      code: String(r.code),
      name: String(r.name),
      countryCode: String(r.country_code),
      countryName: String(r.country_name),
      currency: String(r.currency),
      pricePerSegment: Number(r.price_per_segment),
      senderIdDefault: String(r.sender_id_default),
      isActive: Boolean(r.is_active),
    }));
  }
}

/** Managed OTP verification - we generate, send, and check the code. */
export class VerifyResource {
  constructor(private readonly http: HttpClient) {}

  /** Send a verification code to a phone number. */
  async start(params: {
    to: string;
    senderId?: string;
    codeLength?: number;
    expirySeconds?: number;
    template?: string;
  }): Promise<Record<string, unknown>> {
    return this.http.request<Record<string, unknown>>({
      method: "POST",
      path: "/verify/start",
      body: prune({
        to: params.to,
        sender_id: params.senderId,
        code_length: params.codeLength,
        expiry_seconds: params.expirySeconds,
        template: params.template,
      }),
    });
  }

  /** Check a code the user entered. Returns `{ status: "approved" | "pending" | ... }`. */
  async check(params: {
    code: string;
    verificationId?: string;
    to?: string;
  }): Promise<Record<string, unknown>> {
    return this.http.request<Record<string, unknown>>({
      method: "POST",
      path: "/verify/check",
      body: prune({
        code: params.code,
        verification_id: params.verificationId,
        to: params.to,
      }),
    });
  }
}

/** Manage the opt-out (STOP / DND) list. */
export class OptOutsResource {
  constructor(private readonly http: HttpClient) {}

  /** List numbers that have opted out of your messages. */
  async list(): Promise<Record<string, unknown>[]> {
    const raw = await this.http.request<Record<string, unknown>>({ method: "GET", path: "/opt-outs" });
    return (raw?.opt_outs as Record<string, unknown>[]) ?? [];
  }

  /** Manually add a number to your opt-out list. */
  async add(phone: string): Promise<Record<string, unknown>> {
    return this.http.request<Record<string, unknown>>({ method: "POST", path: "/opt-outs", body: { phone } });
  }

  /** Remove a number from your opt-out list. */
  async remove(phone: string): Promise<Record<string, unknown>> {
    return this.http.request<Record<string, unknown>>({
      method: "DELETE",
      path: `/opt-outs/${encodeURIComponent(phone)}`,
    });
  }
}

// ── mapping helpers (snake_case API → camelCase SDK) ──────────────

function prune<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

function mapSendResult(r: Record<string, unknown>): SendResult {
  return {
    ...r,
    id: String(r.id),
    status: String(r.status),
    segments: Number(r.segments ?? 0),
    cost: Number(r.cost ?? 0),
    costCurrency: String(r.cost_currency ?? ""),
    routeCost: Number(r.route_cost ?? 0),
    routeCurrency: String(r.route_currency ?? ""),
    route: String(r.route ?? ""),
    balanceAfter: Number(r.balance_after ?? 0),
    scheduledAt: (r.scheduled_at as string | null) ?? null,
  };
}

function mapSummary(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    phone: String(r.phone ?? ""),
    text: String(r.text ?? ""),
    senderId: (r.sender_id as string | null) ?? null,
    route: (r.route as string | null) ?? null,
    country: (r.country as string | null) ?? null,
    segments: Number(r.segments ?? 0),
    cost: Number(r.cost ?? 0),
    currency: (r.currency as string | null) ?? null,
    status: String(r.status ?? ""),
    errorCode: (r.error_code as string | null) ?? null,
    retryCount: Number(r.retry_count ?? 0),
    createdAt: String(r.created_at ?? ""),
    deliveredAt: (r.delivered_at as string | null) ?? null,
  };
}

function mapMessage(r: Record<string, unknown>): Message {
  const base = mapSummary(r);
  return {
    ...base,
    errorMessage: (r.error_message as string | null) ?? null,
    submittedAt: (r.submitted_at as string | null) ?? null,
    failedAt: (r.failed_at as string | null) ?? null,
    timeline: ((r.timeline as Record<string, unknown>[]) ?? []).map((e) => ({
      event: String(e.event ?? ""),
      status: String(e.status ?? ""),
      detail: (e.detail as string | null) ?? null,
      at: String(e.at ?? ""),
      metadata: (e.metadata as Record<string, unknown> | null) ?? null,
    })),
  };
}
