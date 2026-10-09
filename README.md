# esms-sms

Official Node.js / TypeScript SDK for the [eSMS Africa](https://esmsafrica.io) SMS API.

Send SMS across Africa, track delivery, schedule messages, run managed OTP verification, and check your balance - with full TypeScript types and no runtime dependencies.

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
