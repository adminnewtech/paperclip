// ---------------------------------------------------------------------------
// Simulation Scenario Templates
//
// Each template describes a what-if scenario, the parameters it expects, and
// the economic effects it applies to baseline projections. Templates are
// deterministic — no real ML, just business rules.
// ---------------------------------------------------------------------------

export type SimulationScenarioKey =
  | "price_change"
  | "marketing_spend"
  | "hire_employees"
  | "new_product_launch"
  | "discount_strategy"
  | "expansion_to_region"
  | "cost_reduction"
  | "supplier_change"
  | "open_new_branch"
  | "custom";

export interface ScenarioParameterSpec {
  key: string;
  type: "number" | "percent" | "string" | "boolean";
  label: string;
  labelAr: string;
  default?: unknown;
  min?: number;
  max?: number;
  unit?: string;
  description?: string;
  descriptionAr?: string;
}

export interface SimulationScenarioTemplate {
  key: SimulationScenarioKey;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  emoji: string;
  parametersSchema: ScenarioParameterSpec[];
  exampleQuestion: string;
  exampleQuestionAr: string;
  defaultInsights: Array<{
    type: "positive" | "negative" | "neutral";
    title: string;
    titleAr: string;
    description: string;
    descriptionAr: string;
  }>;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const SCENARIO_TEMPLATES: SimulationScenarioTemplate[] = [
  {
    key: "price_change",
    name: "Price Change",
    nameAr: "تغيير الأسعار",
    description: "Simulate the impact of raising or lowering prices.",
    descriptionAr: "محاكاة تأثير رفع أو خفض الأسعار.",
    emoji: "💰",
    parametersSchema: [
      {
        key: "pricePercent",
        type: "percent",
        label: "Price change (%)",
        labelAr: "نسبة تغيير السعر (%)",
        default: 10,
        min: -50,
        max: 100,
        unit: "%",
      },
      {
        key: "elasticity",
        type: "number",
        label: "Price elasticity",
        labelAr: "مرونة الطلب",
        default: -1.5,
        min: -5,
        max: 0,
      },
    ],
    exampleQuestion: "What if I raise prices by 10%?",
    exampleQuestionAr: "ماذا لو رفعت الأسعار 10%؟",
    defaultInsights: [
      {
        type: "positive",
        title: "Higher revenue per customer",
        titleAr: "إيراد أعلى لكل عميل",
        description:
          "Existing customers who stay produce higher revenue per transaction.",
        descriptionAr: "العملاء الذين يبقون يدفعون مبلغاً أعلى لكل عملية.",
      },
      {
        type: "negative",
        title: "Customer churn risk",
        titleAr: "خطر فقدان العملاء",
        description:
          "Some customers may leave; net revenue depends on price elasticity.",
        descriptionAr:
          "قد يفقد بعض العملاء؛ صافي الإيراد يعتمد على مرونة الطلب.",
      },
    ],
  },
  {
    key: "marketing_spend",
    name: "Marketing Spend",
    nameAr: "إنفاق التسويق",
    description: "Increase or decrease marketing investment.",
    descriptionAr: "زيادة أو خفض الاستثمار التسويقي.",
    emoji: "📣",
    parametersSchema: [
      {
        key: "spendPercent",
        type: "percent",
        label: "Spend change (%)",
        labelAr: "تغير الإنفاق (%)",
        default: 50,
        min: -100,
        max: 500,
        unit: "%",
      },
      {
        key: "cacCents",
        type: "number",
        label: "Estimated CAC (cents)",
        labelAr: "تكلفة اكتساب عميل (سنتات)",
        default: 50_000,
        min: 100,
        max: 10_000_000,
      },
    ],
    exampleQuestion: "What if I increase marketing spend by 50%?",
    exampleQuestionAr: "ماذا لو زدت ميزانية التسويق 50%؟",
    defaultInsights: [
      {
        type: "positive",
        title: "More new customers",
        titleAr: "عملاء جدد إضافيون",
        description:
          "Higher spend produces more acquisitions, with a lag of 1-2 months.",
        descriptionAr:
          "إنفاق أعلى يجلب عملاء جدد مع تأخير شهر إلى شهرين.",
      },
      {
        type: "negative",
        title: "Cash impact upfront",
        titleAr: "تأثير نقدي فوري",
        description:
          "Marketing spend is paid before revenue lands — short-term cash decline.",
        descriptionAr: "النفقات التسويقية تُدفع قبل وصول الإيرادات.",
      },
    ],
  },
  {
    key: "hire_employees",
    name: "Hire Employees",
    nameAr: "توظيف موظفين",
    description: "Add headcount and model salary cost vs productivity gains.",
    descriptionAr: "إضافة موظفين ومحاكاة الرواتب مقابل زيادة الإنتاجية.",
    emoji: "👥",
    parametersSchema: [
      {
        key: "newHires",
        type: "number",
        label: "Number of new hires",
        labelAr: "عدد الموظفين الجدد",
        default: 2,
        min: 0,
        max: 100,
      },
      {
        key: "avgMonthlySalaryCents",
        type: "number",
        label: "Avg monthly salary (cents)",
        labelAr: "متوسط الراتب الشهري (سنتات)",
        default: 1_500_000,
        min: 0,
        max: 100_000_000,
      },
      {
        key: "rampMonths",
        type: "number",
        label: "Ramp-up months",
        labelAr: "أشهر التأهيل",
        default: 3,
        min: 0,
        max: 24,
      },
    ],
    exampleQuestion: "What if I hire 2 more sales reps?",
    exampleQuestionAr: "ماذا لو وظفت اثنين إضافيين للمبيعات؟",
    defaultInsights: [
      {
        type: "negative",
        title: "Salary expense lifts immediately",
        titleAr: "ارتفاع فوري في الرواتب",
        description:
          "Payroll grows from day one of hire; revenue benefit builds over time.",
        descriptionAr:
          "النفقات ترتفع فوراً، بينما الإيراد ينمو تدريجياً.",
      },
      {
        type: "positive",
        title: "Higher productive capacity",
        titleAr: "زيادة الطاقة الإنتاجية",
        description:
          "After ramp-up, new hires contribute to revenue at the existing per-employee productivity rate.",
        descriptionAr:
          "بعد فترة التأهيل، يساهم الموظفون الجدد بمعدل الإنتاجية الحالي.",
      },
    ],
  },
  {
    key: "new_product_launch",
    name: "New Product Launch",
    nameAr: "إطلاق منتج جديد",
    description: "Introduce a new product with projected sales and costs.",
    descriptionAr: "إطلاق منتج جديد بتوقعات للمبيعات والتكاليف.",
    emoji: "🚀",
    parametersSchema: [
      {
        key: "monthlyRevenueCents",
        type: "number",
        label: "Projected monthly revenue (cents)",
        labelAr: "إيراد شهري متوقع (سنتات)",
        default: 5_000_000,
        min: 0,
      },
      {
        key: "monthlyCostCents",
        type: "number",
        label: "Projected monthly cost (cents)",
        labelAr: "تكلفة شهرية متوقعة (سنتات)",
        default: 2_000_000,
        min: 0,
      },
      {
        key: "rampMonths",
        type: "number",
        label: "Ramp-up months",
        labelAr: "أشهر التأهيل",
        default: 4,
        min: 0,
        max: 24,
      },
    ],
    exampleQuestion: "What if I launch a new product line?",
    exampleQuestionAr: "ماذا لو أطلقت خط منتجات جديد؟",
    defaultInsights: [
      {
        type: "positive",
        title: "New revenue stream",
        titleAr: "مصدر إيراد جديد",
        description:
          "Diversifies revenue and reduces dependency on existing products.",
        descriptionAr:
          "يُنوّع مصادر الدخل ويقلل الاعتماد على المنتجات الحالية.",
      },
      {
        type: "negative",
        title: "Upfront investment",
        titleAr: "استثمار أولي",
        description:
          "Launch costs and ramp-up depress profit for the first few months.",
        descriptionAr:
          "تكاليف الإطلاق تخفض الربح خلال الأشهر الأولى.",
      },
    ],
  },
  {
    key: "discount_strategy",
    name: "Discount Strategy",
    nameAr: "استراتيجية الخصومات",
    description: "Offer a discount and project impact on volume vs margin.",
    descriptionAr: "تقديم خصم وتوقع تأثيره على الحجم والهامش.",
    emoji: "🏷️",
    parametersSchema: [
      {
        key: "discountPercent",
        type: "percent",
        label: "Discount (%)",
        labelAr: "نسبة الخصم (%)",
        default: 20,
        min: 0,
        max: 80,
        unit: "%",
      },
      {
        key: "volumeLift",
        type: "percent",
        label: "Expected volume lift (%)",
        labelAr: "زيادة متوقعة في الحجم (%)",
        default: 30,
        min: 0,
        max: 500,
        unit: "%",
      },
    ],
    exampleQuestion: "What if I offer 20% off this quarter?",
    exampleQuestionAr: "ماذا لو قدمت خصم 20% هذا الربع؟",
    defaultInsights: [
      {
        type: "positive",
        title: "Higher customer count",
        titleAr: "عدد عملاء أكبر",
        description: "More transactions and broader market reach.",
        descriptionAr: "عدد أكبر من المعاملات ووصول أوسع.",
      },
      {
        type: "negative",
        title: "Margin compression",
        titleAr: "ضغط على الهامش",
        description:
          "Net revenue per sale falls — net P&L depends on volume response.",
        descriptionAr:
          "الإيراد الصافي لكل عملية ينخفض — صافي الأرباح يعتمد على استجابة الحجم.",
      },
    ],
  },
  {
    key: "expansion_to_region",
    name: "Expand to a New Region",
    nameAr: "التوسع إلى منطقة جديدة",
    description: "Enter a new geographic market.",
    descriptionAr: "الدخول إلى سوق جغرافي جديد.",
    emoji: "🌍",
    parametersSchema: [
      {
        key: "setupCostCents",
        type: "number",
        label: "One-time setup cost (cents)",
        labelAr: "تكلفة الإعداد لمرة واحدة (سنتات)",
        default: 20_000_000,
        min: 0,
      },
      {
        key: "monthlyOpExCents",
        type: "number",
        label: "Monthly OpEx (cents)",
        labelAr: "نفقات تشغيل شهرية (سنتات)",
        default: 5_000_000,
        min: 0,
      },
      {
        key: "revenueRampMonths",
        type: "number",
        label: "Revenue ramp (months)",
        labelAr: "أشهر نمو الإيرادات",
        default: 6,
        min: 1,
        max: 36,
      },
      {
        key: "steadyStateRevenuePercent",
        type: "percent",
        label: "Steady-state revenue add (%)",
        labelAr: "نسبة الإيراد عند الاستقرار (%)",
        default: 25,
        min: 0,
        max: 500,
        unit: "%",
      },
    ],
    exampleQuestion: "What if I expand to a new country?",
    exampleQuestionAr: "ماذا لو توسعت إلى دولة جديدة؟",
    defaultInsights: [
      {
        type: "positive",
        title: "Larger addressable market",
        titleAr: "سوق أكبر",
        description: "More potential customers; revenue grows after ramp.",
        descriptionAr: "عملاء محتملون أكثر؛ نمو الإيرادات بعد التأهيل.",
      },
      {
        type: "negative",
        title: "Cash-intensive setup",
        titleAr: "إعداد مكلف نقدياً",
        description: "Cash declines sharply in the first month due to setup.",
        descriptionAr:
          "انخفاض حاد في النقد خلال الشهر الأول بسبب تكاليف الإعداد.",
      },
    ],
  },
  {
    key: "cost_reduction",
    name: "Cost Reduction",
    nameAr: "خفض التكاليف",
    description: "Reduce operating costs by a target percentage.",
    descriptionAr: "خفض المصروفات التشغيلية بنسبة معينة.",
    emoji: "✂️",
    parametersSchema: [
      {
        key: "reductionPercent",
        type: "percent",
        label: "Cost reduction (%)",
        labelAr: "نسبة الخفض (%)",
        default: 15,
        min: 0,
        max: 50,
        unit: "%",
      },
      {
        key: "revenueImpactPercent",
        type: "percent",
        label: "Revenue impact (%)",
        labelAr: "تأثير على الإيرادات (%)",
        default: -2,
        min: -50,
        max: 10,
        unit: "%",
      },
    ],
    exampleQuestion: "What if I cut operating costs by 15%?",
    exampleQuestionAr: "ماذا لو خفضت المصروفات التشغيلية 15%؟",
    defaultInsights: [
      {
        type: "positive",
        title: "Higher margin",
        titleAr: "هامش أعلى",
        description: "Lower expenses directly increase net income.",
        descriptionAr: "نفقات أقل تزيد صافي الدخل مباشرة.",
      },
      {
        type: "negative",
        title: "Possible service impact",
        titleAr: "تأثير محتمل على الخدمة",
        description:
          "Aggressive cuts can reduce capacity and customer experience.",
        descriptionAr:
          "خفض مفرط قد يخفض الطاقة وتجربة العملاء.",
      },
    ],
  },
  {
    key: "supplier_change",
    name: "Switch Suppliers",
    nameAr: "تغيير الموردين",
    description: "Switch to a supplier with different cost / quality.",
    descriptionAr: "التحول إلى مورد بتكلفة وجودة مختلفة.",
    emoji: "🔄",
    parametersSchema: [
      {
        key: "cogsChangePercent",
        type: "percent",
        label: "COGS change (%)",
        labelAr: "تغير تكلفة البضاعة (%)",
        default: -10,
        min: -50,
        max: 50,
        unit: "%",
      },
      {
        key: "qualityImpactPercent",
        type: "percent",
        label: "Quality-driven revenue impact (%)",
        labelAr: "تأثير الجودة على الإيرادات (%)",
        default: 0,
        min: -30,
        max: 10,
        unit: "%",
      },
    ],
    exampleQuestion: "What if I switch to a cheaper supplier?",
    exampleQuestionAr: "ماذا لو غيرت إلى مورد أرخص؟",
    defaultInsights: [
      {
        type: "positive",
        title: "Lower unit costs",
        titleAr: "تكاليف وحدوية أقل",
        description: "COGS savings flow straight to gross margin.",
        descriptionAr: "وفر تكلفة البضاعة ينعكس مباشرة على الهامش.",
      },
      {
        type: "negative",
        title: "Quality / churn risk",
        titleAr: "خطر الجودة / الفقدان",
        description: "Cheaper suppliers may impact quality and retention.",
        descriptionAr:
          "موردون أرخص قد يؤثرون على الجودة والاحتفاظ بالعملاء.",
      },
    ],
  },
  {
    key: "open_new_branch",
    name: "Open New Branch",
    nameAr: "افتتاح فرع جديد",
    description: "Open a physical branch / location.",
    descriptionAr: "افتتاح فرع جديد.",
    emoji: "🏬",
    parametersSchema: [
      {
        key: "setupCostCents",
        type: "number",
        label: "One-time setup cost (cents)",
        labelAr: "تكلفة افتتاح (سنتات)",
        default: 50_000_000,
        min: 0,
      },
      {
        key: "monthlyFixedCostCents",
        type: "number",
        label: "Monthly fixed cost (cents)",
        labelAr: "تكلفة ثابتة شهرية (سنتات)",
        default: 8_000_000,
        min: 0,
      },
      {
        key: "monthlyRevenueCents",
        type: "number",
        label: "Steady-state monthly revenue (cents)",
        labelAr: "إيراد شهري عند الاستقرار (سنتات)",
        default: 15_000_000,
        min: 0,
      },
      {
        key: "rampMonths",
        type: "number",
        label: "Ramp (months)",
        labelAr: "أشهر التأهيل",
        default: 5,
        min: 1,
        max: 36,
      },
    ],
    exampleQuestion: "What if I open a new branch?",
    exampleQuestionAr: "ماذا لو افتتحت فرعاً جديداً؟",
    defaultInsights: [
      {
        type: "positive",
        title: "Additional revenue capacity",
        titleAr: "طاقة إيراد إضافية",
        description: "New location captures local demand.",
        descriptionAr: "الموقع الجديد يلتقط الطلب المحلي.",
      },
      {
        type: "negative",
        title: "Heavy upfront cost",
        titleAr: "تكلفة أولية كبيرة",
        description: "Setup cost is a big hit to cash in month 1.",
        descriptionAr:
          "تكلفة الإعداد ضربة كبيرة للسيولة في الشهر الأول.",
      },
    ],
  },
  {
    key: "custom",
    name: "Custom Scenario",
    nameAr: "سيناريو مخصص",
    description: "Apply a custom revenue/expense delta.",
    descriptionAr: "تطبيق تعديل مخصص على الإيرادات والمصروفات.",
    emoji: "🧪",
    parametersSchema: [
      {
        key: "revenuePercent",
        type: "percent",
        label: "Revenue change (%)",
        labelAr: "تغير الإيرادات (%)",
        default: 0,
        min: -100,
        max: 500,
        unit: "%",
      },
      {
        key: "expensePercent",
        type: "percent",
        label: "Expense change (%)",
        labelAr: "تغير المصروفات (%)",
        default: 0,
        min: -100,
        max: 500,
        unit: "%",
      },
      {
        key: "customerPercent",
        type: "percent",
        label: "Customer count change (%)",
        labelAr: "تغير عدد العملاء (%)",
        default: 0,
        min: -100,
        max: 500,
        unit: "%",
      },
    ],
    exampleQuestion: "What if revenue grows 20% and costs grow 5%?",
    exampleQuestionAr: "ماذا لو نمت الإيرادات 20% والتكاليف 5%؟",
    defaultInsights: [
      {
        type: "neutral",
        title: "Custom delta applied",
        titleAr: "تعديل مخصص مطبق",
        description: "Direct linear adjustment of baseline projections.",
        descriptionAr:
          "تعديل خطي مباشر على التوقعات الأساسية.",
      },
    ],
  },
];

export function getScenarioTemplate(
  key: SimulationScenarioKey,
): SimulationScenarioTemplate | undefined {
  return SCENARIO_TEMPLATES.find((t) => t.key === key);
}
