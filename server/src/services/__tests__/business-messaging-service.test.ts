/**
 * Unit tests for the business messaging service.
 *
 * The service has two sides:
 *   (a) provider integration (WhatsApp Cloud, Twilio, Unifonic, msegat) and
 *   (b) persistence to the businessEntities table.
 *
 * Tests here focus on (a) running in mock mode and on the template-rendering
 * pathway (so we cover the path through `renderMessageTemplate`). Persistence
 * is exercised by the route-level integration tests.
 *
 * To avoid hitting Postgres we stub `db.insert(...).values(...).onConflictDoNothing()`
 * with a chainable fake. This is the minimum surface area required by
 * `send()` after sending succeeds in mock mode.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { createBusinessMessagingService } from "../business-messaging-service.js";

function chainableInsert(): unknown {
  const chain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    returning: vi.fn().mockResolvedValue([]),
  };
  return chain;
}

function fakeDb(): Db {
  const db = {
    insert: vi.fn().mockImplementation(() => chainableInsert()),
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    })),
  };
  return db as unknown as Db;
}

describe("business-messaging-service: provider status (mock mode)", () => {
  beforeEach(() => {
    delete process.env.WHATSAPP_BUSINESS_API_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.SMS_PROVIDER;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
  });

  it("reports WhatsApp as unconfigured by default", () => {
    const svc = createBusinessMessagingService(fakeDb());
    const status = svc.getProviderStatus();
    expect(status.whatsapp.configured).toBe(false);
    expect(typeof status.whatsapp.details).toBe("string");
  });

  it("reports SMS provider 'mock' when SMS_PROVIDER is unset", () => {
    const svc = createBusinessMessagingService(fakeDb());
    const status = svc.getProviderStatus();
    expect(status.sms.provider).toBe("mock");
    expect(status.sms.configured).toBe(false);
  });

  it("flags Twilio configured when all three credentials are present", () => {
    process.env.SMS_PROVIDER = "twilio";
    process.env.TWILIO_ACCOUNT_SID = "AC_test";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_FROM_NUMBER = "+10000000000";
    const svc = createBusinessMessagingService(fakeDb());
    const status = svc.getProviderStatus();
    expect(status.sms.provider).toBe("twilio");
    expect(status.sms.configured).toBe(true);
  });
});

describe("business-messaging-service: sendTemplate", () => {
  let logSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    delete process.env.WHATSAPP_BUSINESS_API_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.SMS_PROVIDER;
    // eslint-disable-next-line no-console
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy?.mockRestore();
    logSpy = null;
  });

  it("rejects unknown template keys", async () => {
    const svc = createBusinessMessagingService(fakeDb());
    const r = await svc.sendTemplate("company-1", "no_such_template", {
      channel: "sms",
      toPhone: "+96599999999",
      variables: {},
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unknown template/);
  });

  it("renders an invoice template in English and reaches the mock SMS path", async () => {
    const db = fakeDb();
    const svc = createBusinessMessagingService(db);
    const r = await svc.sendTemplate("company-1", "invoice_sent", {
      channel: "sms",
      toPhone: "+96599999999",
      variables: {
        customerName: "Ali",
        invoiceCode: "INV-1",
        amount: "1000",
        currency: "KWD",
        dueDate: "2026-12-31",
      },
      lang: "en",
    });
    expect(r.ok).toBe(true);
    expect(r.mock).toBe(true);
    // body argument is included in the console.log mock invocation
    const allLogs = (logSpy?.mock.calls ?? []).flat();
    const text = allLogs
      .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
      .join("\n");
    expect(text).toContain("Ali");
    expect(text).toContain("INV-1");
    expect(text).toContain("KWD");
    expect(db.insert).toHaveBeenCalled();
  });

  it("renders the Arabic template body when lang='ar'", async () => {
    const db = fakeDb();
    const svc = createBusinessMessagingService(db);
    await svc.sendTemplate("company-1", "payment_received", {
      channel: "sms",
      toPhone: "+96599999999",
      variables: {
        customerName: "علي",
        amount: "100",
        currency: "KWD",
        invoiceCode: "INV-1",
      },
      lang: "ar",
    });
    const text = (logSpy?.mock.calls ?? [])
      .flat()
      .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
      .join("\n");
    expect(text).toContain("علي");
  });
});
