import { describe, it, expect } from "vitest";
import {
  Esms,
  AuthenticationError,
  InsufficientBalanceError,
  NotFoundError,
  EsmsConnectionError,
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
      status: 422,
      body: {
        detail: {
          code: "insufficient_balance",
          message: "Balance KES 1 < cost KES 5",
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
});
