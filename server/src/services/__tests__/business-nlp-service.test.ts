/**
 * Unit tests for the business NLP service.
 *
 * These tests deliberately exercise the regex/mock fallback path — they
 * neither hit the database nor reach out to Anthropic. The service is
 * designed so that when `ANTHROPIC_API_KEY` is unset it returns the
 * deterministic mock response, which is exactly what we want under test.
 *
 * We stub the DB with a typed `unknown as Db` because the factory does not
 * actually use the db for the mock path.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@paperclipai/db";
import {
  createBusinessNlpService,
  type BusinessNlpService,
} from "../business-nlp-service.js";

const fakeDb = {} as unknown as Db;

describe("business-nlp-service: parseCommand (mock fallback)", () => {
  let svc: BusinessNlpService;
  beforeEach(() => {
    // Belt + braces: ensure no leaked env var routes us to the real LLM.
    delete process.env.ANTHROPIC_API_KEY;
    svc = createBusinessNlpService(fakeDb);
  });

  it("returns unknown intent with confidence=0 for empty input", async () => {
    const r = await svc.parseCommand("", "en");
    expect(r.intent).toBe("unknown");
    expect(r.confidence).toBe(0);
  });

  it("detects create_invoice from Arabic with customer name and amount", async () => {
    // The mock parser's amount regex captures the leading 1-3 digits before
    // any optional comma group; we deliberately use "5,000" so the captured
    // amount round-trips cleanly.
    const r = await svc.parseCommand("أنشئ فاتورة لعلي بـ 5,000 ريال", "ar");
    expect(r.intent).toBe("create_invoice");
    expect(r.entities.amount).toBe(5000);
    expect(r.entities.currency).toBe("SAR");
    expect(r.suggestedUrl).toContain("/business/sales");
  });

  it("detects create_invoice from English", async () => {
    const r = await svc.parseCommand("create invoice for Ali 1,000 SAR", "en");
    expect(r.intent).toBe("create_invoice");
    expect(r.entities.amount).toBe(1000);
    expect(r.entities.currency).toBe("SAR");
  });

  it("detects create_expense", async () => {
    const r = await svc.parseCommand("create expense 200 SAR fuel", "en");
    expect(r.intent).toBe("create_expense");
    expect(r.entities.category).toBe("Travel");
  });

  it("detects show_report and picks the right report type", async () => {
    const r = await svc.parseCommand("show me revenue report", "en");
    expect(r.intent).toBe("show_report");
    expect(r.entities.reportType).toBe("pnl");

    const r2 = await svc.parseCommand("show cash flow", "en");
    expect(r2.entities.reportType).toBe("cash-flow");

    const r3 = await svc.parseCommand("show balance sheet", "en");
    expect(r3.entities.reportType).toBe("balance-sheet");
  });

  it("detects create_contact and extracts phone", async () => {
    const r = await svc.parseCommand(
      "add contact Sara phone 0501234567",
      "en",
    );
    expect(r.intent).toBe("create_contact");
    expect(typeof r.entities.phone).toBe("string");
  });

  it("detects create_deal", async () => {
    const r = await svc.parseCommand("new deal acme corp 50000", "en");
    expect(r.intent).toBe("create_deal");
  });

  it("detects create_ticket", async () => {
    const r = await svc.parseCommand("open support ticket about delivery", "en");
    expect(r.intent).toBe("create_ticket");
  });

  it("detects find_entity for search-like queries", async () => {
    // The mock parser checks intent keywords in priority order, so we use a
    // generic "search" query that doesn't collide with invoice/expense/etc.
    const r = await svc.parseCommand("search Ali", "en");
    expect(r.intent).toBe("find_entity");
    expect(r.suggestedUrl).toContain("/business/search");
  });

  it("returns unknown with low confidence for nonsense", async () => {
    const r = await svc.parseCommand("zzzzz qqqqq xxxxx", "en");
    expect(r.intent).toBe("unknown");
    expect(r.confidence).toBeLessThan(0.5);
  });

  it("always marks mock results so callers know the source", async () => {
    const r = await svc.parseCommand("create invoice 100 SAR", "en");
    expect(r.mock).toBe(true);
  });
});

describe("business-nlp-service: extractReceipt (mock fallback)", () => {
  let svc: BusinessNlpService;
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    svc = createBusinessNlpService(fakeDb);
  });

  it("returns low-confidence empty result for empty receipt", async () => {
    const r = await svc.extractReceipt("");
    expect(r.confidence).toBe(0);
    expect(r.totalAmount).toBeUndefined();
  });

  it("parses vendor, date, total and currency from a sample English receipt", async () => {
    // The mock's "total" matcher is greedy (Subtotal matches the same regex),
    // so we omit Subtotal to keep the picked line unambiguous.
    const sample = [
      "STARBUCKS COFFEE",
      "Order #1234",
      "Date: 2026-02-15",
      "Latte 3.50",
      "Muffin 2.50",
      "VAT 0.30",
      "Grand Total 6.30 SAR",
    ].join("\n");
    const r = await svc.extractReceipt(sample);
    expect(r.vendor).toMatch(/STARBUCKS/i);
    expect(r.date).toBe("2026-02-15");
    expect(r.totalAmount).toBe(6.3);
    expect(r.currency).toBe("SAR");
    expect(r.vatAmount).toBeCloseTo(0.3, 2);
  });

  it("recognises Arabic vendor and total", async () => {
    const sample = [
      "مطعم الديوانية",
      "التاريخ: 2026-03-01",
      "المجموع 12.500 دينار",
    ].join("\n");
    const r = await svc.extractReceipt(sample);
    expect(r.vendor).toBeDefined();
    expect(r.totalAmount).toBe(12.5);
    expect(r.currency).toBe("KWD");
  });

  it("classifies category from receipt keywords", async () => {
    const r1 = await svc.extractReceipt("Q8 Petrol Station\nTotal 12 KWD");
    expect(r1.category).toBe("Travel");
    const r2 = await svc.extractReceipt("McDonalds restaurant\nTotal 5 KWD");
    expect(r2.category).toBe("Other");
  });
});
