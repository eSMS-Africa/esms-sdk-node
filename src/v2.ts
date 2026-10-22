// Personalised bulk, campaigns, imports, contacts, groups and templates
// (API v2 surface). Methods return the raw API JSON (snake_case), like the
// Verify resource; request params are camelCase and converted for you.
import { newIdempotencyKey, type HttpClient } from "./http.js";
import type { Json } from "./types.js";

type Q = Record<string, string | number | undefined>;

function snakeKey(k: string): string {
  return k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
}

/** Top-level camelCase -> snake_case, dropping undefined. Nested values
 * (vars, audience, mapping, schedule, recurrence...) are passed through, so
 * your merge-field names are never rewritten. */
export function toBody(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || k === "idempotencyKey") continue;
    out[snakeKey(k)] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

function enc(v: string | number): string {
  return encodeURIComponent(String(v));
}

/** A schedule: send now, at a time (in `timezone`), or on repeat. */
export interface ScheduleParams {
  mode: "now" | "scheduled" | "recurring";
  /** ISO 8601. Without an offset it is read in `timezone`. */
  at?: string;
  /** IANA name, e.g. "Africa/Nairobi" (default: your workspace timezone). */
  timezone?: string;
  /** {freq: "daily"|"weekly"|"monthly"|"cron", time, interval, weekdays, monthday, cron, until, count} */
  recurrence?: Record<string, unknown>;
}

export interface BatchRecipient {
  to: string;
  name?: string;
  /** Merge-field values for this recipient, e.g. {amount: "1,500"}. */
  vars?: Record<string, string | number>;
  /** A full message for this recipient (instead of the template). */
  text?: string;
}

export interface SendBatchParams {
  /** Message with merge fields: "Hi {first_name|there}, you owe {amount}". */
  template?: string;
  templateId?: number;
  recipients?: BatchRecipient[];
  /** Full messages [{to, text}] (no template). */
  messages?: { to: string; text: string }[];
  senderId?: string;
  senderFallback?: boolean;
  messageType?: "transactional" | "promotional";
  name?: string;
  tags?: string[];
  defaultCountry?: string;
  schedule?: ScheduleParams;
  throttlePerMinute?: number;
  callbackUrl?: string;
  /** Generated per call when omitted, so retries never send twice. */
  idempotencyKey?: string;
}

export interface SendBatchResult extends Json {
  batch_id: string;
  campaign_id: number;
  status: string;
  accepted: number;
  rejected: { index: number; to: string; reason: string; message: string }[];
  rejected_count: number;
  estimated_cost: number;
  currency: string | null;
  idempotent_replay: boolean;
  livemode: boolean;
}

/** Durable personalised bulk send. */
export async function sendBatch(http: HttpClient, params: SendBatchParams): Promise<SendBatchResult> {
  return http.request<SendBatchResult>({
    method: "POST",
    path: "/messages/batch",
    headers: { "Idempotency-Key": params.idempotencyKey || newIdempotencyKey() },
    body: toBody(params as Record<string, unknown>),
  });
}

/** Campaigns: draft -> preview / prepare / review -> test -> launch, plus reports. */
export class CampaignsResource {
  constructor(private readonly http: HttpClient) {}

  /** Create a draft (or create + launch with `launch: true`). */
  create(params: Record<string, unknown> & { idempotencyKey?: string }): Promise<Json> {
    const headers: Record<string, string> = {};
    if (params.idempotencyKey) headers["Idempotency-Key"] = String(params.idempotencyKey);
    return this.http.request({ method: "POST", path: "/campaigns", headers, body: toBody(params) });
  }
  list(params: { status?: string; q?: string; tag?: string; page?: number; limit?: number; includeRuns?: boolean } = {}): Promise<Json> {
    return this.http.request({
      method: "GET", path: "/campaigns",
      query: { status: params.status, q: params.q, tag: params.tag, page: params.page, limit: params.limit,
               include_runs: params.includeRuns === undefined ? undefined : String(params.includeRuns) },
    });
  }
  get(id: number): Promise<Json> { return this.http.request({ method: "GET", path: `/campaigns/${enc(id)}` }); }
  /** Update a draft (partial). */
  update(id: number, params: Record<string, unknown>): Promise<Json> {
    return this.http.request({ method: "PATCH", path: `/campaigns/${enc(id)}`, body: toBody(params) });
  }
  async delete(id: number): Promise<Json> { return this.http.request({ method: "DELETE", path: `/campaigns/${enc(id)}` }); }
  /** First N rendered messages + the longest-message counter. */
  preview(id: number, params: { text?: string; n?: number } = {}): Promise<Json> {
    return this.http.request({ method: "POST", path: `/campaigns/${enc(id)}/preview`, body: toBody(params) });
  }
  /** Build the recipient list and the exact estimate (`status: ready | preparing`). */
  prepare(id: number): Promise<Json> { return this.post(id, "prepare"); }
  /** Blocking problems, warnings and the estimate. */
  review(id: number): Promise<Json> { return this.http.request({ method: "GET", path: `/campaigns/${enc(id)}/review` }); }
  /** Send the first rendered message to up to 3 of your own numbers. */
  test(id: number, to: string[]): Promise<Json> { return this.post(id, "test", { to }); }
  /** Send now, schedule, or submit for approval. */
  launch(id: number): Promise<Json> { return this.post(id, "launch"); }
  approve(id: number, note?: string): Promise<Json> { return this.post(id, "approve", toBody({ note })); }
  reject(id: number, note?: string): Promise<Json> { return this.post(id, "reject", toBody({ note })); }
  pause(id: number): Promise<Json> { return this.post(id, "pause"); }
  resume(id: number): Promise<Json> { return this.post(id, "resume"); }
  cancel(id: number): Promise<Json> { return this.post(id, "cancel"); }
  /** Send again to recipients whose message failed (charged like a new send). */
  retryFailed(id: number): Promise<Json> { return this.post(id, "retry-failed"); }
  duplicate(id: number): Promise<Json> { return this.post(id, "duplicate"); }
  report(id: number): Promise<Json> { return this.http.request({ method: "GET", path: `/campaigns/${enc(id)}/report` }); }
  stats(id: number): Promise<Json> { return this.http.request({ method: "GET", path: `/campaigns/${enc(id)}/stats` }); }
  /** Per-recipient status. status: delivered | failed | sent | pending | skipped | cancelled. */
  recipients(id: number, params: { status?: string; country?: string; q?: string; page?: number; limit?: number } = {}): Promise<Json> {
    return this.http.request({ method: "GET", path: `/campaigns/${enc(id)}/recipients`, query: params as Q });
  }
  /** Runs of a recurring campaign. */
  runs(id: number): Promise<Json> { return this.http.request({ method: "GET", path: `/campaigns/${enc(id)}/runs` }); }

  private post(id: number, action: string, body?: unknown): Promise<Json> {
    return this.http.request({ method: "POST", path: `/campaigns/${enc(id)}/${action}`, body });
  }
}

/** Recipient imports (CSV / Excel / paste / Google Sheets). */
export class ImportsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Upload a CSV or Excel file. `file` is a Blob/File, or bytes plus a filename.
   * @example
   * import { readFile } from "node:fs/promises";
   * const imp = await esms.imports.upload(await readFile("debtors.xlsx"), { filename: "debtors.xlsx", defaultCountry: "UG" });
   */
  upload(file: Blob | Uint8Array | ArrayBuffer, opts: { filename?: string; defaultCountry?: string } = {}): Promise<Json> {
    const form = new FormData();
    const blob = file instanceof Blob ? file : new Blob([file as BlobPart]);
    const name = opts.filename || (file instanceof File ? file.name : "upload.csv");
    form.append("file", blob, name);
    if (opts.defaultCountry) form.append("default_country", opts.defaultCountry);
    return this.http.request({ method: "POST", path: "/imports", form });
  }
  paste(text: string, defaultCountry?: string): Promise<Json> {
    return this.http.request({ method: "POST", path: "/imports/paste", body: toBody({ text, defaultCountry }) });
  }
  gsheet(url: string, defaultCountry?: string): Promise<Json> {
    return this.http.request({ method: "POST", path: "/imports/gsheet", body: toBody({ url, defaultCountry }) });
  }
  get(id: string): Promise<Json> { return this.http.request({ method: "GET", path: `/imports/${enc(id)}` }); }
  /** Map columns and validate in the background; poll `jobs.get(job_id)` or `get(id)`. */
  process(id: string, params: { mapping: { phone: string; name?: string | null; fields?: Record<string, string> };
                                 defaultCountry?: string; dedupe?: boolean; skipOptedOut?: boolean }): Promise<Json> {
    return this.http.request({ method: "POST", path: `/imports/${enc(id)}/process`, body: toBody(params) });
  }
  errors(id: string, params: { reason?: string; page?: number; limit?: number } = {}): Promise<Json> {
    return this.http.request({ method: "GET", path: `/imports/${enc(id)}/errors`, query: params as Q });
  }
  recipients(id: string, params: { page?: number; limit?: number } = {}): Promise<Json> {
    return this.http.request({ method: "GET", path: `/imports/${enc(id)}/recipients`, query: params as Q });
  }
  saveToGroup(id: string, params: { groupId?: number; name?: string; tags?: string[] }): Promise<Json> {
    return this.http.request({ method: "POST", path: `/imports/${enc(id)}/save-to-group`, body: toBody(params) });
  }
}

/** Background job progress (imports, large campaign preparation). */
export class JobsResource {
  constructor(private readonly http: HttpClient) {}
  get(id: number): Promise<Json> { return this.http.request({ method: "GET", path: `/jobs/${enc(id)}` }); }
}

/** Contact book: everyone across your groups, addressed by E.164 phone. */
export class ContactsResource {
  constructor(private readonly http: HttpClient) {}
  list(params: { search?: string; groupId?: number; optedOut?: boolean; page?: number; limit?: number } = {}): Promise<Json> {
    return this.http.request({
      method: "GET", path: "/contacts",
      query: { search: params.search, group_id: params.groupId, page: params.page, limit: params.limit,
               opted_out: params.optedOut === undefined ? undefined : String(params.optedOut) },
    });
  }
  get(phone: string): Promise<Json> { return this.http.request({ method: "GET", path: `/contacts/${enc(phone)}` }); }
  /** Add or update a contact in one or more groups. */
  upsert(params: { phone: string; name?: string; fields?: Record<string, string>; groupIds: number[] }): Promise<Json> {
    return this.http.request({ method: "POST", path: "/contacts", body: toBody(params) });
  }
  /** Update everywhere the number appears (fields are merged). */
  update(phone: string, params: { phone?: string; name?: string; fields?: Record<string, string> }): Promise<Json> {
    return this.http.request({ method: "PATCH", path: `/contacts/${enc(phone)}`, body: toBody(params) });
  }
  /** Delete from every group (204). */
  async delete(phone: string): Promise<void> {
    await this.http.request({ method: "DELETE", path: `/contacts/${enc(phone)}` });
  }
}

/** Contact groups (lists). */
export class GroupsResource {
  constructor(private readonly http: HttpClient) {}
  list(q?: string): Promise<Json> { return this.http.request({ method: "GET", path: "/groups", query: { q } }); }
  create(name: string, tags?: string[]): Promise<Json> {
    return this.http.request({ method: "POST", path: "/groups", body: toBody({ name, tags }) });
  }
  get(id: number): Promise<Json> { return this.http.request({ method: "GET", path: `/groups/${enc(id)}` }); }
  update(id: number, params: { name?: string; tags?: string[] }): Promise<Json> {
    return this.http.request({ method: "PATCH", path: `/groups/${enc(id)}`, body: toBody(params) });
  }
  delete(id: number): Promise<Json> { return this.http.request({ method: "DELETE", path: `/groups/${enc(id)}` }); }
  contacts(id: number, params: { search?: string; page?: number; limit?: number } = {}): Promise<Json> {
    return this.http.request({ method: "GET", path: `/groups/${enc(id)}/contacts`, query: params as Q });
  }
  /** Add up to 10,000 contacts [{phone, name?, fields?}]. */
  addContacts(id: number, contacts: { phone: string; name?: string; fields?: Record<string, string> }[], defaultCountry?: string): Promise<Json> {
    return this.http.request({ method: "POST", path: `/groups/${enc(id)}/contacts`, body: toBody({ contacts, defaultCountry }) });
  }
  removeContact(id: number, phone: string): Promise<Json> {
    return this.http.request({ method: "DELETE", path: `/groups/${enc(id)}/contacts/${enc(phone)}` });
  }
}

/** Message templates with merge fields, categories and a starter pack. */
export class TemplatesResource {
  constructor(private readonly http: HttpClient) {}
  list(params: { category?: string; messageType?: string; q?: string } = {}): Promise<Json> {
    return this.http.request({ method: "GET", path: "/templates", query: { category: params.category, message_type: params.messageType, q: params.q } });
  }
  create(params: { name: string; text: string; category?: string; messageType?: "transactional" | "promotional";
                   description?: string; visibility?: "team" | "private"; senderId?: string }): Promise<Json> {
    return this.http.request({ method: "POST", path: "/templates", body: toBody(params) });
  }
  get(id: number): Promise<Json> { return this.http.request({ method: "GET", path: `/templates/${enc(id)}` }); }
  /** Partial update. */
  update(id: number, params: Record<string, unknown>): Promise<Json> {
    return this.http.request({ method: "PATCH", path: `/templates/${enc(id)}`, body: toBody(params) });
  }
  async delete(id: number): Promise<void> { await this.http.request({ method: "DELETE", path: `/templates/${enc(id)}` }); }
  starterPack(): Promise<Json> { return this.http.request({ method: "GET", path: "/templates/starter-pack" }); }
  /** Copy a starter template (e.g. "payment-reminder") into your library. */
  useStarter(key: string): Promise<Json> { return this.http.request({ method: "POST", path: `/templates/starter-pack/${enc(key)}` }); }
  /** Render a template with sample values (no send). */
  render(params: { text: string; vars?: Record<string, string>; name?: string; phone?: string }): Promise<Json> {
    return this.http.request({ method: "POST", path: "/templates/render", body: toBody(params) });
  }
}
