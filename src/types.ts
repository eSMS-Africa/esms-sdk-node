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
}

export interface SendResult {
  /** Message ID — use it with {@link MessagesResource.get}. */
  id: string;
  status: MessageStatus;
  segments: number;
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
}

export interface MessageSummary {
  id: string;
  phone: string;
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

export interface BulkSendParams {
  /** IDs of contact lists to send to. */
  contactListIds: number[];
  text: string;
  senderId?: string;
  route?: string;
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
