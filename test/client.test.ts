import { describe, it, expect } from "vitest";
import {
  Esms,
  AuthenticationError,
  InsufficientBalanceError,
  NotFoundError,
  EsmsConnectionError,
  InvalidRequestError,
  RateLimitError,
  ApiError,
} from "../src/index.js";

/** Build a client backed by a scripted fake fetch. */
function clientWith(
  handler: (url: string, init: RequestInit) => { status: number; body: unknown; headers?: Record<string, string> },
) {
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const { status, body, headers } = handler(String(url), init ?? {});
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...(headers ?? {}) },
    });
  }) as unknown as typeof fetch;
  return new Esms({ apiKey: "esms_test_abc", fetch: fetchImpl, maxRetries: 0 });
}

describe("Esms", () => {
  it("requires an API key", () => {
    // @ts-expect-error intentionally missing key
    expect(() => new Esms({})).toThrow(/API key is required/);
  });

  it("accepts a bare key string", () => {
    const c = new Esms("esms_live_xyz");
    expect(c.baseUrl).toBe("https://sms.esmsafrica.io/api");
  });

  it("sends a message and maps the response", async () => {
    let seen: RequestInit | undefined;
    const esms = clientWith((url, init) => {
      seen = init;
      expect(url).toBe("https://sms.esmsafrica.io/api/messages/send");
      return {
        status: 200,
        body: {
          id: "msg_1",
          status: "submitted",
          segments: 1,
          cost: 0.4,
          cost_currency: "KES",
          route_cost: 35,
          route_currency: "UGX",
          route: "ESMS_UG",
          balance_after: 9.6,
          scheduled_at: null,
        },
      };
    });

    const res = await esms.messages.send({ to: "+256700000000", text: "Hi" });
    expect(res.id).toBe("msg_1");
    expect(res.status).toBe("submitted");
    expect(res.costCurrency).toBe("KES");
    expect(res.balanceAfter).toBe(9.6);

    const body = JSON.parse(String(seen?.body));
    expect(body).toEqual({ to: "+256700000000", text: "Hi" });
    const headers = seen?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer esms_test_abc");
    expect(headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("serialises a Date schedule to ISO", async () => {
    let body: Record<string, unknown> = {};
    const esms = clientWith((_url, init) => {
      body = JSON.parse(String(init.body));
      return { status: 200, body: { id: "m", status: "scheduled", scheduled_at: body.scheduled_at } };
    });
    const when = new Date("2026-08-01T09:00:00Z");
    await esms.messages.schedule({ to: "+256700000000", text: "x", scheduledAt: when });
    expect(body.schedule_mode).toBe("scheduled");
    expect(body.scheduled_at).toBe("2026-08-01T09:00:00.000Z");
  });

  it("raises AuthenticationError on 401", async () => {
    const esms = clientWith(() => ({ status: 401, body: { detail: "Not authenticated" } }));
    await expect(esms.messages.list()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("raises InsufficientBalanceError with the shortfall", async () => {
    const esms = clientWith(() => ({
      status: 402,
      body: {
        error: { code: "insufficient_balance", message: "Insufficient balance.", request_id: "rid" },
        detail: {
          code: "insufficient_balance",
          message: "Insufficient balance. Required KES 5, available KES 1",
          required: 5,
          available: 1,
          balance: 1,
          cost: 5,
          currency: "KES",
        },
      },
    }));
    try {
      await esms.messages.send({ to: "+256700000000", text: "x" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientBalanceError);
      const e = err as InsufficientBalanceError;
      expect(e.code).toBe("insufficient_balance");
      expect(e.balance).toBe(1);
      expect(e.cost).toBe(5);
      expect(e.currency).toBe("KES");
    }
  });

  it("raises NotFoundError on 404", async () => {
    const esms = clientWith(() => ({ status: 404, body: { detail: "Message not found" } }));
    await expect(esms.messages.get("nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("wraps network failures as EsmsConnectionError", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const esms = new Esms({ apiKey: "esms_test_abc", fetch: fetchImpl, maxRetries: 0 });
    await expect(esms.balance.get()).rejects.toBeInstanceOf(EsmsConnectionError);
  });

  it("maps routes", async () => {
    const esms = clientWith(() => ({
      status: 200,
      body: [
        {
          code: "ESMS_UG",
          name: "Uganda",
          country_code: "UG",
          country_name: "Uganda",
          currency: "UGX",
          price_per_segment: 35,
          sender_id_default: "eSMSAfrica",
          is_active: true,
        },
      ],
    }));
    const routes = await esms.routes.list();
    expect(routes[0].code).toBe("ESMS_UG");
    expect(routes[0].pricePerSegment).toBe(35);
    expect(routes[0].isActive).toBe(true);
  });

  it("reads the {error} envelope, 422 lists and rate-limit bodies", async () => {
    let esms = clientWith(() => ({
      status: 422,
      body: {
        error: { code: "validation_error", message: "Request validation failed", request_id: "r1" },
        detail: [{ loc: ["body", "to"], msg: "Field required", type: "missing" }],
      },
    }));
    const e1 = await esms.messages.send({ to: "", text: "x" }).catch((e) => e);
    expect(e1).toBeInstanceOf(InvalidRequestError);
    expect(e1.code).toBe("validation_error");
    expect(e1.message).toBe("Request validation failed: body.to: Field required");
    expect(e1.requestId).toBe("r1");

    esms = clientWith(() => ({ status: 429, body: { error: "Rate limit exceeded: 30 per 1 minute" } }));
    const e2 = await esms.balance.get().catch((e) => e);
    expect(e2).toBeInstanceOf(RateLimitError);
    expect(e2.message).toBe("Rate limit exceeded: 30 per 1 minute");

    esms = clientWith(() => ({
      status: 404,
      body: { error: { code: "not_found", message: "Message not found" }, detail: "Message not found" },
    }));
    const e3 = await esms.messages.get("x").catch((e) => e);
    expect(e3.code).toBe("not_found");
    expect(e3.message).toBe("Message not found");
  });

  it("does not retry a POST without an Idempotency-Key on 5xx", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify({ detail: "Internal server error" }), { status: 500 });
    }) as unknown as typeof fetch;
    const esms = new Esms({ apiKey: "esms_test_abc", fetch: fetchImpl, maxRetries: 2 });
    await expect(esms.messages.retry("m1")).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(1);
  });

  it("retries send (auto Idempotency-Key) with the same key", async () => {
    const keys: string[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      keys.push((init.headers as Record<string, string>)["Idempotency-Key"]);
      if (keys.length === 1) return new Response("{}", { status: 503, headers: { "retry-after": "0" } });
      return new Response(JSON.stringify({ id: "m", status: "submitted" }), { status: 200 });
    }) as unknown as typeof fetch;
    const esms = new Esms({ apiKey: "esms_test_abc", fetch: fetchImpl, maxRetries: 1 });
    const res = await esms.messages.send({ to: "+256700000000", text: "x" });
    expect(res.id).toBe("m");
    expect(keys.length).toBe(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("maps retry and bulk results and list filters", async () => {
    let lastUrl = "";
    let lastBody: Record<string, unknown> = {};
    const esms = clientWith((url, init) => {
      lastUrl = url;
      lastBody = init.body ? JSON.parse(String(init.body)) : {};
      if (url.endsWith("/retry")) return { status: 200, body: { id: "m2", status: "submitted", retry_count: 1 } };
      if (url.endsWith("/send-bulk"))
        return { status: 200, body: { batch_id: "b1", total_recipients: 2, estimated_cost: 1.5, status: "processing" } };
      return { status: 200, body: { messages: [], total: 0, page: 0, limit: 20 } };
    });
    const r = await esms.messages.retry("m1");
    expect(r).toMatchObject({ id: "m2", status: "submitted", retryCount: 1 });

    const b = await esms.messages.sendBulk({ recipients: [{ to: "+256700000000" }], text: "hi" });
    expect(b.batchId).toBe("b1");
    expect(b.totalRecipients).toBe(2);
    expect(lastBody).toEqual({ recipients: [{ to: "+256700000000" }], text: "hi" });

    await esms.messages.list({ batchId: "b1", to: "+256700000000" });
    expect(lastUrl).toContain("batch_id=b1");
    expect(lastUrl).toContain("to=%2B256700000000");
  });

  it("handles a 204 from deleteApp", async () => {
    const fetchImpl = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const esms = new Esms({ apiKey: "esms_test_abc", fetch: fetchImpl, maxRetries: 0 });
    await expect(esms.verify.deleteApp("app_1")).resolves.toBeUndefined();
  });
  it("recovers the currency of a live 402 (the API only states it in the message)", async () => {
    const esms = clientWith(() => ({
      status: 402,
      body: {
        error: { code: "insufficient_balance", message: "x", request_id: "r" },
        detail: {
          code: "insufficient_balance",
          message: "Insufficient balance. Required KES 5.0, available KES 1.0",
          required: 5,
          available: 1,
        },
      },
    }));
    const err = await esms.messages.send({ to: "+254711000000", text: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientBalanceError);
    expect(err.currency).toBe("KES");
    expect(err.balance).toBe(1);
    expect(err.cost).toBe(5);
  });

  it("does not retry a 4xx even when the error class name is minified", async () => {
    // Simulate a minifier renaming classes: the old name-based check missed this
    // and re-sent a 400 as if it were a network failure.
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify({ detail: "bad" }), { status: 400 });
    }) as unknown as typeof fetch;
    const esms = new Esms({ apiKey: "esms_test_abc", fetch: fetchImpl, maxRetries: 2 });
    const orig = Object.getOwnPropertyDescriptor(InvalidRequestError, "name");
    Object.defineProperty(InvalidRequestError, "name", { value: "q", configurable: true });
    try {
      await expect(esms.balance.get()).rejects.toBeInstanceOf(InvalidRequestError);
      expect(calls).toBe(1);
    } finally {
      if (orig) Object.defineProperty(InvalidRequestError, "name", orig);
    }
  });

  it("times out a response whose body stalls after the headers", async () => {
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () =>
          new Promise<string>((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              const e = new Error("aborted");
              e.name = "AbortError";
              reject(e);
            });
          }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const esms = new Esms({ apiKey: "esms_test_abc", fetch: fetchImpl, maxRetries: 0, timeout: 50 });
    await expect(esms.balance.get()).rejects.toThrow(/timed out/);
  });

  it("rejects a non-JSON 2xx instead of returning empty fields", async () => {
    const fetchImpl = (async () => new Response("<html>gateway</html>", { status: 200 })) as unknown as typeof fetch;
    const esms = new Esms({ apiKey: "esms_test_abc", fetch: fetchImpl, maxRetries: 0 });
    await expect(esms.balance.get()).rejects.toThrow(/non-JSON/);
  });

  it("keeps a null default sender as null and sends the advanced options", async () => {
    let body: Record<string, unknown> = {};
    const esms = clientWith((url, init) => {
      if (url.endsWith("/routes"))
        return { status: 200, body: [{ code: "ESMS_UG", name: "Uganda", country_code: "UG", country_name: "Uganda",
          currency: "UGX", price_per_segment: 30, sender_id_default: null, is_active: true, dial_code: "+256", region: "East Africa" }] };
      body = JSON.parse(String(init.body));
      return { status: 200, body: { id: "m", status: "submitted" } };
    });
    const [r] = await esms.routes.list();
    expect(r.senderIdDefault).toBeNull();
    expect(r.dialCode).toBe("+256");
    await esms.messages.send({ to: "+256700000000", text: "x", flash: true, validityPeriod: 60, priority: 1 });
    expect(body).toMatchObject({ flash: true, validity_period: 60, priority: 1 });
    await esms.messages.sendBulk({ recipients: [{ to: "+256700000000" }], text: "x", skipUnavailable: true });
    expect(body).toMatchObject({ skip_unavailable: true });
  });

  it("sends an Idempotency-Key on bulk and hits the cancel endpoints", async () => {
    const seen: { url: string; key: string | null; method: string }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const h = new Headers(init.headers);
      seen.push({ url: String(url), key: h.get("Idempotency-Key"), method: String(init.method) });
      return new Response(JSON.stringify({ batch_id: "b1", total_recipients: 1, status: "cancelled" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const esms = new Esms({ apiKey: "esms_test_abc", fetch: fetchImpl, maxRetries: 0 });
    await esms.messages.sendBulk({ recipients: [{ to: "+256700000000" }], text: "x", idempotencyKey: "k-1" });
    await esms.messages.cancel("m1");
    await esms.messages.cancelBatch("b1");
    expect(seen[0].key).toBe("k-1");
    expect(seen[1].url).toContain("/messages/m1/cancel");
    expect(seen[2].url).toContain("/messages/batch/b1/cancel");
    expect(seen[2].method).toBe("POST");
  });
});
