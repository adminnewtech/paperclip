import { describe, it, expect } from "vitest";
import type { Db } from "@paperclipai/db";
import { bosCampaign, bosAudience } from "@paperclipai/db";
import { campaignCtr, segmentSize, sendCampaign } from "./bos-marketing.js";

describe("marketing", () => {
  describe("campaignCtr", () => {
    it("returns 0 when nothing was sent", () => {
      expect(campaignCtr(0, 0, 0)).toBe(0);
    });

    it("computes clicks over sent as a whole percent", () => {
      // Arrange / Act / Assert: 25 clicks of 100 sent = 25%
      expect(campaignCtr(50, 25, 100)).toBe(25);
    });

    it("rounds to the nearest whole percent", () => {
      // 1 click of 3 sent = 33.33% -> 33
      expect(campaignCtr(0, 1, 3)).toBe(33);
    });
  });

  describe("segmentSize", () => {
    it("returns the member count", () => {
      expect(segmentSize(42)).toBe(42);
    });

    it("floors negative counts at 0", () => {
      expect(segmentSize(-5)).toBe(0);
    });
  });

  describe("sendCampaign", () => {
    it("sets status=sent and sent_count to the audience member count", async () => {
      // Arrange — in-memory fake supporting the drizzle chains used by sendCampaign.
      const companyId = "company-1";
      const campaign = {
        id: "campaign-1",
        companyId,
        audienceId: "audience-1",
        status: "draft",
        sentCount: 0,
      };
      const audience = {
        id: "audience-1",
        companyId,
        memberCount: 7,
      };

      const db = {
        select(_columns?: unknown) {
          return {
            from(table: unknown) {
              return {
                where(_cond: unknown) {
                  if (table === bosCampaign) return [campaign];
                  if (table === bosAudience) return [audience];
                  return [];
                },
              };
            },
          };
        },
        update(_table: unknown) {
          return {
            set(values: { status: string; sentCount: number }) {
              return {
                where(_cond: unknown) {
                  return {
                    returning() {
                      const updated = { ...campaign, ...values };
                      return [updated];
                    },
                  };
                },
              };
            },
          };
        },
      } as unknown as Db;

      // Act
      const result = await sendCampaign(db, {
        companyId,
        campaignId: "campaign-1",
      });

      // Assert
      expect(result.status).toBe("sent");
      expect(result.sentCount).toBe(7);
    });

    it("throws when the campaign is not found", async () => {
      const db = {
        select() {
          return {
            from() {
              return {
                where() {
                  return [];
                },
              };
            },
          };
        },
      } as unknown as Db;

      await expect(
        sendCampaign(db, { companyId: "c", campaignId: "missing" }),
      ).rejects.toThrow("Campaign not found");
    });
  });
});
