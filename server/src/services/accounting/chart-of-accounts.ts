/**
 * Chart of Accounts service.
 *
 * Manages the canonical list of accounts a company books transactions into.
 * Accounts are stored as businessEntities rows with:
 *  - moduleKey: "accounting"
 *  - entityType: "account"
 *  - code: the account number ("1000", "1110", ...)
 *
 * The "type" / "subtype" / "isSystem" / etc. flags live inside the JSONB
 * `data` column.
 */

import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import type {
  AccountSubtype,
  AccountType,
  ChartOfAccount,
} from "@paperclipai/shared";

// ---------------------------------------------------------------------------
// Default chart of accounts
// ---------------------------------------------------------------------------

export interface AccountSeed {
  code: string;
  name: string;
  nameAr: string;
  type: AccountType;
  subtype: AccountSubtype;
  parentCode?: string;
  description?: string;
  isSystem?: boolean;
}

/**
 * Default ~50-account chart following standard small-business accounting
 * structure. Codes follow the 1xxx (assets) / 2xxx (liabilities) /
 * 3xxx (equity) / 4xxx (revenue) / 5xxx (COGS) / 6xxx (operating expenses) /
 * 7xxx (other) hierarchy.
 */
export const DEFAULT_CHART_OF_ACCOUNTS: AccountSeed[] = [
  // ── Assets ────────────────────────────────────────────────────────────
  { code: "1000", name: "Assets", nameAr: "الأصول", type: "asset", subtype: "other_asset", isSystem: true },
  { code: "1100", name: "Current Assets", nameAr: "الأصول المتداولة", type: "asset", subtype: "other_current_asset", parentCode: "1000", isSystem: true },
  { code: "1110", name: "Cash on Hand", nameAr: "النقد في الصندوق", type: "asset", subtype: "cash", parentCode: "1100", isSystem: true },
  { code: "1120", name: "Bank Account (Operating)", nameAr: "حساب البنك (التشغيلي)", type: "asset", subtype: "bank", parentCode: "1100", isSystem: true },
  { code: "1130", name: "Accounts Receivable", nameAr: "الذمم المدينة", type: "asset", subtype: "accounts_receivable", parentCode: "1100", isSystem: true },
  { code: "1140", name: "Inventory", nameAr: "المخزون", type: "asset", subtype: "inventory", parentCode: "1100" },
  { code: "1150", name: "Prepaid Expenses", nameAr: "المصروفات المدفوعة مقدماً", type: "asset", subtype: "other_current_asset", parentCode: "1100" },
  { code: "1160", name: "Other Current Assets", nameAr: "أصول متداولة أخرى", type: "asset", subtype: "other_current_asset", parentCode: "1100" },
  { code: "1200", name: "Fixed Assets", nameAr: "الأصول الثابتة", type: "asset", subtype: "fixed_asset", parentCode: "1000", isSystem: true },
  { code: "1210", name: "Equipment", nameAr: "المعدات", type: "asset", subtype: "fixed_asset", parentCode: "1200" },
  { code: "1220", name: "Furniture & Fixtures", nameAr: "الأثاث والتركيبات", type: "asset", subtype: "fixed_asset", parentCode: "1200" },
  { code: "1230", name: "Accumulated Depreciation", nameAr: "مجمع الإهلاك", type: "asset", subtype: "fixed_asset", parentCode: "1200", description: "Contra-asset" },

  // ── Liabilities ───────────────────────────────────────────────────────
  { code: "2000", name: "Liabilities", nameAr: "الالتزامات", type: "liability", subtype: "other_current_liability", isSystem: true },
  { code: "2100", name: "Current Liabilities", nameAr: "الالتزامات المتداولة", type: "liability", subtype: "other_current_liability", parentCode: "2000", isSystem: true },
  { code: "2110", name: "Accounts Payable", nameAr: "الذمم الدائنة", type: "liability", subtype: "accounts_payable", parentCode: "2100", isSystem: true },
  { code: "2120", name: "Credit Card", nameAr: "بطاقة الائتمان", type: "liability", subtype: "credit_card", parentCode: "2100" },
  { code: "2130", name: "VAT Payable", nameAr: "ضريبة القيمة المضافة المستحقة", type: "liability", subtype: "other_current_liability", parentCode: "2100", isSystem: true },
  { code: "2140", name: "Salaries Payable", nameAr: "الرواتب المستحقة", type: "liability", subtype: "other_current_liability", parentCode: "2100" },
  { code: "2150", name: "Accrued Expenses", nameAr: "المصروفات المستحقة", type: "liability", subtype: "other_current_liability", parentCode: "2100" },
  { code: "2200", name: "Long-term Liabilities", nameAr: "الالتزامات طويلة الأجل", type: "liability", subtype: "long_term_liability", parentCode: "2000" },
  { code: "2210", name: "Loans Payable", nameAr: "القروض المستحقة", type: "liability", subtype: "loan", parentCode: "2200" },

  // ── Equity ────────────────────────────────────────────────────────────
  { code: "3000", name: "Equity", nameAr: "حقوق الملكية", type: "equity", subtype: "common_stock", isSystem: true },
  { code: "3100", name: "Owner's Capital", nameAr: "رأس مال المالك", type: "equity", subtype: "common_stock", parentCode: "3000", isSystem: true },
  { code: "3200", name: "Retained Earnings", nameAr: "الأرباح المحتجزة", type: "equity", subtype: "retained_earnings", parentCode: "3000", isSystem: true },
  { code: "3300", name: "Owner's Drawing", nameAr: "مسحوبات المالك", type: "equity", subtype: "drawing", parentCode: "3000" },

  // ── Revenue ───────────────────────────────────────────────────────────
  { code: "4000", name: "Revenue", nameAr: "الإيرادات", type: "revenue", subtype: "operating_revenue", isSystem: true },
  { code: "4100", name: "Sales Revenue", nameAr: "إيرادات المبيعات", type: "revenue", subtype: "operating_revenue", parentCode: "4000", isSystem: true },
  { code: "4200", name: "Service Revenue", nameAr: "إيرادات الخدمات", type: "revenue", subtype: "operating_revenue", parentCode: "4000" },
  { code: "4900", name: "Other Revenue", nameAr: "إيرادات أخرى", type: "revenue", subtype: "other_revenue", parentCode: "4000" },

  // ── Cost of Goods Sold ────────────────────────────────────────────────
  { code: "5000", name: "Cost of Goods Sold", nameAr: "تكلفة البضاعة المباعة", type: "expense", subtype: "cogs", isSystem: true },
  { code: "5100", name: "Cost of Goods Sold", nameAr: "تكلفة البضاعة المباعة", type: "expense", subtype: "cogs", parentCode: "5000", isSystem: true },

  // ── Operating Expenses ────────────────────────────────────────────────
  { code: "6000", name: "Operating Expenses", nameAr: "المصروفات التشغيلية", type: "expense", subtype: "operating_expense", isSystem: true },
  { code: "6100", name: "Salaries & Wages", nameAr: "الرواتب والأجور", type: "expense", subtype: "payroll_expense", parentCode: "6000" },
  { code: "6200", name: "Rent", nameAr: "الإيجار", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6300", name: "Utilities", nameAr: "المرافق", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6400", name: "Office Supplies", nameAr: "اللوازم المكتبية", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6500", name: "Marketing & Advertising", nameAr: "التسويق والإعلان", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6600", name: "Insurance", nameAr: "التأمين", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6700", name: "Professional Fees", nameAr: "الأتعاب المهنية", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6800", name: "Travel & Entertainment", nameAr: "السفر والترفيه", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6900", name: "Bank Charges", nameAr: "الرسوم البنكية", type: "expense", subtype: "operating_expense", parentCode: "6000" },
  { code: "6950", name: "Depreciation Expense", nameAr: "مصروف الإهلاك", type: "expense", subtype: "operating_expense", parentCode: "6000" },

  // ── Other Expenses ────────────────────────────────────────────────────
  { code: "7000", name: "Other Expenses", nameAr: "مصروفات أخرى", type: "expense", subtype: "other_expense" },
  { code: "7100", name: "Interest Expense", nameAr: "مصروف الفوائد", type: "expense", subtype: "other_expense", parentCode: "7000" },
  { code: "7200", name: "Tax Expense", nameAr: "مصروف الضرائب", type: "expense", subtype: "tax_expense", parentCode: "7000" },
];

// ---------------------------------------------------------------------------
// Account row helpers (row → ChartOfAccount)
// ---------------------------------------------------------------------------

interface AccountDataPayload {
  type?: AccountType;
  subtype?: AccountSubtype;
  nameAr?: string;
  parentCode?: string | null;
  description?: string;
  isSystem?: boolean;
}

function rowToAccount(row: {
  id: string;
  code: string | null;
  name: string | null;
  status: string;
  currency: string | null;
  amountCents: number | null;
  data: unknown;
}): ChartOfAccount {
  const data = (row.data ?? {}) as AccountDataPayload;
  return {
    id: row.id,
    code: row.code ?? "",
    name: row.name ?? "",
    nameAr: data.nameAr ?? "",
    type: data.type ?? "asset",
    subtype: data.subtype ?? "other_asset",
    parentCode: data.parentCode ?? undefined,
    description: data.description ?? undefined,
    isActive: row.status !== "inactive",
    isSystem: data.isSystem === true,
    currency: row.currency ?? "KWD",
    balanceCents: row.amountCents ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface ChartOfAccountsService {
  listAccounts(companyId: string): Promise<ChartOfAccount[]>;
  getAccount(companyId: string, code: string): Promise<ChartOfAccount | null>;
  createAccount(
    companyId: string,
    input: AccountSeed & { currency?: string; actorId?: string | null },
  ): Promise<ChartOfAccount>;
  updateAccount(
    companyId: string,
    code: string,
    patch: Partial<Omit<AccountSeed, "code">> & { isActive?: boolean; actorId?: string | null },
  ): Promise<ChartOfAccount | null>;
  deleteAccount(companyId: string, code: string): Promise<boolean>;
  seedDefaults(
    companyId: string,
    currency: string,
    actorId?: string | null,
  ): Promise<{ created: number; skipped: number }>;
}

export function createChartOfAccountsService(db: Db): ChartOfAccountsService {
  return {
    async listAccounts(companyId) {
      const rows = await db
        .select()
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "accounting"),
            eq(businessEntities.entityType, "account"),
          ),
        )
        .orderBy(businessEntities.code);
      return rows.map(rowToAccount);
    },

    async getAccount(companyId, code) {
      const [row] = await db
        .select()
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "accounting"),
            eq(businessEntities.entityType, "account"),
            eq(businessEntities.code, code),
          ),
        )
        .limit(1);
      return row ? rowToAccount(row) : null;
    },

    async createAccount(companyId, input) {
      const now = new Date();
      const data: AccountDataPayload = {
        type: input.type,
        subtype: input.subtype,
        nameAr: input.nameAr,
        parentCode: input.parentCode ?? null,
        description: input.description,
        isSystem: input.isSystem === true,
      };
      const [row] = await db
        .insert(businessEntities)
        .values({
          companyId,
          moduleKey: "accounting",
          entityType: "account",
          code: input.code,
          name: input.name,
          status: "active",
          currency: input.currency ?? "KWD",
          amountCents: 0,
          data: data as Record<string, unknown>,
          tags: [],
          createdByUserId: input.actorId ?? null,
          updatedByUserId: input.actorId ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!row) {
        throw new Error("Failed to create account");
      }
      return rowToAccount(row);
    },

    async updateAccount(companyId, code, patch) {
      const existing = await this.getAccount(companyId, code);
      if (!existing) return null;
      const newData: AccountDataPayload = {
        type: patch.type ?? existing.type,
        subtype: patch.subtype ?? existing.subtype,
        nameAr: patch.nameAr ?? existing.nameAr,
        parentCode:
          patch.parentCode !== undefined ? patch.parentCode ?? null : existing.parentCode,
        description:
          patch.description !== undefined ? patch.description : existing.description,
        isSystem: existing.isSystem, // immutable
      };
      // Block type/subtype changes on system accounts to avoid breaking
      // statement layouts.
      if (existing.isSystem && patch.type && patch.type !== existing.type) {
        throw new Error("System accounts cannot change type.");
      }
      const now = new Date();
      const [row] = await db
        .update(businessEntities)
        .set({
          name: patch.name ?? existing.name,
          status: patch.isActive === false ? "inactive" : "active",
          data: newData as Record<string, unknown>,
          updatedByUserId: patch.actorId ?? null,
          updatedAt: now,
        })
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "accounting"),
            eq(businessEntities.entityType, "account"),
            eq(businessEntities.code, code),
          ),
        )
        .returning();
      return row ? rowToAccount(row) : null;
    },

    async deleteAccount(companyId, code) {
      const existing = await this.getAccount(companyId, code);
      if (!existing) return false;
      if (existing.isSystem) {
        throw new Error("System accounts cannot be deleted.");
      }
      // Don't delete accounts with posted journal lines — verify by scanning
      // for entries that reference this code.
      const journalRows = await db
        .select({ id: businessEntities.id, data: businessEntities.data })
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "accounting"),
            eq(businessEntities.entityType, "journal_entry"),
          ),
        );
      for (const row of journalRows) {
        const data = (row.data ?? {}) as { lines?: Array<{ accountCode?: string }> };
        if ((data.lines ?? []).some((l) => l.accountCode === code)) {
          throw new Error("Account has posted transactions and cannot be deleted.");
        }
      }
      const result = await db
        .delete(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "accounting"),
            eq(businessEntities.entityType, "account"),
            eq(businessEntities.code, code),
          ),
        )
        .returning();
      return result.length > 0;
    },

    async seedDefaults(companyId, currency, actorId) {
      const existing = await this.listAccounts(companyId);
      const existingCodes = new Set(existing.map((a) => a.code));
      let created = 0;
      let skipped = 0;
      for (const seed of DEFAULT_CHART_OF_ACCOUNTS) {
        if (existingCodes.has(seed.code)) {
          skipped++;
          continue;
        }
        try {
          await this.createAccount(companyId, {
            ...seed,
            currency,
            actorId: actorId ?? null,
          });
          created++;
        } catch {
          skipped++;
        }
      }
      return { created, skipped };
    },
  };
}
