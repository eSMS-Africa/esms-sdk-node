# esms-sms

Official Node.js / TypeScript SDK for the [eSMS Africa](https://esmsafrica.io) SMS API.

Send SMS across 14+ African countries, track delivery, schedule messages, and check your balance — with full TypeScript types and no runtime dependencies.

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
  senderId: "eSMSAfrica", // optional — falls back to the route default
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
```

## Delivery status

```ts
const msg = await esms.messages.get(res.id);
console.log(msg.status);   // queued | submitted | delivered | failed | …
console.log(msg.timeline); // per-event delivery history

// List recent messages
const { messages, total } = await esms.messages.list({ limit: 20, status: "delivered" });

// Retry a failed one
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
| `AuthenticationError` | 401 — key missing or invalid |
| `PermissionError` | 403 — not allowed |
| `NotFoundError` | 404 — no such message |
| `InvalidRequestError` | 400 / 422 — bad request |
| `InsufficientBalanceError` | 422 — not enough credit (`.balance`, `.cost`, `.currency`) |
| `RateLimitError` | 429 — slow down |
| `ApiError` | 5xx — server error |
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

## License

MIT © eSMS Africa
