/**
 * Business Management modules catalog.
 *
 * Single source of truth for the modules that can be enabled on a Paperclip
 * company/workspace to turn it into a full business management environment
 * (Zoho / Shopify / Bin replacement). Server and UI both consume this.
 */

export type BusinessModuleKey =
  | "crm"
  | "sales"
  | "inventory"
  | "finance"
  | "hr"
  | "helpdesk"
  | "marketing"
  | "ecommerce"
  | "projects"
  | "analytics"
  | "documents";

export type BusinessEntityType = string;

export interface BusinessEntityFieldSpec {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "currency" | "date" | "select" | "email" | "phone" | "url" | "json";
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  group?: string;
  hint?: string;
}

export interface BusinessEntitySpec {
  key: BusinessEntityType;
  label: string;
  pluralLabel: string;
  icon: string;
  primaryField: "name" | "code";
  amountField?: boolean;
  statusValues?: Array<{ value: string; label: string; tone?: "neutral" | "success" | "warning" | "danger" | "info" }>;
  fields: BusinessEntityFieldSpec[];
}

export interface BusinessModuleSpec {
  key: BusinessModuleKey;
  label: string;
  arabicLabel: string;
  description: string;
  icon: string;
  /** Sidebar order */
  order: number;
  /** Replaces (for marketing copy in the setup wizard) */
  replaces: string[];
  entities: BusinessEntitySpec[];
}

const CRM: BusinessModuleSpec = {
  key: "crm",
  label: "CRM",
  arabicLabel: "علاقات العملاء",
  description: "Contacts, leads, pipelines, deals and activities.",
  icon: "users",
  order: 10,
  replaces: ["Zoho CRM", "HubSpot CRM"],
  entities: [
    {
      key: "contact",
      label: "Contact",
      pluralLabel: "Contacts",
      icon: "user",
      primaryField: "name",
      fields: [
        { key: "name", label: "Full name", type: "text", required: true },
        { key: "email", label: "Email", type: "email" },
        { key: "phone", label: "Phone", type: "phone" },
        { key: "company", label: "Company / Account", type: "text" },
        { key: "title", label: "Job title", type: "text" },
        { key: "notes", label: "Notes", type: "textarea" },
      ],
    },
    {
      key: "lead",
      label: "Lead",
      pluralLabel: "Leads",
      icon: "sparkles",
      primaryField: "name",
      statusValues: [
        { value: "new", label: "New", tone: "info" },
        { value: "qualified", label: "Qualified", tone: "success" },
        { value: "unqualified", label: "Unqualified", tone: "warning" },
        { value: "converted", label: "Converted", tone: "success" },
      ],
      fields: [
        { key: "name", label: "Lead name", type: "text", required: true },
        { key: "source", label: "Source", type: "select", options: [
          { value: "website", label: "Website" },
          { value: "referral", label: "Referral" },
          { value: "ads", label: "Ads" },
          { value: "event", label: "Event" },
          { value: "other", label: "Other" },
        ] },
        { key: "email", label: "Email", type: "email" },
        { key: "phone", label: "Phone", type: "phone" },
      ],
    },
    {
      key: "deal",
      label: "Deal",
      pluralLabel: "Deals",
      icon: "trending-up",
      primaryField: "name",
      amountField: true,
      statusValues: [
        { value: "prospecting", label: "Prospecting", tone: "info" },
        { value: "qualified", label: "Qualified", tone: "info" },
        { value: "proposal", label: "Proposal", tone: "warning" },
        { value: "negotiation", label: "Negotiation", tone: "warning" },
        { value: "won", label: "Won", tone: "success" },
        { value: "lost", label: "Lost", tone: "danger" },
      ],
      fields: [
        { key: "name", label: "Deal name", type: "text", required: true },
        { key: "amount", label: "Expected amount", type: "currency" },
        { key: "closeDate", label: "Expected close date", type: "date" },
        { key: "contactId", label: "Primary contact", type: "text" },
      ],
    },
  ],
};

const SALES: BusinessModuleSpec = {
  key: "sales",
  label: "Sales",
  arabicLabel: "المبيعات",
  description: "Quotes, sales orders, invoices and payments.",
  icon: "receipt",
  order: 20,
  replaces: ["Zoho Invoice", "Zoho Books (sales side)"],
  entities: [
    {
      key: "customer",
      label: "Customer",
      pluralLabel: "Customers",
      icon: "user-check",
      primaryField: "name",
      fields: [
        { key: "name", label: "Customer name", type: "text", required: true },
        { key: "email", label: "Email", type: "email" },
        { key: "phone", label: "Phone", type: "phone" },
        { key: "taxId", label: "Tax ID / VAT #", type: "text" },
        { key: "billingAddress", label: "Billing address", type: "textarea" },
      ],
    },
    {
      key: "quote",
      label: "Quote",
      pluralLabel: "Quotes",
      icon: "file-text",
      primaryField: "code",
      amountField: true,
      statusValues: [
        { value: "draft", label: "Draft" },
        { value: "sent", label: "Sent", tone: "info" },
        { value: "accepted", label: "Accepted", tone: "success" },
        { value: "rejected", label: "Rejected", tone: "danger" },
      ],
      fields: [
        { key: "customerId", label: "Customer", type: "text", required: true },
        { key: "issueDate", label: "Issue date", type: "date" },
        { key: "validUntil", label: "Valid until", type: "date" },
        { key: "amount", label: "Total amount", type: "currency" },
        { key: "lineItems", label: "Line items", type: "json" },
      ],
    },
    {
      key: "invoice",
      label: "Invoice",
      pluralLabel: "Invoices",
      icon: "file-check",
      primaryField: "code",
      amountField: true,
      statusValues: [
        { value: "draft", label: "Draft" },
        { value: "sent", label: "Sent", tone: "info" },
        { value: "paid", label: "Paid", tone: "success" },
        { value: "overdue", label: "Overdue", tone: "danger" },
        { value: "void", label: "Void", tone: "neutral" },
      ],
      fields: [
        { key: "customerId", label: "Customer", type: "text", required: true },
        { key: "issueDate", label: "Issue date", type: "date" },
        { key: "dueDate", label: "Due date", type: "date" },
        { key: "amount", label: "Total amount", type: "currency" },
        { key: "taxAmount", label: "Tax amount", type: "currency" },
        { key: "lineItems", label: "Line items", type: "json" },
      ],
    },
    {
      key: "payment",
      label: "Payment",
      pluralLabel: "Payments",
      icon: "credit-card",
      primaryField: "code",
      amountField: true,
      fields: [
        { key: "invoiceId", label: "Invoice", type: "text" },
        { key: "method", label: "Payment method", type: "select", options: [
          { value: "cash", label: "Cash" },
          { value: "bank_transfer", label: "Bank transfer" },
          { value: "card", label: "Card" },
          { value: "wallet", label: "Wallet" },
        ] },
        { key: "amount", label: "Amount", type: "currency", required: true },
        { key: "paidAt", label: "Paid at", type: "date" },
      ],
    },
  ],
};

const INVENTORY: BusinessModuleSpec = {
  key: "inventory",
  label: "Inventory",
  arabicLabel: "المخزون",
  description: "Products, warehouses, stock levels and movements.",
  icon: "package",
  order: 30,
  replaces: ["Zoho Inventory"],
  entities: [
    {
      key: "product",
      label: "Product",
      pluralLabel: "Products",
      icon: "box",
      primaryField: "name",
      fields: [
        { key: "name", label: "Product name", type: "text", required: true },
        { key: "sku", label: "SKU", type: "text" },
        { key: "barcode", label: "Barcode", type: "text" },
        { key: "price", label: "Selling price", type: "currency" },
        { key: "cost", label: "Cost", type: "currency" },
        { key: "unit", label: "Unit", type: "select", options: [
          { value: "piece", label: "Piece" },
          { value: "kg", label: "Kilogram" },
          { value: "liter", label: "Liter" },
          { value: "meter", label: "Meter" },
          { value: "hour", label: "Hour" },
        ] },
        { key: "trackInventory", label: "Track inventory", type: "select", options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ] },
      ],
    },
    {
      key: "warehouse",
      label: "Warehouse",
      pluralLabel: "Warehouses",
      icon: "warehouse",
      primaryField: "name",
      fields: [
        { key: "name", label: "Warehouse name", type: "text", required: true },
        { key: "address", label: "Address", type: "textarea" },
      ],
    },
    {
      key: "stock_movement",
      label: "Stock movement",
      pluralLabel: "Stock movements",
      icon: "arrow-right-left",
      primaryField: "code",
      fields: [
        { key: "productId", label: "Product", type: "text", required: true },
        { key: "warehouseId", label: "Warehouse", type: "text", required: true },
        { key: "kind", label: "Type", type: "select", required: true, options: [
          { value: "in", label: "Stock in" },
          { value: "out", label: "Stock out" },
          { value: "transfer", label: "Transfer" },
          { value: "adjustment", label: "Adjustment" },
        ] },
        { key: "quantity", label: "Quantity", type: "number", required: true },
        { key: "reason", label: "Reason", type: "text" },
      ],
    },
  ],
};

const FINANCE: BusinessModuleSpec = {
  key: "finance",
  label: "Finance",
  arabicLabel: "المحاسبة",
  description: "Chart of accounts, journal entries, taxes and expenses.",
  icon: "calculator",
  order: 40,
  replaces: ["Zoho Books", "Bin"],
  entities: [
    {
      key: "account",
      label: "Account",
      pluralLabel: "Chart of accounts",
      icon: "book",
      primaryField: "code",
      fields: [
        { key: "code", label: "Account code", type: "text", required: true },
        { key: "name", label: "Account name", type: "text", required: true },
        { key: "type", label: "Type", type: "select", required: true, options: [
          { value: "asset", label: "Asset" },
          { value: "liability", label: "Liability" },
          { value: "equity", label: "Equity" },
          { value: "revenue", label: "Revenue" },
          { value: "expense", label: "Expense" },
        ] },
      ],
    },
    {
      key: "journal_entry",
      label: "Journal entry",
      pluralLabel: "Journal entries",
      icon: "scroll",
      primaryField: "code",
      amountField: true,
      fields: [
        { key: "entryDate", label: "Date", type: "date", required: true },
        { key: "memo", label: "Memo", type: "textarea" },
        { key: "lines", label: "Lines (debit/credit)", type: "json", required: true },
      ],
    },
    {
      key: "expense",
      label: "Expense",
      pluralLabel: "Expenses",
      icon: "wallet",
      primaryField: "code",
      amountField: true,
      fields: [
        { key: "vendor", label: "Vendor", type: "text" },
        { key: "category", label: "Category", type: "text" },
        { key: "amount", label: "Amount", type: "currency", required: true },
        { key: "incurredAt", label: "Incurred at", type: "date" },
        { key: "notes", label: "Notes", type: "textarea" },
      ],
    },
  ],
};

const HR: BusinessModuleSpec = {
  key: "hr",
  label: "HR",
  arabicLabel: "الموارد البشرية",
  description: "Employees, departments, leaves, attendance and payroll.",
  icon: "id-card",
  order: 50,
  replaces: ["Zoho People"],
  entities: [
    {
      key: "employee",
      label: "Employee",
      pluralLabel: "Employees",
      icon: "user",
      primaryField: "name",
      fields: [
        { key: "name", label: "Full name", type: "text", required: true },
        { key: "email", label: "Email", type: "email" },
        { key: "phone", label: "Phone", type: "phone" },
        { key: "department", label: "Department", type: "text" },
        { key: "jobTitle", label: "Job title", type: "text" },
        { key: "hireDate", label: "Hire date", type: "date" },
        { key: "salary", label: "Monthly salary", type: "currency" },
      ],
    },
    {
      key: "leave_request",
      label: "Leave request",
      pluralLabel: "Leave requests",
      icon: "calendar-off",
      primaryField: "code",
      statusValues: [
        { value: "pending", label: "Pending", tone: "warning" },
        { value: "approved", label: "Approved", tone: "success" },
        { value: "rejected", label: "Rejected", tone: "danger" },
      ],
      fields: [
        { key: "employeeId", label: "Employee", type: "text", required: true },
        { key: "kind", label: "Type", type: "select", options: [
          { value: "annual", label: "Annual" },
          { value: "sick", label: "Sick" },
          { value: "unpaid", label: "Unpaid" },
          { value: "other", label: "Other" },
        ] },
        { key: "from", label: "From", type: "date", required: true },
        { key: "to", label: "To", type: "date", required: true },
        { key: "reason", label: "Reason", type: "textarea" },
      ],
    },
  ],
};

const HELPDESK: BusinessModuleSpec = {
  key: "helpdesk",
  label: "Helpdesk",
  arabicLabel: "الدعم الفني",
  description: "Tickets, SLAs and knowledge base.",
  icon: "life-buoy",
  order: 60,
  replaces: ["Zoho Desk"],
  entities: [
    {
      key: "ticket",
      label: "Ticket",
      pluralLabel: "Tickets",
      icon: "ticket",
      primaryField: "code",
      statusValues: [
        { value: "open", label: "Open", tone: "info" },
        { value: "in_progress", label: "In progress", tone: "warning" },
        { value: "waiting", label: "Waiting", tone: "neutral" },
        { value: "resolved", label: "Resolved", tone: "success" },
        { value: "closed", label: "Closed" },
      ],
      fields: [
        { key: "subject", label: "Subject", type: "text", required: true },
        { key: "description", label: "Description", type: "textarea" },
        { key: "customerId", label: "Customer", type: "text" },
        { key: "priority", label: "Priority", type: "select", options: [
          { value: "low", label: "Low" },
          { value: "normal", label: "Normal" },
          { value: "high", label: "High" },
          { value: "urgent", label: "Urgent" },
        ] },
      ],
    },
  ],
};

const MARKETING: BusinessModuleSpec = {
  key: "marketing",
  label: "Marketing",
  arabicLabel: "التسويق",
  description: "Campaigns, audiences, templates and automations.",
  icon: "megaphone",
  order: 70,
  replaces: ["Zoho Campaigns", "Mailchimp"],
  entities: [
    {
      key: "campaign",
      label: "Campaign",
      pluralLabel: "Campaigns",
      icon: "send",
      primaryField: "name",
      statusValues: [
        { value: "draft", label: "Draft" },
        { value: "scheduled", label: "Scheduled", tone: "info" },
        { value: "sent", label: "Sent", tone: "success" },
        { value: "paused", label: "Paused", tone: "warning" },
      ],
      fields: [
        { key: "name", label: "Campaign name", type: "text", required: true },
        { key: "channel", label: "Channel", type: "select", options: [
          { value: "email", label: "Email" },
          { value: "sms", label: "SMS" },
          { value: "whatsapp", label: "WhatsApp" },
          { value: "push", label: "Push" },
        ] },
        { key: "audience", label: "Audience", type: "text" },
        { key: "scheduledFor", label: "Scheduled for", type: "date" },
      ],
    },
  ],
};

const ECOMMERCE: BusinessModuleSpec = {
  key: "ecommerce",
  label: "E-commerce",
  arabicLabel: "المتجر الإلكتروني",
  description: "Online storefront, catalog, online orders and shipping.",
  icon: "shopping-bag",
  order: 80,
  replaces: ["Shopify", "WooCommerce"],
  entities: [
    {
      key: "storefront",
      label: "Storefront",
      pluralLabel: "Storefronts",
      icon: "store",
      primaryField: "name",
      fields: [
        { key: "name", label: "Store name", type: "text", required: true },
        { key: "domain", label: "Domain", type: "text" },
        { key: "currency", label: "Currency", type: "text" },
        { key: "theme", label: "Theme", type: "text" },
      ],
    },
    {
      key: "online_order",
      label: "Online order",
      pluralLabel: "Online orders",
      icon: "shopping-cart",
      primaryField: "code",
      amountField: true,
      statusValues: [
        { value: "pending", label: "Pending", tone: "info" },
        { value: "paid", label: "Paid", tone: "success" },
        { value: "fulfilled", label: "Fulfilled", tone: "success" },
        { value: "refunded", label: "Refunded", tone: "warning" },
        { value: "canceled", label: "Canceled", tone: "danger" },
      ],
      fields: [
        { key: "customer", label: "Customer", type: "text" },
        { key: "amount", label: "Total", type: "currency" },
        { key: "shippingAddress", label: "Shipping address", type: "textarea" },
        { key: "items", label: "Items", type: "json" },
      ],
    },
    {
      key: "discount",
      label: "Discount",
      pluralLabel: "Discounts",
      icon: "tag",
      primaryField: "code",
      fields: [
        { key: "code", label: "Code", type: "text", required: true },
        { key: "kind", label: "Kind", type: "select", options: [
          { value: "percentage", label: "Percentage" },
          { value: "fixed", label: "Fixed amount" },
        ] },
        { key: "value", label: "Value", type: "number" },
        { key: "validFrom", label: "Valid from", type: "date" },
        { key: "validUntil", label: "Valid until", type: "date" },
      ],
    },
  ],
};

export const BUSINESS_MODULES: BusinessModuleSpec[] = [
  CRM,
  SALES,
  INVENTORY,
  FINANCE,
  HR,
  HELPDESK,
  MARKETING,
  ECOMMERCE,
];

export function getBusinessModule(key: string): BusinessModuleSpec | undefined {
  return BUSINESS_MODULES.find((m) => m.key === key);
}

export function getBusinessEntitySpec(
  moduleKey: string,
  entityType: string,
): BusinessEntitySpec | undefined {
  return getBusinessModule(moduleKey)?.entities.find((e) => e.key === entityType);
}

// ---------------------------------------------------------------------------
// Industry presets — the Business Brain wizard uses these to pre-select
// modules and seed configuration based on what the company actually does.
// ---------------------------------------------------------------------------

export interface IndustryPreset {
  key: string;
  label: string;
  arabicLabel: string;
  icon: string;
  description: string;
  modules: BusinessModuleKey[];
  /** Seed data hints — Phase 2 will actually instantiate this. */
  seeds?: {
    chartOfAccounts?: "minimal" | "retail" | "services" | "manufacturing" | "restaurant";
    salesPipeline?: string[];
    productCategories?: string[];
  };
}

export const INDUSTRY_PRESETS: IndustryPreset[] = [
  {
    key: "retail",
    label: "Retail / Shop",
    arabicLabel: "تجزئة / متجر",
    icon: "shopping-bag",
    description: "Physical or online shop selling products to consumers.",
    modules: ["crm", "sales", "inventory", "finance", "ecommerce", "helpdesk"],
    seeds: {
      chartOfAccounts: "retail",
      productCategories: ["General", "Featured", "Sale"],
    },
  },
  {
    key: "services",
    label: "Services / Agency",
    arabicLabel: "خدمات / وكالة",
    icon: "briefcase",
    description: "Professional services, consulting, or agency work.",
    modules: ["crm", "sales", "finance", "projects", "hr", "helpdesk"],
    seeds: {
      chartOfAccounts: "services",
      salesPipeline: ["Prospecting", "Discovery", "Proposal", "Negotiation", "Won", "Lost"],
    },
  },
  {
    key: "manufacturing",
    label: "Manufacturing",
    arabicLabel: "تصنيع",
    icon: "factory",
    description: "Produce goods from raw materials.",
    modules: ["crm", "sales", "inventory", "finance", "hr", "projects"],
    seeds: { chartOfAccounts: "manufacturing" },
  },
  {
    key: "restaurant",
    label: "Restaurant / Cafe",
    arabicLabel: "مطعم / مقهى",
    icon: "utensils",
    description: "Food & beverage service.",
    modules: ["sales", "inventory", "finance", "hr", "marketing"],
    seeds: { chartOfAccounts: "restaurant" },
  },
  {
    key: "saas",
    label: "SaaS / Software",
    arabicLabel: "برمجيات / SaaS",
    icon: "code",
    description: "Software-as-a-service business.",
    modules: ["crm", "sales", "finance", "helpdesk", "marketing", "projects"],
    seeds: { chartOfAccounts: "services" },
  },
  {
    key: "freelance",
    label: "Freelance / Solo",
    arabicLabel: "عمل حر",
    icon: "user",
    description: "Solo operator or freelancer.",
    modules: ["crm", "sales", "finance"],
    seeds: { chartOfAccounts: "minimal" },
  },
  {
    key: "custom",
    label: "Custom",
    arabicLabel: "مخصص",
    icon: "settings",
    description: "I'll pick modules manually.",
    modules: [],
  },
];

export function getIndustryPreset(key: string): IndustryPreset | undefined {
  return INDUSTRY_PRESETS.find((p) => p.key === key);
}
