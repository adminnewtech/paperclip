import { describe, expect, it } from "vitest";
import {
  reorderSuggestions,
  cashPosition,
  dealForecast,
  churnRisk,
  overdueInvoices,
  slaBreaches,
  buildBriefing,
  type BriefingMetrics,
} from "./insights.js";

const NOW = "2026-05-31T00:00:00.000Z";

function daysBefore(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() - days * 86_400_000).toISOString();
}

describe("insights", () => {
  describe("reorderSuggestions", () => {
    it("flags rows at or below the reorder point", () => {
      const out = reorderSuggestions([
        { variantId: "v1", warehouseId: "w1", qty: 5, reorderPoint: 10 },
        { variantId: "v2", warehouseId: "w1", qty: 50, reorderPoint: 10 },
      ]);
      expect(out).toHaveLength(1);
      expect(out[0]?.kind).toBe("reorder");
      expect(out[0]?.severity).toBe("warning");
      // reorderPoint*2 - qty = 20 - 5 = 15
      expect(out[0]?.data.suggestedQty).toBe(15);
    });

    it("marks a depleted row (qty <= 0) as critical", () => {
      const out = reorderSuggestions([
        { variantId: "v3", warehouseId: "w1", qty: 0, reorderPoint: 8 },
      ]);
      expect(out).toHaveLength(1);
      expect(out[0]?.severity).toBe("critical");
      expect(out[0]?.data.suggestedQty).toBe(16);
    });

    it("ignores rows with no reorder point", () => {
      expect(
        reorderSuggestions([{ qty: 0, reorderPoint: 0 }]),
      ).toHaveLength(0);
    });
  });

  describe("cashPosition", () => {
    it("computes receivable, payable, net and overdue", () => {
      const result = cashPosition(
        {
          invoices: [
            // outstanding 700, overdue (due in past)
            {
              totalMinor: 1000,
              paidMinor: 300,
              status: "sent",
              dueDate: daysBefore(NOW, 10),
            },
            // outstanding 500, not overdue (future due date)
            {
              totalMinor: 500,
              paidMinor: 0,
              status: "sent",
              dueDate: daysBefore(NOW, -10),
            },
            // fully paid -> ignored
            { totalMinor: 200, paidMinor: 200, status: "paid", dueDate: null },
          ],
          bills: [
            { totalMinor: 400, paidMinor: 100, status: "sent" }, // outstanding 300
          ],
        },
        NOW,
      );
      expect(result.totalReceivableMinor).toBe(1200); // 700 + 500
      expect(result.totalPayableMinor).toBe(300);
      expect(result.netMinor).toBe(900); // 1200 - 300
      expect(result.overdueReceivableMinor).toBe(700);
    });
  });

  describe("dealForecast", () => {
    it("computes weighted pipeline = Σ amount * prob over open deals", () => {
      const stages = [
        { id: "s1", name: "Proposal", winProbability: 50 },
        { id: "s2", name: "Negotiation", winProbability: 80 },
      ];
      const deals = [
        { id: "d1", amountMinor: 1000, stageId: "s1", status: "open" }, // 500
        { id: "d2", amountMinor: 1000, stageId: "s2", status: "open" }, // 800
        { id: "d3", amountMinor: 9999, stageId: "s2", status: "won" }, // excluded
      ];
      const out = dealForecast(deals, stages);
      expect(out.openCount).toBe(2);
      expect(out.weightedMinor).toBe(1300);
      expect(out.byStage).toHaveLength(2);
    });

    it("treats unknown-stage open deals as 0% probability", () => {
      const out = dealForecast(
        [{ id: "d1", amountMinor: 1000, stageId: null, status: "open" }],
        [],
      );
      expect(out.openCount).toBe(1);
      expect(out.weightedMinor).toBe(0);
    });
  });

  describe("churnRisk", () => {
    it("flags a customer whose last invoice is older than 90 days", () => {
      const out = churnRisk(
        [{ id: "c1", name: "Acme" }],
        [
          {
            customerId: "c1",
            customerName: "Acme",
            issueDate: daysBefore(NOW, 120),
          },
        ],
        NOW,
      );
      expect(out).toHaveLength(1);
      expect(out[0]?.kind).toBe("churn_risk");
      expect(out[0]?.data.customerId).toBe("c1");
    });

    it("does not flag a customer with a recent invoice", () => {
      const out = churnRisk(
        [{ id: "c1", name: "Acme" }],
        [
          {
            customerId: "c1",
            customerName: "Acme",
            issueDate: daysBefore(NOW, 10),
          },
        ],
        NOW,
      );
      expect(out).toHaveLength(0);
    });

    it("flags a customer with no invoices at all", () => {
      const out = churnRisk([{ id: "c2", name: "Globex" }], [], NOW);
      expect(out).toHaveLength(1);
      expect(out[0]?.data.lastInvoiceAt).toBeNull();
    });
  });

  describe("overdueInvoices", () => {
    it("flags unpaid invoices past their due date", () => {
      const out = overdueInvoices(
        [
          {
            id: "i1",
            number: "INV-1",
            customerName: "Acme",
            totalMinor: 1000,
            paidMinor: 0,
            status: "sent",
            dueDate: daysBefore(NOW, 5),
          },
        ],
        NOW,
      );
      expect(out).toHaveLength(1);
      expect(out[0]?.severity).toBe("warning");
      expect(out[0]?.data.daysOverdue).toBe(5);
    });

    it("escalates to critical past 30 days overdue", () => {
      const out = overdueInvoices(
        [
          {
            id: "i2",
            totalMinor: 1000,
            paidMinor: 0,
            status: "sent",
            dueDate: daysBefore(NOW, 45),
          },
        ],
        NOW,
      );
      expect(out[0]?.severity).toBe("critical");
    });

    it("ignores paid / future-due invoices", () => {
      const out = overdueInvoices(
        [
          { totalMinor: 1000, paidMinor: 1000, status: "paid", dueDate: daysBefore(NOW, 10) },
          { totalMinor: 1000, paidMinor: 0, status: "sent", dueDate: daysBefore(NOW, -10) },
        ],
        NOW,
      );
      expect(out).toHaveLength(0);
    });
  });

  describe("slaBreaches", () => {
    it("flags open tickets past their SLA due time", () => {
      const out = slaBreaches(
        [
          {
            id: "t1",
            number: "T-1",
            subject: "Broken widget",
            status: "open",
            slaDueAt: daysBefore(NOW, 2),
          },
        ],
        NOW,
      );
      expect(out).toHaveLength(1);
      expect(out[0]?.kind).toBe("sla_breach");
      expect(out[0]?.severity).toBe("critical"); // > 24h
    });

    it("ignores resolved tickets and tickets within SLA", () => {
      const out = slaBreaches(
        [
          { id: "t2", status: "resolved", slaDueAt: daysBefore(NOW, 5) },
          { id: "t3", status: "open", slaDueAt: daysBefore(NOW, -1) },
        ],
        NOW,
      );
      expect(out).toHaveLength(0);
    });
  });

  describe("buildBriefing", () => {
    it("produces a summary containing the key numbers", () => {
      const metrics: BriefingMetrics = {
        revenueMinor: 5_000_000,
        openDeals: 3,
        weightedPipelineMinor: 12_345_000,
        lowStockCount: 2,
        overdueCount: 1,
        openTickets: 4,
        cashNetMinor: 900_000,
      };
      const briefing = buildBriefing({
        company: { name: "NewTech", currency: "KWD" },
        metrics,
        insights: [
          {
            kind: "reorder",
            severity: "critical",
            title: "Out of stock",
            detail: "",
            data: {},
          },
        ],
      });
      expect(briefing.summary).toContain("3 open deals");
      expect(briefing.summary).toContain("2 low-stock items");
      expect(briefing.summary).toContain("1 overdue invoices");
      expect(briefing.summary).toContain("4 open tickets");
      expect(briefing.summary).toContain("NewTech");
      expect(briefing.summary).toContain("critical");
      expect(briefing.alerts).toHaveLength(1);
    });

    it("reports all clear when there are no alerts", () => {
      const metrics: BriefingMetrics = {
        revenueMinor: 0,
        openDeals: 0,
        weightedPipelineMinor: 0,
        lowStockCount: 0,
        overdueCount: 0,
        openTickets: 0,
        cashNetMinor: 0,
      };
      const briefing = buildBriefing({ metrics, insights: [] });
      expect(briefing.summary).toContain("No alerts");
      expect(briefing.alerts).toHaveLength(0);
    });
  });
});
