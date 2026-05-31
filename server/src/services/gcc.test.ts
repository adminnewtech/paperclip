import { describe, it, expect } from "vitest";
import { vatRateBps, computeVat, vatReturn } from "./vat.js";
import {
  generateEInvoice,
  isB2B,
  isB2C,
  type EInvoiceInput,
} from "./zatca.js";
import { availableGateways, paymentFeeMinor, validatePayment } from "./payments.js";

describe("gcc", () => {
  // -------------------------------------------------------------------------
  // VAT engine
  // -------------------------------------------------------------------------
  describe("vatRateBps", () => {
    it("returns 1500 bps (15%) for KSA", () => {
      expect(vatRateBps("SA")).toBe(1500);
    });
    it("returns 500 bps (5%) for UAE", () => {
      expect(vatRateBps("AE")).toBe(500);
    });
    it("returns 0 bps for Kuwait", () => {
      expect(vatRateBps("KW")).toBe(0);
    });
    it("returns 0 bps for unknown countries", () => {
      expect(vatRateBps("US")).toBe(0);
      expect(vatRateBps(null)).toBe(0);
    });
  });

  describe("computeVat", () => {
    it("adds VAT on top for exclusive amounts (1000 @ 15%)", () => {
      const result = computeVat({ netMinor: 1000, country: "SA" });
      expect(result.netMinor).toBe(1000);
      expect(result.vatMinor).toBe(150);
      expect(result.grossMinor).toBe(1150);
    });

    it("extracts net + VAT from an inclusive amount (1150 incl 15%)", () => {
      const result = computeVat({
        netMinor: 1150,
        country: "SA",
        inclusive: true,
      });
      expect(result.netMinor).toBe(1000);
      expect(result.vatMinor).toBe(150);
      expect(result.grossMinor).toBe(1150);
    });

    it("returns zero VAT for Kuwait", () => {
      const result = computeVat({ netMinor: 1000, country: "KW" });
      expect(result.vatMinor).toBe(0);
      expect(result.grossMinor).toBe(1000);
    });
  });

  describe("vatReturn", () => {
    it("computes output, input, and net VAT due", () => {
      const invoices = [{ netMinor: 1000 }, { netMinor: 2000 }]; // output 150 + 300
      const bills = [{ netMinor: 1000 }]; // input 150
      const result = vatReturn(invoices, bills, "SA");
      expect(result.outputVatMinor).toBe(450);
      expect(result.inputVatMinor).toBe(150);
      expect(result.netVatDueMinor).toBe(300);
    });

    it("uses explicit vatMinor when provided", () => {
      const result = vatReturn(
        [{ netMinor: 0, vatMinor: 75 }],
        [{ netMinor: 0, vatMinor: 25 }],
        "AE",
      );
      expect(result.outputVatMinor).toBe(75);
      expect(result.inputVatMinor).toBe(25);
      expect(result.netVatDueMinor).toBe(50);
    });
  });

  // -------------------------------------------------------------------------
  // ZATCA e-invoice generation (deterministic, offline)
  // -------------------------------------------------------------------------
  describe("generateEInvoice", () => {
    const baseInvoice: EInvoiceInput = {
      number: "INV-1001",
      seq: 0,
      totalMinor: 1150,
      vatMinor: 150,
      currency: "SAR",
      sellerName: "Acme KSA",
      vatNumber: "300000000000003",
      kind: "standard_b2b",
    };

    it("is deterministic for the same inputs", () => {
      const a = generateEInvoice(baseInvoice, { previousHash: null, seq: 0 });
      const b = generateEInvoice(baseInvoice, { previousHash: null, seq: 0 });
      expect(a.uuid).toBe(b.uuid);
      expect(a.hash).toBe(b.hash);
      expect(a.qr).toBe(b.qr);
    });

    it("produces a non-empty UUID, hash, and QR", () => {
      const result = generateEInvoice(baseInvoice, {
        previousHash: null,
        seq: 0,
      });
      expect(result.uuid).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.hash.length).toBeGreaterThan(0);
      expect(result.qr.length).toBeGreaterThan(0);
    });

    it("chains the PIH: previousHash links to the prior invoice hash", () => {
      const first = generateEInvoice(baseInvoice, {
        previousHash: null,
        seq: 0,
      });
      const second = generateEInvoice(
        { ...baseInvoice, number: "INV-1002", seq: 1 },
        { previousHash: first.hash, seq: 1 },
      );
      expect(second.previousHash).toBe(first.hash);
      // Differing PIH must produce a different invoice hash.
      const secondNoChain = generateEInvoice(
        { ...baseInvoice, number: "INV-1002", seq: 1 },
        { previousHash: null, seq: 1 },
      );
      expect(second.hash).not.toBe(secondNoChain.hash);
    });

    it("clears B2B (standard) invoices", () => {
      const result = generateEInvoice(
        { ...baseInvoice, kind: "standard_b2b" },
        { previousHash: null, seq: 0 },
      );
      expect(result.status).toBe("cleared");
      expect(result.kind).toBe("standard_b2b");
    });

    it("reports B2C (simplified) invoices", () => {
      const result = generateEInvoice(
        { ...baseInvoice, kind: "simplified_b2c" },
        { previousHash: null, seq: 0 },
      );
      expect(result.status).toBe("reported");
      expect(result.kind).toBe("simplified_b2c");
    });

    it("classifies invoice kinds via isB2B / isB2C", () => {
      expect(isB2B({ ...baseInvoice, kind: "standard_b2b" })).toBe(true);
      expect(isB2C({ ...baseInvoice, kind: "simplified_b2c" })).toBe(true);
      expect(isB2B({ ...baseInvoice, kind: "simplified_b2c" })).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Payment rails
  // -------------------------------------------------------------------------
  describe("availableGateways", () => {
    it("includes knet for Kuwait", () => {
      expect(availableGateways("KW")).toContain("knet");
    });
    it("includes mada for KSA", () => {
      expect(availableGateways("SA")).toContain("mada");
    });
    it("includes tabby/tamara for UAE", () => {
      const ae = availableGateways("AE");
      expect(ae).toContain("tabby");
      expect(ae).toContain("tamara");
    });
    it("returns empty for unknown countries", () => {
      expect(availableGateways("US")).toEqual([]);
    });
  });

  describe("paymentFeeMinor", () => {
    it("is a flat fee for KNET", () => {
      expect(paymentFeeMinor({ provider: "knet", amountMinor: 10000 })).toBe(25);
      expect(paymentFeeMinor({ provider: "knet", amountMinor: 999999 })).toBe(25);
    });
    it("is a percentage for card/wallet providers", () => {
      // mada = 1.0% of 10000 = 100
      expect(paymentFeeMinor({ provider: "mada", amountMinor: 10000 })).toBe(100);
    });
    it("is deterministic", () => {
      const a = paymentFeeMinor({ provider: "tabby", amountMinor: 5000 });
      const b = paymentFeeMinor({ provider: "tabby", amountMinor: 5000 });
      expect(a).toBe(b);
    });
    it("returns 0 for unknown providers", () => {
      expect(paymentFeeMinor({ provider: "unknown", amountMinor: 1000 })).toBe(0);
    });
  });

  describe("validatePayment", () => {
    it("accepts a valid card payment", () => {
      expect(
        validatePayment({ provider: "mada", amountMinor: 5000, currency: "SAR" }).ok,
      ).toBe(true);
    });
    it("rejects unknown providers", () => {
      expect(
        validatePayment({ provider: "paypal", amountMinor: 5000, currency: "SAR" }).ok,
      ).toBe(false);
    });
    it("rejects non-positive amounts", () => {
      expect(
        validatePayment({ provider: "knet", amountMinor: 0, currency: "KWD" }).ok,
      ).toBe(false);
    });
    it("enforces BNPL minimums", () => {
      expect(
        validatePayment({ provider: "tabby", amountMinor: 100, currency: "SAR" }).ok,
      ).toBe(false);
    });
  });
});
