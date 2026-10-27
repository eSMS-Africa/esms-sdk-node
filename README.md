# esms-sms

Official Node.js / TypeScript SDK for the [eSMS Africa](https://esmsafrica.io) SMS API.

Send SMS across Africa, track delivery, schedule messages, run managed OTP verification, and check your balance - with full TypeScript types and no runtime dependencies.

## Links

- Website: [esmsafrica.io](https://esmsafrica.io)
- Documentation: [docs.esmsafrica.io](https://docs.esmsafrica.io) (SDK guide: [docs.esmsafrica.io/docs/sdks](https://docs.esmsafrica.io/docs/sdks))
- SMS API overview: [esmsafrica.io/sms-api](https://esmsafrica.io/sms-api)
- Pricing (pay as you go, no setup fee): [esmsafrica.io/pricing](https://esmsafrica.io/pricing)
- Create an account and get an API key: [auth.esmsafrica.io/register](https://auth.esmsafrica.io/register?service=sms)
- Support: support@esmsafrica.io - Sales: sales@esmsafrica.io

## Install

```bash
npm install esms-sms
```

Requires Node.js 18+ (uses the built-in `fetch`).

## Quick start

```ts
import { Esms } from "esms-sms";

const esms = new Esms({ apiKey: process.env.ESMS_API_KEY! });

const res = await esms.messages.send({
  to: "+256700000000",
  text: "Your verification code is 123456",
  senderId: "eSMSAfrica", // optional - falls back to the route default
});

console.log(res.id, res.status); // "…", "submitted"
```

Get an API key from the eSMS dashboard under **Developers → API Keys**. Live keys look like `esms_live_…`; test keys look like `esms_test_…`.

## Sending

```ts
// Auto-detects the route (country) from the number.
await esms.messages.send({ to: "+254711000000", text: "Hi from Kenya" });

// Or pin a route explicitly.
await esms.messages.send({ to: "+256700000000", text: "Hi", route: "ESMS_UG" });

// Schedule for later (5 minutes to 7 days out).
await esms.messages.schedule({
  to: "+256700000000",
  text: "Reminder",
  scheduledAt: new Date(Date.now() + 3600_000), // or an ISO-8601 string
});

// Price a message before sending (no charge, no delivery).
const quote = await esms.messages.rate({ to: "+256700000000", text: "Hi" });

// Send to many numbers at once (inline recipients and/or contact lists).
const batch = await esms.messages.sendBulk({
  recipients: [{ to: "+256700000000" }, { to: "+254711000000" }],
  text: "Hello from eSMS",
});
const summary = await esms.messages.getBatch(batch.batchId);
```

`messages.send` attaches a random `Idempotency-Key` to every call so a retried request can never send or charge twice. Pass your own `idempotencyKey` to make retries safe across process restarts too.

Advanced options: `flash: true` (class-0 SMS shown on screen), `validityPeriod` (minutes, 1-4320), `priority` (0-3) and `binary: { data, udh?, dataCoding? }` (hex payload, pass `text: ""`). `sendBulk` also takes `flash`, `validityPeriod`, `priority` and `skipUnavailable: true` (drop unreachable recipients, uncharged, instead of rejecting the whole batch).

## Personalised bulk + campaigns

Requires SDK 1.2.0 or later.

```ts
// One call: a template with per-recipient merge fields. Invalid, duplicate and
// opted-out numbers come back in `rejected` and are never charged.
const batch = await esms.messages.sendBatch({
  template: "Hi {first_name|there}, your balance is UGX {balance}. Pay by {due_date}.",
  recipients: [
    { to: "+256772123456", name: "Ada Obi", vars: { balance: "1,500", due_date: "1 Nov" } },
    { to: "0701234567", vars: { balance: "200", due_date: "1 Nov" } },
  ],
  defaultCountry: "UG",          // for local numbers like 0701...
  senderId: "ACMEBANK",
  schedule: { mode: "scheduled", at: "2026-11-01T09:00", timezone: "Africa/Kampala" },
});
const status = await esms.messages.getBatch(batch.batch_id);

// Big lists: upload a CSV / Excel file, map columns, then run a campaign.
import { readFile } from "node:fs/promises";
const imp = await esms.imports.upload(await readFile("debtors.xlsx"), { filename: "debtors.xlsx", defaultCountry: "UG" });
const { job_id } = await esms.imports.process(imp.id, { mapping: { phone: "Mobile", name: "Name", fields: { "Amount Due": "amount" } } });
// poll esms.jobs.get(job_id) until status is "done"
const c = await esms.campaigns.create({ name: "October dues", text: "Hi {first_name}, you owe {amount|0}.",
  audience: [{ type: "import", id: imp.id }], idempotencyKey: "october-dues" });
await esms.campaigns.prepare(c.id);          // exact cost per country + checks
const { review } = await esms.campaigns.review(c.id);
if (review.can_launch) await esms.campaigns.launch(c.id);
const report = await esms.campaigns.report(c.id);
```

Also: `campaigns.pause/resume/cancel/retryFailed/duplicate/recipients/runs`, `contacts`, `groups`, `templates` (with `starterPack()` and `useStarter(key)`).
The signed `campaign.completed` webhook uses the same `Esms.verifyWebhook` check.

## Delivery status

```ts
const msg = await esms.messages.get(res.id);
console.log(msg.status);   // queued | submitted | delivered | failed | …
console.log(msg.timeline); // per-event delivery history

// List recent messages (filters: status, to, batchId, dateFrom, dateTo, environment)
const { messages, total } = await esms.messages.list({ limit: 20, status: "delivered" });

// Status of up to 100 messages in one call
const { messages: statuses } = await esms.messages.statuses([res.id]);

// Retry a failed one -> { id, status, retryCount }
await esms.messages.retry(res.id);
```

## Balance & routes

```ts
const bal = await esms.balance.get();
console.log(`${bal.currency} ${bal.balance} (~${bal.smsEstimate} SMS left)`);

const routes = await esms.routes.list();
for (const r of routes) {
  console.log(r.code, r.countryName, `${r.currency} ${r.pricePerSegment}/segment`);
}
```

## Verify (managed OTP)

```ts
const v = await esms.verify.start({ to: "+256700000000" }); // or { to, appId }
// ...user types the code...
const check = await esms.verify.check({ verificationId: String(v.verification_id), code: "123456" });
if (check.status === "approved") {
  // verified
}
```

Also available: `verify.get`, `verify.resend`, `verify.cancel`, `verify.list`, and Verify Apps (`listApps`, `createApp`, `getApp`, `updateApp`, `deleteApp`, `appStats`).

## Opt-outs

```ts
await esms.optOuts.add("+256700000000");
const optedOut = await esms.optOuts.list();
await esms.optOuts.remove("+256700000000");
```

## Webhooks

Delivery-report webhooks are signed with HMAC-SHA256 in the `X-Webhook-Signature` header (`sha256=<hex>`). Verify against the exact raw body:

```ts
const ok = await Esms.verifyWebhook(rawBody, req.headers["x-webhook-signature"], process.env.ESMS_WEBHOOK_SECRET!);
```

## Errors

Every failure is an `EsmsError`. Catch specific subclasses to branch:

```ts
import {
  InsufficientBalanceError,
  AuthenticationError,
  InvalidRequestError,
  EsmsError,
} from "esms-sms";

try {
  await esms.messages.send({ to: "+256700000000", text: "Hi" });
} catch (err) {
  if (err instanceof InsufficientBalanceError) {
    console.error(`Top up needed: have ${err.balance}, need ${err.cost} ${err.currency}`);
  } else if (err instanceof AuthenticationError) {
    console.error("Check your API key.");
  } else if (err instanceof EsmsError) {
    console.error(`${err.status} ${err.code}: ${err.message}`);
  }
}
```

| Class | When |
|-------|------|
| `AuthenticationError` | 401 - key missing or invalid |
| `PermissionError` | 403 - not allowed |
| `NotFoundError` | 404 - no such message |
| `InvalidRequestError` | 400 / 409 / 413 / 422 - bad request |
| `InsufficientBalanceError` | 402 - not enough credit (`.balance`, `.cost`, `.currency`) |
| `RateLimitError` | 429 - slow down |
| `ApiError` | 5xx - server error |
| `EsmsConnectionError` | network failure or timeout |

## Configuration

```ts
new Esms({
  apiKey: "esms_live_…",
  baseUrl: "https://sms.esmsafrica.io/api", // default
  timeout: 30_000,   // ms, default 30s
  maxRetries: 2,     // transient failures (network, 429, 5xx) with backoff
});
```

Requests authenticate with `Authorization: Bearer <key>`. Non-idempotent POSTs (bulk sends, retries, OTP resends) are only retried on 429, never after a 5xx or network error, so they cannot run twice.

## License

MIT © eSMS Africa
