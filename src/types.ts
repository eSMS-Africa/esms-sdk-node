/** Request and response shapes for the eSMS Africa SMS API. */

/** How a message should be dispatched. */
export type ScheduleMode = "now" | "scheduled";

/** Lifecycle status of a message. */
export type MessageStatus =
  | "queued"
  | "scheduled"
  | "submitted"
  | "delivered"
  | "failed"
  | "undelivered"
  | string;

export interface SendParams {
  /** Recipient in international format, e.g. `+256700000000`. */
  to: string;
  /** Message body. Unicode is supported (counted at 70 chars/segment). */
  text: string;
  /** Approved sender ID. Defaults to the route's default sender. */
  senderId?: string;
  /** Explicit route code such as `ESMS_UG`. Auto-detected from `to` if omitted. */
  route?: string;
  /** `"now"` (default) or `"scheduled"`. */
  scheduleMode?: ScheduleMode;
  /** ISO-8601 UTC time; required when `scheduleMode` is `"scheduled"`. */
  scheduledAt?: string | Date;
  /** Bill the international-delivery rate (USD) for this send. */
  international?: boolean;
  /**
   * Makes the send safe to retry: a repeat with the same key returns the
   * original result instead of sending and charging again. A random key is
   * generated per call when omitted.
   */
  idempotencyKey?: string;
}

export interface SendResult {
  /** Message ID - use it with {@link MessagesResource.get}. */
  id: string;
  status: MessageStatus;
  segments: number;
  /** `GSM7` or `UCS2`. */
  encoding?: string;
  /** Amount charged, in the account's wallet currency. */
  cost: number;
  costCurrency: string;
  routeCost: number;
  routeCurrency: string;
  /** Public route code, e.g. `ESMS_UG`. */
  route: string;
  balanceAfter: number;
  scheduledAt: string | null;
  /** Any field the API adds in future is preserved here. */
  [key: string]: unknown;
}

export interface ListParams {
  /** Zero-based page index. */
  page?: number;
  /** Page size, 1–100. */
  limit?: number;
  /** Filter by status, e.g. `delivered`. */
  status?: MessageStatus;
  /** Filter by recipient phone (E.164). */
  to?: string;
  /** Filter by bulk batch id (from {@link MessagesResource.sendBulk}). */
  batchId?: string;
  /** ISO-8601 lower bound on created time. */
  dateFrom?: string;
  /** ISO-8601 upper bound on created time. */
  dateTo?: string;
  /** `live` (default for live keys), `test` or `all`. */
  environment?: "live" | "test" | "all";
}

export interface MessageSummary {
  id: string;
  phone: string;
  /** Message body. Truncated to 100 characters in listings; use `get()` for the full text. */
  text: string;
  senderId: string | null;
  route: string | null;
  country: string | null;
  segments: number;
  cost: number;
  currency: string | null;
  status: MessageStatus;
  errorCode: string | null;
  retryCount: number;
  createdAt: string;
  deliveredAt: string | null;
}

export interface MessageList {
  messages: MessageSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface TimelineEvent {
  event: string;
  status: string;
  detail: string | null;
  at: string;
  metadata: Record<string, unknown> | null;
}

export interface Message extends Omit<MessageSummary, "currency"> {
  errorMessage: string | null;
  submittedAt: string | null;
  failedAt: string | null;
  timeline: TimelineEvent[];
}

export interface BulkRecipient {
  /** Recipient in international format. */
  to: string;
  name?: string;
  /** Per-recipient template variables. */
  vars?: Record<string, unknown>;
}

export interface BulkSendParams {
  /** IDs of contact lists to send to. Provide this, `recipients`, or both. */
  contactListIds?: number[];
  /** Inline recipients (no contact list needed). Not allowed with `scheduleMode: "scheduled"`. */
  recipients?: BulkRecipient[];
  text: string;
  senderId?: string;
  route?: string;
  /** `"now"` (default), `"scheduled"` or `"drip"`. */
  scheduleMode?: "now" | "scheduled" | "drip";
  /** ISO-8601 UTC time; required when `scheduleMode` is `"scheduled"`. */
  scheduledAt?: string | Date;
  /** Messages per minute when `scheduleMode` is `"drip"`. */
  dripRate?: number;
  /** Bill the international-delivery rate (USD). */
  international?: boolean;
}

export interface BulkSendResult {
  /** Track it with {@link MessagesResource.getBatch}. */
  batchId: string;
  totalRecipients: number;
  estimatedCost: number;
  status: string;
  /** The raw snake_case fields are kept too. */
  [key: string]: unknown;
}

export interface RetryResult {
  id: string;
  status: MessageStatus;
  retryCount: number;
  [key: string]: unknown;
}

export interface Balance {
  balance: number;
  currency: string;
  /** Estimated number of SMS the balance can still send. */
  smsEstimate?: number;
}

export interface Route {
  code: string;
  name: string;
  countryCode: string;
  countryName: string;
  currency: string;
  pricePerSegment: number;
  senderIdDefault: string;
  isActive: boolean;
}
