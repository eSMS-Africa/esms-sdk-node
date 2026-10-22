import { describe, it, expect } from "vitest";
import { Esms } from "../src/index.js";

type Seen = { url: string; init: RequestInit };

function clientWith(handler: (s: Seen) => { status?: number; body: unknown }) {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const s = { url: String(url), init: init ?? {} };
    seen.push(s);
    const { status, body } = handler(s);
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status: status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { esms: new Esms({ apiKey: "esms_test_abc", fetch: fetchImpl, maxRetries: 0 }), seen };
}

const hdr = (init: RequestInit, name: string) => (init.headers as Record<string, string>)[name];

describe("v2: personalised batch + campaigns", () => {
  it("sendBatch posts snake_case, keeps vars and adds an Idempotency-Key", async () => {
    const { esms, seen } = clientWith(() => ({ status: 202, body: { batch_id: "b1", campaign_id: 7, accepted: 1, rejected: [] } }));
    const r = await esms.messages.sendBatch({
      template: "Hi {first_name}, owe {amountDue}",
      recipients: [{ to: "+256772123456", name: "Ada", vars: { amountDue: "1,500" } }],
      senderId: "ACME", throttlePerMinute: 100,
      schedule: { mode: "scheduled", at: "2026-11-01T09:00", timezone: "Africa/Kampala" },
    });
    expect(r.batch_id).toBe("b1");
    const s = seen[0];
    expect(s.url).toBe("https://sms.esmsafrica.io/api/messages/batch");
    expect(hdr(s.init, "Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    const body = JSON.parse(String(s.init.body));
    expect(body.sender_id).toBe("ACME");
    expect(body.throttle_per_minute).toBe(100);
    expect(body.recipients[0].vars.amountDue).toBe("1,500");
    expect(body.schedule.timezone).toBe("Africa/Kampala");
    expect(body.idempotency_key).toBeUndefined();
  });

  it("sendBatch honours a caller Idempotency-Key", async () => {
    const { esms, seen } = clientWith(() => ({ status: 202, body: {} }));
    await esms.messages.sendBatch({ messages: [{ to: "+1", text: "x" }], idempotencyKey: "k-1" });
    expect(hdr(seen[0].init, "Idempotency-Key")).toBe("k-1");
  });

  it("campaign lifecycle paths", async () => {
    const { esms, seen } = clientWith(() => ({ body: { id: 3, status: "ok" } }));
    await esms.campaigns.create({ name: "Dues", text: "Hi", audience: [{ type: "group", id: 2 }], idempotencyKey: "c-1" });
    await esms.campaigns.prepare(3);
    await esms.campaigns.review(3);
    await esms.campaigns.launch(3);
    await esms.campaigns.approve(3, "ok");
    await esms.campaigns.retryFailed(3);
    await esms.campaigns.recipients(3, { status: "failed", page: 1 });
    const urls = seen.map((s) => `${s.init.method} ${s.url.replace("https://sms.esmsafrica.io/api", "")}`);
    expect(urls).toEqual([
      "POST /campaigns", "POST /campaigns/3/prepare", "GET /campaigns/3/review", "POST /campaigns/3/launch",
      "POST /campaigns/3/approve", "POST /campaigns/3/retry-failed", "GET /campaigns/3/recipients?status=failed&page=1",
    ]);
    expect(hdr(seen[0].init, "Idempotency-Key")).toBe("c-1");
    expect(JSON.parse(String(seen[4].init.body))).toEqual({ note: "ok" });
  });
});

describe("v2: imports, contacts, groups, templates", () => {
  it("uploads a file as multipart", async () => {
    const { esms, seen } = clientWith(() => ({ status: 201, body: { id: "imp_1" } }));
    const r = await esms.imports.upload(new TextEncoder().encode("phone\n0772123456\n"), { filename: "a.csv", defaultCountry: "UG" });
    expect(r.id).toBe("imp_1");
    const form = seen[0].init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("default_country")).toBe("UG");
    expect((form.get("file") as File).name).toBe("a.csv");
    expect(hdr(seen[0].init, "Content-Type")).toBeUndefined();
  });

  it("processes with a mapping", async () => {
    const { esms, seen } = clientWith(() => ({ body: { job_id: 4 } }));
    await esms.imports.process("imp_1", { mapping: { phone: "Mobile", fields: { "Amount Due": "amount" } }, defaultCountry: "UG", skipOptedOut: true });
    expect(JSON.parse(String(seen[0].init.body))).toEqual({
      mapping: { phone: "Mobile", fields: { "Amount Due": "amount" } }, default_country: "UG", skip_opted_out: true,
    });
  });

  it("contacts by phone are URL-encoded; delete handles 204", async () => {
    const { esms, seen } = clientWith((s) => ({ status: s.init.method === "DELETE" ? 204 : 200, body: {} }));
    await esms.contacts.get("+256772123456");
    await esms.contacts.upsert({ phone: "+256772123456", groupIds: [1] });
    await esms.contacts.delete("+256772123456");
    expect(seen[0].url).toContain("/contacts/%2B256772123456");
    expect(JSON.parse(String(seen[1].init.body))).toEqual({ phone: "+256772123456", group_ids: [1] });
    expect(seen[2].init.method).toBe("DELETE");
  });

  it("groups and templates", async () => {
    const { esms, seen } = clientWith(() => ({ body: {} }));
    await esms.groups.addContacts(5, [{ phone: "0772123456", name: "Ada" }], "UG");
    await esms.templates.useStarter("payment-reminder");
    await esms.templates.create({ name: "T", text: "Hi {name}", messageType: "promotional" });
    expect(seen[0].url).toContain("/groups/5/contacts");
    expect(JSON.parse(String(seen[0].init.body)).default_country).toBe("UG");
    expect(seen[1].url).toContain("/templates/starter-pack/payment-reminder");
    expect(JSON.parse(String(seen[2].init.body)).message_type).toBe("promotional");
  });

  it("verifies a campaign.completed webhook with the same helper", async () => {
    const body = JSON.stringify({ event: "campaign.completed", campaign_id: 1 });
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec_x"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const sig = "sha256=" + Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(await Esms.verifyWebhook(body, sig, "whsec_x")).toBe(true);
  });
});
