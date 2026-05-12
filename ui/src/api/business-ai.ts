import { api } from "./client";
import type { BusinessEntityRow } from "./business";

export interface AiCategorizeExpenseResult {
  entity: BusinessEntityRow | null;
  category: string;
  mock?: boolean;
}

export interface AiSuggestedAction {
  label: string;
  type: "email" | "call" | "meeting" | "task";
}

export interface AiNextActionResult {
  suggestion: string;
  reasoning: string;
  suggestedActions: AiSuggestedAction[];
  mock?: boolean;
}

export interface AiDraftInvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface AiDraftInvoiceResult {
  customerName?: string;
  items: AiDraftInvoiceItem[];
  mock?: boolean;
}

export interface AiCustomerSummaryResult {
  summary: string;
  mock?: boolean;
}

export interface AiChurnRiskItem {
  contactId: string;
  contactName: string | null;
  score: number;
  reasoning: string;
}

export interface AiChurnRiskResult {
  items: AiChurnRiskItem[];
  mock?: boolean;
}

export interface AiReportNarrativeResult {
  narrative: string;
  mock?: boolean;
}

export interface AiClassifyTicketResult {
  category: "billing" | "technical" | "feature_request" | "complaint" | "other";
  priority: "low" | "normal" | "high" | "urgent";
  suggested_response: string;
  mock?: boolean;
}

export const businessAiApi = {
  categorizeExpense: (companyId: string, entityId: string) =>
    api.post<AiCategorizeExpenseResult>(
      `/companies/${companyId}/business/ai/categorize-expense`,
      { entityId },
    ),

  suggestNextAction: (companyId: string, entityId: string) =>
    api.post<AiNextActionResult>(
      `/companies/${companyId}/business/ai/suggest-next-action`,
      { entityId },
    ),

  draftInvoiceFromText: (
    companyId: string,
    body: { text: string; customerId?: string },
  ) =>
    api.post<AiDraftInvoiceResult>(
      `/companies/${companyId}/business/ai/draft-invoice-from-text`,
      body,
    ),

  summarizeCustomer: (companyId: string, contactId: string) =>
    api.post<AiCustomerSummaryResult>(
      `/companies/${companyId}/business/ai/summarize-customer`,
      { contactId },
    ),

  churnRisk: (companyId: string) =>
    api.post<AiChurnRiskResult>(
      `/companies/${companyId}/business/ai/churn-risk`,
      {},
    ),

  generateReportNarrative: (
    companyId: string,
    body: {
      reportType: "pnl" | "cash-flow" | "balance-sheet";
      reportData: Record<string, unknown>;
      lang?: "en" | "ar";
    },
  ) =>
    api.post<AiReportNarrativeResult>(
      `/companies/${companyId}/business/ai/generate-report-narrative`,
      body,
    ),

  classifyTicket: (companyId: string, ticketId: string) =>
    api.post<AiClassifyTicketResult>(
      `/companies/${companyId}/business/ai/classify-ticket`,
      { ticketId },
    ),
};
