import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import type {
  DocumentSource,
  DocumentType,
  IngestDocumentInput,
  RagDocument,
} from "./index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoIngestService {
  ingestProducts(companyId: string): Promise<number>;
  ingestContacts(companyId: string): Promise<number>;
  ingestResolvedTickets(companyId: string): Promise<number>;
  ingestFAQs(companyId: string): Promise<number>;
  ingestPolicies(companyId: string): Promise<number>;
  runAll(
    companyId: string,
  ): Promise<{
    products: number;
    contacts: number;
    tickets: number;
    faqs: number;
    policies: number;
  }>;
}

// Subset of the RagService we depend on. We accept it injected to avoid a
// circular import with index.ts.
interface RagAccessor {
  ingestDocument(
    companyId: string,
    input: IngestDocumentInput,
  ): Promise<RagDocument>;
  getDocument(companyId: string, documentId: string): Promise<RagDocument | null>;
  deleteDocument(companyId: string, documentId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function formatEntityAsText(
  row: typeof businessEntities.$inferSelect,
): string {
  const data = (row.data ?? {}) as Record<string, unknown>;
  const lines: string[] = [];
  if (row.name) lines.push(`Name: ${row.name}`);
  if (row.code) lines.push(`Code: ${row.code}`);
  lines.push(`Status: ${row.status}`);
  if (row.amountCents != null) {
    lines.push(`Amount: ${row.amountCents / 100} ${row.currency ?? ""}`.trim());
  }
  if (Array.isArray(row.tags) && row.tags.length > 0) {
    lines.push(`Tags: ${(row.tags as string[]).join(", ")}`);
  }
  for (const [key, value] of Object.entries(data)) {
    if (value == null || value === "") continue;
    if (typeof value === "object") {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  return lines.join("\n");
}

interface ExistingDocSummary {
  documentId: string;
  contentHash: string;
}

async function indexExistingAutoDocs(
  db: Db,
  companyId: string,
  linkedEntityType: string,
): Promise<Map<string, ExistingDocSummary>> {
  const rows = await db
    .select({
      id: businessEntities.id,
      data: businessEntities.data,
    })
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, "rag"),
        eq(businessEntities.entityType, "document"),
        sql`(${businessEntities.data} ->> 'source') = 'auto_entity'`,
        sql`(${businessEntities.data} ->> 'linkedEntityType') = ${linkedEntityType}`,
      ),
    );
  const map = new Map<string, ExistingDocSummary>();
  for (const r of rows) {
    const d = (r.data ?? {}) as {
      linkedEntityId?: string;
      contentHash?: string;
    };
    if (d.linkedEntityId) {
      map.set(d.linkedEntityId, {
        documentId: r.id,
        contentHash: d.contentHash ?? "",
      });
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createAutoIngestService(
  db: Db,
  rag: RagAccessor,
): AutoIngestService {
  async function ingestEntitiesOfType(
    companyId: string,
    moduleKey: string,
    entityTypes: string[],
    titleFn: (row: typeof businessEntities.$inferSelect) => string,
    linkedEntityType: string,
  ): Promise<number> {
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, moduleKey),
          inArray(businessEntities.entityType, entityTypes),
        ),
      )
      .limit(2000);

    if (rows.length === 0) return 0;

    const existing = await indexExistingAutoDocs(db, companyId, linkedEntityType);
    let count = 0;

    for (const row of rows) {
      const text = formatEntityAsText(row);
      const hash = sha256(text);
      const prev = existing.get(row.id);
      if (prev && prev.contentHash === hash) continue;
      // If the entity already has a doc but content changed, delete first.
      if (prev) {
        await rag.deleteDocument(companyId, prev.documentId);
      }

      const input: IngestDocumentInput = {
        title: titleFn(row),
        type: "entity" as DocumentType,
        content: text,
        source: "auto_entity" as DocumentSource,
        linkedEntityId: row.id,
        linkedEntityType,
        metadata: {
          sourceModuleKey: moduleKey,
          sourceEntityType: row.entityType,
        },
      };
      await rag.ingestDocument(companyId, input);
      count++;
    }

    return count;
  }

  async function ingestProducts(companyId: string): Promise<number> {
    return ingestEntitiesOfType(
      companyId,
      "inventory",
      ["product", "item"],
      (r) => `Product: ${r.name ?? r.code ?? r.id}`,
      "product",
    );
  }

  async function ingestContacts(companyId: string): Promise<number> {
    return ingestEntitiesOfType(
      companyId,
      "crm",
      ["contact"],
      (r) => `Contact: ${r.name ?? r.id}`,
      "contact",
    );
  }

  async function ingestResolvedTickets(companyId: string): Promise<number> {
    // Filter to resolved/closed tickets after the fact since the helper
    // takes module + entityType only.
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "helpdesk"),
          eq(businessEntities.entityType, "ticket"),
        ),
      )
      .limit(2000);

    const resolved = rows.filter(
      (r) => r.status === "resolved" || r.status === "closed",
    );
    if (resolved.length === 0) return 0;

    const existing = await indexExistingAutoDocs(
      db,
      companyId,
      "resolved_ticket",
    );
    let count = 0;
    for (const row of resolved) {
      const text = formatEntityAsText(row);
      const hash = sha256(text);
      const prev = existing.get(row.id);
      if (prev && prev.contentHash === hash) continue;
      if (prev) await rag.deleteDocument(companyId, prev.documentId);
      await rag.ingestDocument(companyId, {
        title: `Resolved Ticket: ${row.name ?? row.code ?? row.id}`,
        type: "entity",
        content: text,
        source: "auto_entity",
        linkedEntityId: row.id,
        linkedEntityType: "resolved_ticket",
        metadata: {
          sourceModuleKey: "helpdesk",
          sourceEntityType: "ticket",
          resolutionStatus: row.status,
        },
      });
      count++;
    }
    return count;
  }

  async function ingestFAQs(companyId: string): Promise<number> {
    // FAQs are represented as helpdesk:faq entities if the company uses them.
    return ingestEntitiesOfType(
      companyId,
      "helpdesk",
      ["faq"],
      (r) => `FAQ: ${r.name ?? r.code ?? r.id}`,
      "faq",
    );
  }

  async function ingestPolicies(companyId: string): Promise<number> {
    // Policies — typically stored in hr or finance modules as "policy" entities.
    let total = 0;
    const moduleKeys = ["hr", "finance", "compliance"];
    for (const mk of moduleKeys) {
      total += await ingestEntitiesOfType(
        companyId,
        mk,
        ["policy"],
        (r) => `Policy: ${r.name ?? r.code ?? r.id}`,
        "policy",
      );
    }
    return total;
  }

  async function runAll(companyId: string) {
    const [products, contacts, tickets, faqs, policies] = await Promise.all([
      ingestProducts(companyId),
      ingestContacts(companyId),
      ingestResolvedTickets(companyId),
      ingestFAQs(companyId),
      ingestPolicies(companyId),
    ]);
    return { products, contacts, tickets, faqs, policies };
  }

  return {
    ingestProducts,
    ingestContacts,
    ingestResolvedTickets,
    ingestFAQs,
    ingestPolicies,
    runAll,
  };
}
