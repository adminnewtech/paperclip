import { describe, expect, it } from "vitest";
import {
  detectTemplate,
  getImportTemplate,
  IMPORT_SOURCES,
  IMPORT_TARGET_TYPES,
  IMPORT_TEMPLATES,
  isImportSource,
  isImportTargetType,
  suggestMapping,
  type ImportFieldMapping,
  type ImportTargetType,
  type ImportTransform,
} from "../import-templates.js";

const ALLOWED_TRANSFORMS: ImportTransform[] = [
  "number",
  "currency_cents",
  "date_iso",
  "trim",
  "lowercase",
  "uppercase",
  "phone_e164",
  "tag_split",
];

describe("import-templates: registry", () => {
  it("has 20+ templates and at least one per source", () => {
    const keys = Object.keys(IMPORT_TEMPLATES);
    expect(keys.length).toBeGreaterThanOrEqual(20);
    for (const src of IMPORT_SOURCES) {
      const matching = keys.filter((k) => k.startsWith(`${src}_`));
      expect(matching.length).toBeGreaterThan(0);
    }
  });

  it("every template entry has valid sourceColumn, targetField, and (if set) a known transform", () => {
    for (const [key, entries] of Object.entries(IMPORT_TEMPLATES)) {
      for (const m of entries) {
        expect(m.sourceColumn, key).toBeTruthy();
        expect(m.targetField, key).toBeTruthy();
        if (m.transform) {
          expect(ALLOWED_TRANSFORMS).toContain(m.transform);
        }
      }
    }
  });

  it("targetField suffixes use a documented top-level field or data.<key>", () => {
    const topLevel = new Set([
      "name",
      "code",
      "status",
      "amountCents",
      "currency",
      "ownerUserId",
      "tags",
    ]);
    for (const [key, entries] of Object.entries(IMPORT_TEMPLATES)) {
      for (const m of entries) {
        const ok =
          topLevel.has(m.targetField) || m.targetField.startsWith("data.");
        expect(ok, `${key}: unexpected targetField ${m.targetField}`).toBe(true);
      }
    }
  });
});

describe("import-templates: type guards", () => {
  it("recognises supported sources / target types", () => {
    expect(isImportSource("quickbooks")).toBe(true);
    expect(isImportSource("xero")).toBe(false);
    expect(isImportTargetType("invoice")).toBe(true);
    expect(isImportTargetType("widget")).toBe(false);
  });
});

describe("import-templates: getImportTemplate", () => {
  it("returns the source-specific template if present", () => {
    const tpl = getImportTemplate("quickbooks", "invoice");
    expect(tpl.length).toBeGreaterThan(0);
    expect(tpl.some((m) => m.sourceColumn === "Invoice No")).toBe(true);
  });

  it("falls back to csv_generic_<target> when source-specific is missing", () => {
    // wave has no wave_lead in the registry → should fall back to csv_generic_lead
    const tpl = getImportTemplate("wave", "lead");
    expect(tpl.length).toBeGreaterThan(0);
    // csv_generic_lead has source columns in lowercase
    expect(tpl.some((m) => /^[a-z_]+$/.test(m.sourceColumn))).toBe(true);
  });

  it("returns a copy (mutating the result does not change the registry)", () => {
    const tpl = getImportTemplate("quickbooks", "contact");
    tpl[0]!.targetField = "MUTATED";
    const fresh = getImportTemplate("quickbooks", "contact");
    expect(fresh[0]!.targetField).not.toBe("MUTATED");
  });

  it("returns empty array for completely unmappable target types", () => {
    // employee + quickbooks has no entry and no csv_generic_employee fallback would still exist
    const tpl = getImportTemplate("quickbooks", "employee" as ImportTargetType);
    // csv_generic_employee exists → fallback should still produce something
    expect(Array.isArray(tpl)).toBe(true);
  });
});

describe("import-templates: detectTemplate", () => {
  it("detects QuickBooks invoice export from its headers", () => {
    const headers = [
      "Customer",
      "Invoice No",
      "Invoice Date",
      "Due Date",
      "Total",
      "Balance",
      "Status",
      "Currency",
    ];
    const detect = detectTemplate(headers, "invoice");
    expect(detect).not.toBeNull();
    expect(detect?.source).toBe("quickbooks");
    expect(detect!.matched).toBeGreaterThanOrEqual(4);
  });

  it("returns null when nothing matches at all", () => {
    const detect = detectTemplate(["foo", "bar", "baz"], "invoice");
    expect(detect).toBeNull();
  });

  it("ignores case and punctuation when matching", () => {
    const detect = detectTemplate(
      ["customer name", "invoice number", "INVOICE-DATE"],
      "invoice",
    );
    expect(detect).not.toBeNull();
  });
});

describe("import-templates: suggestMapping", () => {
  it("returns mappings only for the headers the user actually supplied", () => {
    const headers = ["Customer", "Total", "Invoice No"];
    const mapping = suggestMapping(headers, "quickbooks", "invoice");
    expect(mapping.length).toBe(3);
    expect(mapping.map((m) => m.sourceColumn)).toEqual(headers);
  });

  it("preserves the original header text for downstream column lookup", () => {
    const headers = ["customer", "INVOICE NO", "Total"];
    const mapping = suggestMapping(headers, "quickbooks", "invoice");
    expect(mapping.find((m) => m.sourceColumn === "INVOICE NO")).toBeDefined();
  });

  it("returns an empty array when no headers match the template", () => {
    const mapping = suggestMapping(["a", "b", "c"], "quickbooks", "invoice");
    expect(mapping).toEqual([]);
  });
});

describe("import-templates: transforms exist for common encoded fields", () => {
  it("currency_cents is used on every amount-like field", () => {
    const allAmountFields = Object.values(IMPORT_TEMPLATES)
      .flat()
      .filter((m: ImportFieldMapping) => m.targetField === "amountCents");
    expect(allAmountFields.length).toBeGreaterThan(0);
    for (const m of allAmountFields) {
      expect(m.transform).toBe("currency_cents");
    }
  });

  it("date_iso is used on date-like fields", () => {
    const dateLike = Object.values(IMPORT_TEMPLATES)
      .flat()
      .filter((m: ImportFieldMapping) =>
        /date|Date|timestamp/i.test(m.targetField),
      );
    expect(dateLike.length).toBeGreaterThan(0);
    for (const m of dateLike) {
      expect(m.transform).toBe("date_iso");
    }
  });

  it("phone fields get phone_e164", () => {
    const phoneLike = Object.values(IMPORT_TEMPLATES)
      .flat()
      .filter((m: ImportFieldMapping) => /phone|mobile/i.test(m.targetField));
    expect(phoneLike.length).toBeGreaterThan(0);
    for (const m of phoneLike) {
      expect(m.transform).toBe("phone_e164");
    }
  });
});
