import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { bosLead, bosDeal, bosPipelineStage, bosQuote } from "@paperclipai/db";

// ---------------------------------------------------------------------------
// Pure helpers (exported, unit-testable, no DB).
// ---------------------------------------------------------------------------

export interface ScorableLead {
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  source?: string | null;
}

/** Weighting of known lead sources toward the lead score (0-40). */
const SOURCE_SCORES: Record<string, number> = {
  referral: 40,
  website: 30,
  event: 25,
  inbound: 25,
  ad: 15,
  ads: 15,
  social: 10,
  cold: 5,
  other: 0,
};

const SCORE_MAX = 100;
const POINTS_EMAIL = 20;
const POINTS_PHONE = 20;
const POINTS_COMPANY = 20;

/**
 * Compute a 0-100 lead score from contactability + source quality. Presence of
 * an email, phone and company name each add fixed points; the source adds a
 * weighted bonus. Result is clamped to [0, 100].
 */
export function scoreLead(lead: ScorableLead): number {
  let score = 0;
  if (lead.email && lead.email.trim().length > 0) score += POINTS_EMAIL;
  if (lead.phone && lead.phone.trim().length > 0) score += POINTS_PHONE;
  if (lead.companyName && lead.companyName.trim().length > 0) score += POINTS_COMPANY;

  const source = (lead.source ?? "").trim().toLowerCase();
  if (source) {
    score += SOURCE_SCORES[source] ?? SOURCE_SCORES.other;
  }

  if (score < 0) return 0;
  if (score > SCORE_MAX) return SCORE_MAX;
  return score;
}

export interface QuoteLineInput {
  description?: string | null;
  qty?: number | null;
  unitPriceMinor?: number | null;
}

export interface QuoteTotals {
  subtotal: number;
  tax: number;
  total: number;
}

/**
 * Compute quote totals from line items and a tax rate (percent). Each line's
 * contribution is qty * unitPriceMinor; tax is applied on the subtotal. All
 * values are integer minor units.
 */
export function quoteTotals(
  lines: QuoteLineInput[],
  taxRatePct = 0,
): QuoteTotals {
  const subtotal = lines.reduce((sum, line) => {
    const qty = Number(line.qty ?? 0);
    const unit = Number(line.unitPriceMinor ?? 0);
    return sum + Math.round(qty * unit);
  }, 0);
  const tax = Math.round((subtotal * (Number(taxRatePct) || 0)) / 100);
  return { subtotal, tax, total: subtotal + tax };
}

/** Per-line total in minor units (qty * unitPriceMinor). */
export function quoteLineTotal(line: QuoteLineInput): number {
  return Math.round(Number(line.qty ?? 0) * Number(line.unitPriceMinor ?? 0));
}

export interface ConvertibleLead {
  id: string;
  name: string;
  companyName?: string | null;
  score?: number | null;
  ownerUserId?: string | null;
}

export interface PipelineRef {
  id: string;
}

export interface StageRef {
  id: string;
}

export interface DealPayload {
  name: string;
  pipelineId: string;
  stageId: string;
  customerName: string | null;
  contactId: string;
  status: "open";
  score: number;
  ownerUserId: string | null;
}

/**
 * Build the deal payload produced when converting a lead. The new deal opens
 * in the pipeline's first stage, carries the lead's score and owner, and links
 * back to the lead via contactId.
 */
export function convertLeadToDeal(
  lead: ConvertibleLead,
  pipeline: PipelineRef,
  firstStage: StageRef,
): DealPayload {
  return {
    name: lead.companyName?.trim() || lead.name,
    pipelineId: pipeline.id,
    stageId: firstStage.id,
    customerName: lead.companyName ?? lead.name,
    contactId: lead.id,
    status: "open",
    score: lead.score ?? 0,
    ownerUserId: lead.ownerUserId ?? null,
  };
}

// ---------------------------------------------------------------------------
// DB ops.
// ---------------------------------------------------------------------------

type LeadRow = typeof bosLead.$inferSelect;
type DealRow = typeof bosDeal.$inferSelect;
type QuoteRow = typeof bosQuote.$inferSelect;

export interface ConvertLeadParams {
  companyId: string;
  leadId: string;
  pipelineId: string;
}

export interface ConvertLeadResult {
  lead: LeadRow;
  deal: DealRow;
}

/**
 * Convert a lead into an open deal. In a single transaction: load the lead and
 * the pipeline's first stage (lowest sort), create the deal in that stage, and
 * flip the lead status to "converted".
 */
export async function convertLead(
  db: Db,
  params: ConvertLeadParams,
): Promise<ConvertLeadResult> {
  const { companyId, leadId, pipelineId } = params;

  return db.transaction(async (tx) => {
    const [lead] = await tx.select().from(bosLead).where(eq(bosLead.id, leadId));
    if (!lead || lead.companyId !== companyId) {
      throw new Error("Lead not found");
    }

    const stages = await tx
      .select()
      .from(bosPipelineStage)
      .where(eq(bosPipelineStage.pipelineId, pipelineId));
    const companyStages = stages.filter((s) => s.companyId === companyId);
    if (companyStages.length === 0) {
      throw new Error("Pipeline has no stages");
    }
    const firstStage = [...companyStages].sort((a, b) => a.sort - b.sort)[0]!;

    const payload = convertLeadToDeal(
      {
        id: lead.id,
        name: lead.name,
        companyName: lead.companyName,
        score: lead.score,
        ownerUserId: lead.ownerUserId,
      },
      { id: pipelineId },
      { id: firstStage.id },
    );

    const [deal] = await tx
      .insert(bosDeal)
      .values({
        companyId,
        name: payload.name,
        pipelineId: payload.pipelineId,
        stageId: payload.stageId,
        customerName: payload.customerName,
        contactId: payload.contactId,
        status: payload.status,
        score: payload.score,
        ownerUserId: payload.ownerUserId,
      })
      .returning();
    if (!deal) {
      throw new Error("Failed to create deal");
    }

    const [updatedLead] = await tx
      .update(bosLead)
      .set({ status: "converted", updatedAt: new Date() })
      .where(eq(bosLead.id, lead.id))
      .returning();
    if (!updatedLead) {
      throw new Error("Failed to update lead");
    }

    return { lead: updatedLead, deal };
  });
}

export interface MoveDealStageParams {
  companyId: string;
  dealId: string;
  stageId: string;
}

/**
 * Move a deal to a different stage. The deal's status is derived from the
 * target stage: a won stage -> "won", a lost stage -> "lost", otherwise the
 * deal stays "open".
 */
export async function moveDealStage(
  db: Db,
  params: MoveDealStageParams,
): Promise<DealRow> {
  const { companyId, dealId, stageId } = params;

  return db.transaction(async (tx) => {
    const [deal] = await tx.select().from(bosDeal).where(eq(bosDeal.id, dealId));
    if (!deal || deal.companyId !== companyId) {
      throw new Error("Deal not found");
    }

    const [stage] = await tx
      .select()
      .from(bosPipelineStage)
      .where(eq(bosPipelineStage.id, stageId));
    if (!stage || stage.companyId !== companyId) {
      throw new Error("Stage not found");
    }

    const status = stage.isWon ? "won" : stage.isLost ? "lost" : "open";

    const [updated] = await tx
      .update(bosDeal)
      .set({ stageId: stage.id, status, updatedAt: new Date() })
      .where(eq(bosDeal.id, deal.id))
      .returning();
    if (!updated) {
      throw new Error("Failed to update deal");
    }
    return updated;
  });
}

export interface AcceptQuoteParams {
  companyId: string;
  quoteId: string;
}

/**
 * Accept a quote: flip its status to "accepted". Cross-service invoice creation
 * is intentionally left out to keep finance and CRM decoupled.
 */
export async function acceptQuote(
  db: Db,
  params: AcceptQuoteParams,
): Promise<QuoteRow> {
  const { companyId, quoteId } = params;

  return db.transaction(async (tx) => {
    const [quote] = await tx
      .select()
      .from(bosQuote)
      .where(eq(bosQuote.id, quoteId));
    if (!quote || quote.companyId !== companyId) {
      throw new Error("Quote not found");
    }

    const [updated] = await tx
      .update(bosQuote)
      .set({ status: "accepted", updatedAt: new Date() })
      .where(eq(bosQuote.id, quote.id))
      .returning();
    if (!updated) {
      throw new Error("Failed to update quote");
    }
    return updated;
  });
}
