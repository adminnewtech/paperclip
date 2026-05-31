import { describe, expect, it } from "vitest";
import {
  revenueTrend,
  salesByModule,
  topProducts,
  topCustomers,
  kpiRollup,
  inventoryValuation,
} from "./analytics.js";

const NOW = "2026-05-31T00:00:00.000Z";

describe("analytics", () => {
  describe("revenueTrend", () => {
    it("buckets paid invoices by month and sums only paid", () => {
      const out = revenueTrend(
        [
          { status: "paid", paidMinor: 1000, issueDate: "2026-01-15T10:00:00Z" },
          { status: "paid", paidMinor: 2000, issueDate: "2026-01-20T10:00:00Z" },
          { status: "paid", paidMinor: 5000, issueDate: "2026-02-01T10:00:00Z" },
          // unpaid invoices are ignored
          { status: "draft", paidMinor: 9999, issueDate: "2026-02-10T10:00:00Z" },
        ],
        { bucket: "month", nowIso: NOW },
      );
      expect(out).toEqual([
        { period: "2026-01", revenueMinor: 3000 },
        { period: "2026-02", revenueMinor: 5000 },
      ]);
    });

    it("buckets by day when requested", () => {
      const out = revenueTrend(
        [
          { status: "paid", paidMinor: 100, issueDate: "2026-03-01T01:00:00Z" },
          { status: "paid", paidMinor: 200, issueDate: "2026-03-01T23:00:00Z" },
          { status: "paid", paidMinor: 50, issueDate: "2026-03-02T05:00:00Z" },
        ],
        { bucket: "day", nowIso: NOW },
      );
      expect(out).toEqual([
        { period: "2026-03-01", revenueMinor: 300 },
        { period: "2026-03-02", revenueMinor: 50 },
      ]);
    });
  });

  describe("salesByModule", () => {
    it("aggregates counts and totals per channel", () => {
      const out = salesByModule({
        posOrders: [{ totalMinor: 100 }, { totalMinor: 200 }],
        onlineOrders: [{ totalMinor: 500 }],
        invoices: [],
      });
      expect(out).toEqual([
        { module: "pos", count: 2, totalMinor: 300 },
        { module: "online", count: 1, totalMinor: 500 },
        { module: "manual", count: 0, totalMinor: 0 },
      ]);
    });
  });

  describe("topProducts", () => {
    it("ranks by revenue and respects the limit", () => {
      const pos = [
        {
          lines: [
            { variantId: "v1", productName: "A", qty: 2, unitPriceMinor: 100 },
            { variantId: "v2", productName: "B", qty: 1, unitPriceMinor: 1000 },
          ],
        },
      ];
      const online = [
        {
          lines: [
            { variantId: "v1", productName: "A", qty: 3, unitPriceMinor: 100 },
            { variantId: "v3", productName: "C", qty: 1, unitPriceMinor: 50 },
          ],
        },
      ];
      const out = topProducts(pos, online, 2);
      expect(out).toHaveLength(2);
      // v2 = 1000, v1 = (2+3)*100 = 500, v3 = 50 -> top two are v2, v1
      expect(out[0]).toMatchObject({ variantId: "v2", qty: 1, revenueMinor: 1000 });
      expect(out[1]).toMatchObject({ variantId: "v1", qty: 5, revenueMinor: 500 });
    });
  });

  describe("topCustomers", () => {
    it("ranks customers by total desc with order counts", () => {
      const out = topCustomers(
        [
          { customerName: "Acme", status: "paid", paidMinor: 1000 },
          { customerName: "Acme", status: "paid", paidMinor: 500 },
          { customerName: "Beta", status: "paid", paidMinor: 2000 },
          // unpaid ignored
          { customerName: "Gamma", status: "draft", paidMinor: 9999 },
        ],
        5,
      );
      expect(out).toEqual([
        { customer: "Beta", totalMinor: 2000, orders: 1 },
        { customer: "Acme", totalMinor: 1500, orders: 2 },
      ]);
    });
  });

  describe("kpiRollup", () => {
    it("computes revenue, avg order value, open deals, low stock, open tickets", () => {
      const out = kpiRollup({
        invoices: [
          { status: "paid", paidMinor: 1000 },
          { status: "paid", paidMinor: 3000 },
          { status: "draft", totalMinor: 9999 },
        ],
        deals: [
          { status: "open", amountMinor: 5000 },
          { status: "open", amountMinor: 2000 },
          { status: "won", amountMinor: 9999 },
        ],
        stock: [
          { qty: 1, reorderPoint: 5 },
          { qty: 50, reorderPoint: 5 },
          { qty: 0, reorderPoint: 0 }, // no reorder point -> not low
        ],
        tickets: [
          { status: "open" },
          { status: "pending" },
          { status: "closed" },
          { status: "resolved" },
        ],
      });
      expect(out.revenueMinor).toBe(4000);
      // avg = 4000 / 2 paid invoices = 2000
      expect(out.avgOrderValueMinor).toBe(2000);
      expect(out.openDealsValueMinor).toBe(7000);
      expect(out.lowStockCount).toBe(1);
      expect(out.openTickets).toBe(2);
    });

    it("returns zero avg order value when there are no paid invoices", () => {
      const out = kpiRollup({
        invoices: [{ status: "draft", totalMinor: 100 }],
        deals: [],
        stock: [],
        tickets: [],
      });
      expect(out.revenueMinor).toBe(0);
      expect(out.avgOrderValueMinor).toBe(0);
    });
  });

  describe("inventoryValuation", () => {
    it("totals units, cost, and retail value", () => {
      const out = inventoryValuation(
        [
          { variantId: "p1", qty: 10 },
          { variantId: "p2", qty: 5 },
          { variantId: "unknown", qty: 3 }, // no product -> units only
          { variantId: "p1", qty: -2 }, // negative ignored
        ],
        [
          { id: "p1", costMinor: 100, priceMinor: 250 },
          { id: "p2", costMinor: 400, priceMinor: 900 },
        ],
      );
      expect(out.totalUnits).toBe(18); // 10 + 5 + 3
      expect(out.totalCostMinor).toBe(10 * 100 + 5 * 400); // 3000
      expect(out.totalRetailMinor).toBe(10 * 250 + 5 * 900); // 7000
    });
  });
});
