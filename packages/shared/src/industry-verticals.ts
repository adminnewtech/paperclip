// ---------------------------------------------------------------------------
// Industry Verticals Registry
// ---------------------------------------------------------------------------
//
// Each vertical describes a tailored Paperclip business configuration for a
// specific industry (salons, restaurants, clinics, ...). A vertical extends
// the generic business module catalog with industry-specific entity types,
// dashboard KPIs, default tax rates, and benchmark averages.
//
// Only the "salons" vertical is fully implemented as a backend module today
// (see `server/src/services/verticals/salons`). The other verticals are
// declared here so the UI can present them in the setup wizard.

export type VerticalKey =
  | "salons"
  | "restaurants"
  | "clinics"
  | "retail"
  | "services"
  | "ecommerce_general"
  | "real_estate"
  | "fitness";

export type VerticalFieldType =
  | "string"
  | "number"
  | "boolean"
  | "datetime"
  | "duration";

export interface VerticalEntityFieldSpec {
  key: string;
  type: VerticalFieldType;
  label: string;
  labelAr?: string;
  required?: boolean;
}

export interface VerticalEntitySpec {
  moduleKey: string;
  entityType: string;
  name: string;
  nameAr: string;
  fields: VerticalEntityFieldSpec[];
}

export interface VerticalDashboardKpi {
  key: string;
  label: string;
  labelAr: string;
  computation: string;
}

export interface VerticalIndustryAverages {
  grossMarginPercent?: number;
  customerRetentionRate?: number;
  averageOrderValue?: number;
}

export interface IndustryVertical {
  key: VerticalKey;
  name: string;
  nameAr: string;
  emoji: string;
  description: string;
  descriptionAr: string;
  defaultModules: string[];
  customEntities: VerticalEntitySpec[];
  dashboardKpis: VerticalDashboardKpi[];
  defaultTaxRate: number;
  industryAverages?: VerticalIndustryAverages;
}

// ---------------------------------------------------------------------------
// Salons & Beauty (fully implemented)
// ---------------------------------------------------------------------------

const SALONS: IndustryVertical = {
  key: "salons",
  name: "Salons & Beauty",
  nameAr: "صالونات وتجميل",
  emoji: "💇",
  description:
    "Manage stylists, services, customer appointments, and reminders for salons, spas and beauty centers.",
  descriptionAr:
    "إدارة المصففين والخدمات ومواعيد العملاء والتذكيرات للصالونات ومراكز التجميل.",
  defaultModules: ["crm", "sales", "inventory", "marketing", "hr"],
  customEntities: [
    {
      moduleKey: "salons",
      entityType: "service",
      name: "Service",
      nameAr: "خدمة",
      fields: [
        { key: "name", type: "string", label: "Name", labelAr: "الاسم", required: true },
        { key: "durationMinutes", type: "duration", label: "Duration (minutes)", labelAr: "المدة بالدقائق", required: true },
        { key: "priceCents", type: "number", label: "Price (fils)", labelAr: "السعر", required: true },
        { key: "category", type: "string", label: "Category", labelAr: "الفئة" },
      ],
    },
    {
      moduleKey: "salons",
      entityType: "stylist",
      name: "Stylist",
      nameAr: "مصفف",
      fields: [
        { key: "name", type: "string", label: "Name", labelAr: "الاسم", required: true },
        { key: "email", type: "string", label: "Email", labelAr: "البريد الإلكتروني" },
        { key: "phone", type: "string", label: "Phone", labelAr: "الهاتف" },
        { key: "specialties", type: "string", label: "Specialties (comma-separated)", labelAr: "التخصصات" },
      ],
    },
    {
      moduleKey: "salons",
      entityType: "appointment",
      name: "Appointment",
      nameAr: "موعد",
      fields: [
        { key: "clientId", type: "string", label: "Client", labelAr: "العميل" },
        { key: "stylistId", type: "string", label: "Stylist", labelAr: "المصفف", required: true },
        { key: "serviceId", type: "string", label: "Service", labelAr: "الخدمة", required: true },
        { key: "startAt", type: "datetime", label: "Start time", labelAr: "وقت البداية", required: true },
        { key: "durationMinutes", type: "duration", label: "Duration", labelAr: "المدة", required: true },
        { key: "status", type: "string", label: "Status", labelAr: "الحالة" },
        { key: "notes", type: "string", label: "Notes", labelAr: "ملاحظات" },
      ],
    },
  ],
  dashboardKpis: [
    {
      key: "appointments_today",
      label: "Appointments today",
      labelAr: "مواعيد اليوم",
      computation: "count(appointments where date(startAt)=today)",
    },
    {
      key: "bookings_this_week",
      label: "Bookings this week",
      labelAr: "حجوزات الأسبوع",
      computation: "count(appointments where startAt in current week)",
    },
    {
      key: "no_show_rate",
      label: "No-show rate (30d)",
      labelAr: "نسبة عدم الحضور (30 يوم)",
      computation: "count(status='no_show') / count(total) in last 30 days",
    },
    {
      key: "popular_services",
      label: "Most popular services",
      labelAr: "الخدمات الأكثر طلباً",
      computation: "top services by appointment count last 30 days",
    },
  ],
  defaultTaxRate: 0,
  industryAverages: {
    grossMarginPercent: 65,
    customerRetentionRate: 0.55,
    averageOrderValue: 1500,
  },
};

// ---------------------------------------------------------------------------
// Restaurants & Cafes (fully implemented)
// ---------------------------------------------------------------------------

const RESTAURANTS: IndustryVertical = {
  key: "restaurants",
  name: "Restaurants & Cafes",
  nameAr: "مطاعم وكافيهات",
  emoji: "🍽️",
  description:
    "Full POS, table map, menu, kitchen tickets and delivery integration for F&B businesses.",
  descriptionAr:
    "نقاط بيع كاملة وخريطة طاولات وقائمة وتذاكر مطبخ وتكامل التوصيل للمطاعم.",
  defaultModules: ["crm", "sales", "inventory", "ecommerce", "hr", "marketing"],
  customEntities: [
    {
      moduleKey: "restaurants",
      entityType: "menu_item",
      name: "Menu item",
      nameAr: "صنف القائمة",
      fields: [
        { key: "name", type: "string", label: "Name", labelAr: "الاسم", required: true },
        { key: "nameAr", type: "string", label: "Arabic name", labelAr: "الاسم بالعربية" },
        { key: "category", type: "string", label: "Category", labelAr: "الفئة", required: true },
        { key: "priceCents", type: "number", label: "Price (fils)", labelAr: "السعر", required: true },
        { key: "costCents", type: "number", label: "Cost (fils)", labelAr: "التكلفة" },
        { key: "preparationTimeMinutes", type: "duration", label: "Prep time (min)", labelAr: "وقت التحضير" },
        { key: "station", type: "string", label: "Station", labelAr: "المحطة" },
        { key: "isAvailable", type: "boolean", label: "Available", labelAr: "متوفر" },
      ],
    },
    {
      moduleKey: "restaurants",
      entityType: "table",
      name: "Table",
      nameAr: "طاولة",
      fields: [
        { key: "name", type: "string", label: "Name", labelAr: "الاسم", required: true },
        { key: "capacity", type: "number", label: "Capacity", labelAr: "السعة", required: true },
        { key: "area", type: "string", label: "Area", labelAr: "المنطقة" },
      ],
    },
    {
      moduleKey: "restaurants",
      entityType: "order",
      name: "Order",
      nameAr: "طلب",
      fields: [
        { key: "type", type: "string", label: "Type", labelAr: "النوع", required: true },
        { key: "tableId", type: "string", label: "Table", labelAr: "الطاولة" },
        { key: "customerName", type: "string", label: "Customer", labelAr: "العميل" },
        { key: "deliveryProvider", type: "string", label: "Delivery provider", labelAr: "شركة التوصيل" },
      ],
    },
  ],
  dashboardKpis: [
    { key: "orders_today", label: "Orders today", labelAr: "طلبات اليوم", computation: "count(orders today)" },
    { key: "revenue_today", label: "Revenue today", labelAr: "إيرادات اليوم", computation: "sum(orders.totalCents where status=paid and date=today)" },
    { key: "average_ticket", label: "Average ticket", labelAr: "متوسط الفاتورة", computation: "avg(orders.totalCents where status=paid)" },
    { key: "tables_occupied", label: "Tables occupied", labelAr: "طاولات مشغولة", computation: "count(tables where status=occupied)" },
    { key: "top_items", label: "Top selling items", labelAr: "أكثر الأصناف مبيعاً", computation: "top items by quantity last 30d" },
  ],
  defaultTaxRate: 0,
  industryAverages: { grossMarginPercent: 60, averageOrderValue: 5500 },
};

// ---------------------------------------------------------------------------
// Clinics & Medical (declared)
// ---------------------------------------------------------------------------

const CLINICS: IndustryVertical = {
  key: "clinics",
  name: "Clinics & Medical",
  nameAr: "عيادات وطبية",
  emoji: "🏥",
  description: "Patient records, appointments, prescriptions for clinics and medical centers.",
  descriptionAr: "سجلات المرضى والمواعيد والوصفات الطبية للعيادات.",
  defaultModules: ["crm", "sales", "hr", "marketing"],
  customEntities: [
    {
      moduleKey: "clinics",
      entityType: "patient",
      name: "Patient",
      nameAr: "مريض",
      fields: [
        { key: "name", type: "string", label: "Name", required: true },
        { key: "phone", type: "string", label: "Phone" },
        { key: "dateOfBirth", type: "datetime", label: "Date of birth" },
      ],
    },
    {
      moduleKey: "clinics",
      entityType: "visit",
      name: "Visit",
      nameAr: "زيارة",
      fields: [
        { key: "patientId", type: "string", label: "Patient", required: true },
        { key: "doctorId", type: "string", label: "Doctor" },
        { key: "visitAt", type: "datetime", label: "Visit time", required: true },
      ],
    },
  ],
  dashboardKpis: [
    { key: "patients_today", label: "Patients today", labelAr: "مرضى اليوم", computation: "count(visits today)" },
  ],
  defaultTaxRate: 0,
};

// ---------------------------------------------------------------------------
// Retail (declared)
// ---------------------------------------------------------------------------

const RETAIL: IndustryVertical = {
  key: "retail",
  name: "Retail Stores",
  nameAr: "متاجر التجزئة",
  emoji: "🛍️",
  description: "POS, inventory, suppliers and loyalty for physical retail stores.",
  descriptionAr: "نقاط البيع والمخزون والموردين وبرامج الولاء.",
  defaultModules: ["crm", "sales", "inventory", "marketing"],
  customEntities: [
    {
      moduleKey: "retail",
      entityType: "location",
      name: "Store location",
      nameAr: "فرع",
      fields: [
        { key: "name", type: "string", label: "Name", labelAr: "الاسم", required: true },
        { key: "address", type: "string", label: "Address", labelAr: "العنوان" },
        { key: "phone", type: "string", label: "Phone", labelAr: "الهاتف" },
        { key: "posTerminals", type: "number", label: "POS terminals", labelAr: "نقاط البيع" },
      ],
    },
    {
      moduleKey: "retail",
      entityType: "product",
      name: "Retail product",
      nameAr: "منتج",
      fields: [
        { key: "name", type: "string", label: "Name", labelAr: "الاسم", required: true },
        { key: "barcode", type: "string", label: "Barcode", labelAr: "الباركود" },
        { key: "unitPriceCents", type: "number", label: "Unit price (fils)", labelAr: "السعر", required: true },
        { key: "taxRatePercent", type: "number", label: "Tax rate %", labelAr: "نسبة الضريبة" },
      ],
    },
    {
      moduleKey: "retail",
      entityType: "sale",
      name: "POS sale",
      nameAr: "بيع",
      fields: [
        { key: "locationId", type: "string", label: "Location", labelAr: "الفرع", required: true },
        { key: "totalCents", type: "number", label: "Total", labelAr: "الإجمالي", required: true },
      ],
    },
    {
      moduleKey: "retail",
      entityType: "loyalty_member",
      name: "Loyalty member",
      nameAr: "عضو ولاء",
      fields: [
        { key: "phone", type: "string", label: "Phone", labelAr: "الهاتف", required: true },
        { key: "tier", type: "string", label: "Tier", labelAr: "المستوى" },
      ],
    },
    {
      moduleKey: "retail",
      entityType: "inventory_transfer",
      name: "Inventory transfer",
      nameAr: "نقل مخزون",
      fields: [
        { key: "fromLocationId", type: "string", label: "From", labelAr: "من", required: true },
        { key: "toLocationId", type: "string", label: "To", labelAr: "إلى", required: true },
      ],
    },
  ],
  dashboardKpis: [
    { key: "sales_today", label: "Sales today", labelAr: "مبيعات اليوم", computation: "sum(sales where date=today)" },
    { key: "transactions_today", label: "Transactions today", labelAr: "معاملات اليوم", computation: "count(sales where date=today)" },
    { key: "avg_basket", label: "Average basket size", labelAr: "متوسط السلة", computation: "avg(sale.totalCents) last 30d" },
    { key: "low_stock_items", label: "Low-stock SKUs", labelAr: "أصناف على وشك النفاد", computation: "count(products where stock < reorderPoint)" },
    { key: "loyalty_members", label: "Loyalty members", labelAr: "أعضاء الولاء", computation: "count(loyalty_member)" },
  ],
  defaultTaxRate: 5,
  industryAverages: { grossMarginPercent: 35, averageOrderValue: 600 },
};

// ---------------------------------------------------------------------------
// Professional Services (declared)
// ---------------------------------------------------------------------------

const SERVICES: IndustryVertical = {
  key: "services",
  name: "Professional Services",
  nameAr: "خدمات مهنية",
  emoji: "🧑‍💼",
  description: "Consulting, agencies, project-based services with retainers and timesheets.",
  descriptionAr: "الاستشارات والوكالات والخدمات المشاريعية.",
  defaultModules: ["crm", "sales", "projects", "hr"],
  customEntities: [],
  dashboardKpis: [
    { key: "billable_hours", label: "Billable hours", labelAr: "ساعات قابلة للفوترة", computation: "sum(timesheet hours billable)" },
  ],
  defaultTaxRate: 0,
  industryAverages: { grossMarginPercent: 50 },
};

// ---------------------------------------------------------------------------
// E-commerce general (declared)
// ---------------------------------------------------------------------------

const ECOMMERCE_GENERAL: IndustryVertical = {
  key: "ecommerce_general",
  name: "E-commerce",
  nameAr: "متجر إلكتروني",
  emoji: "🛒",
  description: "Online storefront with orders, fulfillment, and marketing automation.",
  descriptionAr: "متجر إلكتروني مع الطلبات والشحن والتسويق.",
  defaultModules: ["crm", "sales", "inventory", "ecommerce", "marketing"],
  customEntities: [],
  dashboardKpis: [
    { key: "online_orders_today", label: "Orders today", labelAr: "طلبات اليوم", computation: "count(online_orders today)" },
  ],
  defaultTaxRate: 5,
  industryAverages: { grossMarginPercent: 40, averageOrderValue: 350 },
};

// ---------------------------------------------------------------------------
// Real estate (declared)
// ---------------------------------------------------------------------------

const REAL_ESTATE: IndustryVertical = {
  key: "real_estate",
  name: "Real Estate",
  nameAr: "عقارات",
  emoji: "🏠",
  description: "Properties, leads, viewings, contracts for real estate brokers.",
  descriptionAr: "العقارات والعملاء والمعاينات والعقود لوسطاء العقارات.",
  defaultModules: ["crm", "sales", "marketing"],
  customEntities: [],
  dashboardKpis: [
    { key: "active_listings", label: "Active listings", labelAr: "عقارات معروضة", computation: "count(listings active)" },
  ],
  defaultTaxRate: 0,
};

// ---------------------------------------------------------------------------
// Fitness & Wellness (declared)
// ---------------------------------------------------------------------------

const FITNESS: IndustryVertical = {
  key: "fitness",
  name: "Fitness & Wellness",
  nameAr: "اللياقة والعافية",
  emoji: "💪",
  description: "Gyms, studios, trainers with memberships, classes and bookings.",
  descriptionAr: "صالات رياضية ومدربين مع اشتراكات وحصص وحجوزات.",
  defaultModules: ["crm", "sales", "marketing", "hr"],
  customEntities: [],
  dashboardKpis: [
    { key: "active_members", label: "Active members", labelAr: "أعضاء فعّالون", computation: "count(members where status=active)" },
  ],
  defaultTaxRate: 0,
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const INDUSTRY_VERTICALS: Record<VerticalKey, IndustryVertical> = {
  salons: SALONS,
  restaurants: RESTAURANTS,
  clinics: CLINICS,
  retail: RETAIL,
  services: SERVICES,
  ecommerce_general: ECOMMERCE_GENERAL,
  real_estate: REAL_ESTATE,
  fitness: FITNESS,
};

export function getIndustryVertical(key: string): IndustryVertical | undefined {
  return (INDUSTRY_VERTICALS as Record<string, IndustryVertical>)[key];
}

export function listIndustryVerticals(): IndustryVertical[] {
  return Object.values(INDUSTRY_VERTICALS);
}
