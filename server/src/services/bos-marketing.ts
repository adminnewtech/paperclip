import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { bosCampaign, bosAudience } from "@paperclipai/db";

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable, no DB).
// ---------------------------------------------------------------------------

/**
 * Click-through rate as a whole-number percentage of clicks over sent messages.
 * Returns 0 when nothing was sent. (`opens` is accepted for signature symmetry
 * with reporting callers but does not affect CTR over sent.)
 */
export function campaignCtr(opens: number, clicks: number, sent: number): number {
  if (sent <= 0) return 0;
  return Math.round((clicks / sent) * 100);
}

/** Size of an audience segment — the member count, floored at 0. */
export function segmentSize(members: number): number {
  return members > 0 ? members : 0;
}

// ---------------------------------------------------------------------------
// DB operations.
// ---------------------------------------------------------------------------

type CampaignRow = typeof bosCampaign.$inferSelect;
type AudienceRow = typeof bosAudience.$inferSelect;

export interface SendCampaignParams {
  companyId: string;
  campaignId: string;
}

/**
 * Simulate sending a campaign: flip status to "sent" and set sent_count to the
 * linked audience's member count. No real email/SMS is dispatched. Throws when
 * the campaign is not found.
 */
export async function sendCampaign(
  db: Db,
  params: SendCampaignParams,
): Promise<CampaignRow> {
  const { companyId, campaignId } = params;

  const [campaign] = await db
    .select()
    .from(bosCampaign)
    .where(
      and(eq(bosCampaign.id, campaignId), eq(bosCampaign.companyId, companyId)),
    );
  if (!campaign) {
    throw new Error("Campaign not found");
  }

  let memberCount = 0;
  if (campaign.audienceId) {
    const [audience] = await db
      .select({ memberCount: bosAudience.memberCount })
      .from(bosAudience)
      .where(
        and(
          eq(bosAudience.id, campaign.audienceId),
          eq(bosAudience.companyId, companyId),
        ),
      );
    memberCount = audience?.memberCount ?? 0;
  }

  const [updated] = await db
    .update(bosCampaign)
    .set({ status: "sent", sentCount: memberCount, updatedAt: new Date() })
    .where(
      and(eq(bosCampaign.id, campaignId), eq(bosCampaign.companyId, companyId)),
    )
    .returning();
  if (!updated) {
    throw new Error("Campaign not found");
  }
  return updated;
}

export interface BuildAudienceParams {
  companyId: string;
  name: string;
  description?: string | null;
  filter?: Record<string, unknown>;
  memberCount?: number;
}

/** Create an audience segment for the company. */
export async function buildAudience(
  db: Db,
  params: BuildAudienceParams,
): Promise<AudienceRow> {
  const { companyId, name, description, filter, memberCount } = params;
  const [row] = await db
    .insert(bosAudience)
    .values({
      companyId,
      name,
      description: description ?? null,
      filter: filter ?? {},
      memberCount: memberCount ?? 0,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create audience");
  }
  return row;
}
