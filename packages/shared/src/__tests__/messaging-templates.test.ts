import { describe, expect, it } from "vitest";
import {
  getMessageTemplate,
  MESSAGE_TEMPLATES,
  renderMessageTemplate,
  type MessageTemplate,
} from "../messaging-templates.js";

describe("messaging-templates: registry", () => {
  it("contains at least 10 templates", () => {
    expect(MESSAGE_TEMPLATES.length).toBeGreaterThanOrEqual(10);
  });

  it("every template has both EN and AR bodies plus a non-empty key/name", () => {
    for (const t of MESSAGE_TEMPLATES) {
      expect(t.key.length).toBeGreaterThan(0);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.nameAr.length).toBeGreaterThan(0);
      expect(t.bodyEn.length).toBeGreaterThan(0);
      expect(t.bodyAr.length).toBeGreaterThan(0);
    }
  });

  it("declared variables actually appear in the EN body", () => {
    for (const t of MESSAGE_TEMPLATES) {
      for (const v of t.variables) {
        expect(t.bodyEn).toContain(`{{${v}}}`);
        expect(t.bodyAr).toContain(`{{${v}}}`);
      }
    }
  });

  it("keys are unique", () => {
    const keys = MESSAGE_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("channel is one of whatsapp/sms/both", () => {
    for (const t of MESSAGE_TEMPLATES) {
      expect(["whatsapp", "sms", "both"]).toContain(t.channel);
    }
  });

  it("category is one of the documented categories", () => {
    const allowed = new Set([
      "invoice",
      "payment",
      "ticket",
      "delivery",
      "marketing",
      "general",
    ]);
    for (const t of MESSAGE_TEMPLATES) {
      expect(allowed.has(t.category)).toBe(true);
    }
  });
});

describe("messaging-templates: getMessageTemplate", () => {
  it("returns the matching template", () => {
    const inv = getMessageTemplate("invoice_sent");
    expect(inv).toBeDefined();
    expect(inv?.category).toBe("invoice");
  });

  it("returns undefined for an unknown key", () => {
    expect(getMessageTemplate("does-not-exist")).toBeUndefined();
  });
});

describe("messaging-templates: renderMessageTemplate", () => {
  const tpl: MessageTemplate = MESSAGE_TEMPLATES.find(
    (t) => t.key === "invoice_sent",
  )!;

  it("substitutes every supplied variable", () => {
    const out = renderMessageTemplate(tpl.bodyEn, {
      customerName: "Ali",
      invoiceCode: "INV-1",
      amount: "1000",
      currency: "KWD",
      dueDate: "2026-12-31",
    });
    expect(out).toContain("Ali");
    expect(out).toContain("INV-1");
    expect(out).toContain("1000");
    expect(out).toContain("KWD");
    expect(out).toContain("2026-12-31");
    expect(out).not.toContain("{{");
  });

  it("renders the Arabic body the same way", () => {
    const out = renderMessageTemplate(tpl.bodyAr, {
      customerName: "علي",
      invoiceCode: "INV-1",
      amount: "1000",
      currency: "KWD",
      dueDate: "2026-12-31",
    });
    expect(out).toContain("علي");
    expect(out).toContain("INV-1");
    expect(out).not.toContain("{{customerName}}");
  });

  it("leaves missing variables as their placeholder", () => {
    const out = renderMessageTemplate(tpl.bodyEn, {
      customerName: "Ali",
    });
    expect(out).toContain("Ali");
    expect(out).toContain("{{invoiceCode}}");
  });

  it("tolerates whitespace inside the placeholder", () => {
    const out = renderMessageTemplate("Hello {{ name }}!", { name: "Sara" });
    expect(out).toBe("Hello Sara!");
  });

  it("substitutes empty string when value is explicitly empty", () => {
    const out = renderMessageTemplate("X={{a}}", { a: "" });
    expect(out).toBe("X=");
  });
});
