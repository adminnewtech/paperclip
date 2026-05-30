# NewTech Business OS — Master Plan v2 (يتفوّق على Zoho One + Shopify)

> **The open lane (من بحث المنافسين):** لا أحد يجمع **نموذج بيانات موحّد + وكلاء AI مستقلين ينفّذون (لا يقترحون فقط) + GCC/ZATCA/عربي أصلي + مدفوعات محلية**. Zoho واسع لكن مجزّأ، Shopify عميق بالتجارة فقط، Odoo موحّد لكن AI ضعيف وبلا GCC، Salesforce/NetSuite حوكمة بسعر مؤسسي. **هذا التقاطع الرباعي هو ميزتنا.**

**الرؤية:** نظام تشغيل أعمال واحد، عربي‑أول، تديره قوة عمل AI مستقلة، بنموذج بيانات موحّد عبر كل الأقسام، متوافق GCC/ZATCA، بمدفوعات محلية — لشركات الكويت/الخليج.

---

## 0. الأساس الحالي (مبني ومختبر — Wave 0 ✅)

| الطبقة | الحالة |
|--------|--------|
| Multi-tenant + 16 وكيل AI + policy gate (risk-tiered approvals) | ✅ |
| نموذج بيانات: جداول عميقة (product/variant/stock/warehouse/stock_move/pos_session/pos_order) | ✅ |
| محاسبة قيد مزدوج (ledger_account/journal_entry/journal_line) | ✅ |
| **POS ذري** (منع بيع زائد مثبت حياً) + قيود متوازنة | ✅ |
| حوكمة (department/team/employee/agent_profile/agent_policy) | ✅ |
| Customer 360 · Connectors (read-only) · Multi-theme (5 palettes) · Module interconnection (reference links) | ✅ |
| عملة واعية KWD (3 خانات) · أمان read-only تجاه الأنظمة الخارجية | ✅ |
| الموديلات الضحلة (generic JSONB CRUD): crm/sales/finance/hr/helpdesk/marketing/manufacturing | ⚠️ سطحية — تحتاج تعميق |

**الفجوة الجوهرية:** معظم الموديلات الآن "قوائم CRUD عامة" فوق `business_entities` JSONB. لتتفوّق على Zoho/Shopify، كل موديل يحتاج **جداول مخصّصة + workflows حقيقية + frontend كامل + وكيل AI + إعدادات**.

---

## 1. مبادئ معمارية (تحكم كل موديل)

1. **نموذج بيانات موحّد (Odoo-style):** جداول `bos_*` مخصّصة مترابطة بـ FKs حقيقية — لا silos. CRM↔Inventory↔Finance↔Commerce يرون نفس البيانات.
2. **نمط "الموديل العميق":** كل موديل = (أ) جداول مخصّصة + migration، (ب) خدمة domain بمعاملات ذرية، (ج) routes REST، (د) صفحات React كاملة (list + detail + workflows)، (هـ) أدوات وكيل AI، (و) قسم إعدادات، (ز) اختبارات (unit + e2e).
3. **AI-native:** كل موديل يكشف أدوات للوكلاء + سياسات موافقة. الوكيل ينفّذ معاملات حقيقية عبر policy gate.
4. **GCC-first:** عربي/RTL أصلي، KWD 3 خانات، VAT toggle، ZATCA adapter، مدفوعات محلية.
5. **Governance من اليوم:** RBAC granular + audit log غير قابل للتعديل + RLS (مخطّط) على كل جدول company-scoped.
6. **معايير الجودة:** typecheck نظيف + اختبارات + معاملات ذرية + كل القوائم لها loading/empty/error + لا أزرار وهمية.

---

## 2. مصفوفة الموديولات الكاملة (كل موديل: Backend + Frontend + AI + Settings)

> لكل موديل: **DB** (جداول مخصّصة) · **API** · **UI** (صفحات) · **AI** (أدوات الوكيل) · **Settings** · **DoD** (تعريف الإنجاز)

### M1 — CRM & Sales (عمّق الموجود)
- **DB:** `bos_lead`, `bos_contact`, `bos_account`, `bos_deal` (pipeline_id, stage_id), `bos_pipeline`, `bos_pipeline_stage`, `bos_activity` (calls/emails/meetings timeline), `bos_quote`, `bos_quote_line`.
- **API:** pipelines CRUD, deal stage-move, lead→deal convert, quote→order convert, activity log.
- **UI:** Kanban pipeline (drag deals across stages), lead/deal/account/contact lists + detail, quote builder (line items), activity timeline, forecasting view.
- **AI:** lead scoring, deal next-best-action, auto-draft follow-up emails (via policy gate before send).
- **Settings:** pipelines & stages editor, lead sources, deal-loss reasons, scoring rules.
- **DoD:** drag a deal across stages live; convert lead→deal→quote→sales order; activity timeline populated.

### M2 — Accounting & Finance (عمّق نواة القيد المزدوج)
- **DB (موجود):** ledger_account/journal_entry/journal_line. **أضف:** `bos_invoice` (AR), `bos_bill` (AP), `bos_payment`, `bos_bank_account`, `bos_bank_transaction`, `bos_tax_rate`, `bos_fiscal_period`.
- **API:** invoice/bill CRUD + auto-posting to GL, payment matching, bank reconciliation, AR/AP aging, P&L + Balance Sheet + Cash Flow report endpoints, period close/lock.
- **UI:** Chart of Accounts tree, Journal entries, Invoices/Bills lists + detail, Bank reconciliation screen, Financial Statements (P&L/BS/CF with date range), AR/AP aging dashboards.
- **AI:** AP clerk (ingest bill → match PO → flag variance → queue payment), financial commentary auto-draft, cash-flow forecast.
- **Settings:** chart of accounts setup, tax rates & VAT registration, fiscal year + period lock, currencies + exchange rates, payment terms.
- **DoD:** a sale posts a balanced journal automatically (✅ already via POS); generate a real P&L + Balance Sheet from live data; reconcile a bank line.

### M3 — Inventory & Purchasing (عمّق + أضف الشراء)
- **DB (موجود):** product/variant/stock/warehouse/stock_move. **أضف:** `bos_vendor`, `bos_purchase_order` + `bos_po_line`, `bos_goods_receipt`, `bos_vendor_bill` (3-way match), `bos_stock_valuation` (FIFO/avg), serial/batch (`bos_stock_lot`).
- **API:** RFQ→PO→receipt→vendor-bill 3-way match, reorder-point auto-PO, stock valuation, transfers.
- **UI:** product catalog (variants/media), stock by warehouse, purchase orders workflow, goods receiving, vendor management, low-stock/reorder dashboard.
- **AI:** demand forecast → auto-draft PO at reorder point (policy-gated), stockout/overstock prediction.
- **Settings:** warehouses, valuation method, reorder defaults, units of measure, vendor terms.
- **DoD:** RFQ→PO→receive→bill with 3-way match; auto-reorder fires a draft PO; stock valuation correct after receipt + sale.

### M4 — Commerce & Storefront (عمّق Shopify-parity)
- **DB:** `bos_store`, `bos_store_page`, `bos_collection`, `bos_channel`, `bos_channel_listing`, `bos_discount`, `bos_cart`, `bos_online_order`, `bos_fulfillment`, `bos_shipping_zone`/`rate`.
- **API:** catalog publish to channels, cart/checkout (atomic — reuse POS engine), discount engine, shipping rate calc, fulfillment + order routing, multichannel sync.
- **UI:** storefront builder (sections/pages/theme), collections, discounts/promotions, online orders + fulfillment, shipping zones, abandoned carts, channel manager.
- **AI:** merchandiser (rewrite listings, adjust pricing), abandoned-cart recovery campaigns, SEO content gen.
- **Settings:** store domain/SEO, channels, shipping zones/rates, discount rules, checkout config.
- **DoD:** publish a product to online + POS from one inventory; online checkout decrements same stock + posts journal; discount applies; order fulfilled.

### M5 — Helpdesk & Support
- **DB:** `bos_ticket` (sla_id, channel), `bos_ticket_comment`, `bos_sla_policy`, `bos_kb_article`, `bos_kb_category`.
- **API:** ticket lifecycle + SLA timers + escalation, KB CRUD, multichannel intake (email/whatsapp).
- **UI:** ticket inbox (filters/SLA badges), ticket detail (thread + actions), SLA breach dashboard, knowledge base editor + public portal.
- **AI:** L1 support agent (auto-resolve from KB), reply assist, ticket triage/routing.
- **Settings:** SLA policies, ticket categories, channels, auto-assignment rules, business hours.
- **DoD:** ticket created → SLA timer → auto-routed → AI drafts reply → resolved; KB article searchable.

### M6 — HR & Payroll
- **DB:** employee (موجود) + `bos_attendance`, `bos_leave_request` (موجود ref) + `bos_leave_policy`, `bos_payroll_run` + `bos_payslip`, `bos_performance_review`.
- **API:** attendance check-in/out, leave request→approval workflow, payroll run (compute gross/deductions/net), payslip generation.
- **UI:** employee directory + profile, attendance calendar, leave requests + approvals, payroll run screen + payslips, org chart (✅ exists), performance reviews.
- **AI:** leave-approval recommendations, payroll anomaly detection.
- **Settings:** leave policies, working hours/shifts, salary components, pay schedule, holidays.
- **DoD:** leave request → manager approval (policy gate) → balance updated; payroll run produces payslips + posts journal.

### M7 — Projects & Services
- **DB:** `bos_project`, `bos_task` (deps, assignee), `bos_timesheet`, `bos_milestone`.
- **API:** task board, time tracking, project billing → invoice, gantt/dependency.
- **UI:** project list, kanban/gantt task board, timesheets, project P&L, client portal.
- **AI:** task estimation, timesheet auto-fill from activity, project risk flagging.
- **Settings:** project templates, billing rates, task statuses.
- **DoD:** project → tasks → log time → bill client (creates invoice).

### M8 — Marketing & Campaigns
- **DB:** `bos_campaign`, `bos_audience`/segment, `bos_email_template`, `bos_journey` (automation), `bos_campaign_metric`.
- **API:** segment builder, campaign send (email/whatsapp), journey automation, metrics.
- **UI:** campaign builder, audience segments, email template editor, journey canvas, analytics.
- **AI:** campaign content gen, audience targeting, send-time optimization, performance analysis.
- **Settings:** sender domains, templates, suppression lists, channel config.
- **DoD:** build segment → design email → send → track opens/clicks; journey triggers on event.

### M9 — Manufacturing / Subscriptions / Field Service / Rental (الفجوات التي تتفوّق على Zoho+Shopify — Wave 4)
- **Manufacturing:** `bos_bom`, `bos_work_order`, `bos_work_center`, routings → consume components, produce stock.
- **Subscriptions:** `bos_subscription`, recurring billing + dunning.
- **Field Service:** `bos_work_order_fs`, dispatch + mobile app (tech/driver), checklist/parts/signature/POD.
- **Rental:** `bos_rental_contract`, availability calendar.
- **DoD:** manufacture consumes BoM + produces finished stock with valuation; subscription auto-bills monthly.

---

## 3. صفحة الإعدادات المتكاملة (Settings/Admin Hub — الأولوية القصوى للمستخدم)

موديل واحد `/settings` بأقسام (كل قسم backend + frontend + حفظ فعلي):

| القسم | المحتوى |
|-------|---------|
| **Organization** | اسم/شعار/عنوان/الرقم الضريبي/السجل التجاري + branding (logo/colors/theme/RTL) |
| **Users & Roles** | المستخدمون، الأدوار، **صلاحيات granular** (per-module CRUD + field-level)، الفرق |
| **Finance** | شجرة الحسابات، **معدلات الضرائب + تسجيل VAT**، السنة المالية + قفل الفترات، العملات + أسعار الصرف، شروط الدفع |
| **Payments** | بوابات (KNET/mada/MyFatoorah/Tap)، BNPL (Tabby/Tamara)، Apple Pay، إعداد الحسابات البنكية |
| **Localization** | اللغة (ar/en)، **RTL toggle**، صيغة التاريخ/الأرقام، المنطقة الزمنية |
| **Automation** | باني قواعد الأتمتة (trigger→condition→action)، **عتبات موافقة AI**، المهام المجدولة |
| **Notifications** | قوالب البريد/SMS/WhatsApp/push، القنوات، SMTP |
| **Integrations** | Connectors (Shopify/Zoho/banks) — read-only، حالة المزامنة |
| **Custom Fields** | حقول مخصّصة لكل موديل |
| **Security** | 2FA/MFA، SSO/SAML، سياسة الجلسات، IP allowlist، سياسة كلمات المرور |
| **API & Webhooks** | مفاتيح API، webhooks، تطبيقات OAuth |
| **Audit Log** | عارض سجل التدقيق (غير قابل للتعديل) + تصدير |
| **Data** | استيراد/تصدير CSV، النسخ الاحتياطي |
| **Billing** | الخطة، الاستخدام، الفواتير |

---

## 4. طبقة AI المميِّزة (ما لا يقدر عليه Zoho/Shopify)

1. **وكلاء أقسام مستقلون ينفّذون:** AP clerk، support L1، merchandiser، inventory planner — معاملات حقيقية عبر policy gate (مبني الأساس ✅).
2. **موافقات AI بعتبات:** الوكيل يوافق ضمن الحد، يصعّد فوقه (مبني ✅ — يُوسّع لكل موديل).
3. **NL Ops Console:** اكتب/تكلّم "أنشئ PO لـ 200 وحدة من أرخص مورّد وأرسله" → ينفّذ عبر الأنظمة.
4. **تقرير أعمال يومي تلقائي:** AI يقرأ CRM+Inventory+Finance ويولّد ملخّصاً (لا أحد يفعلها).
5. **تنبؤ:** إعادة طلب المخزون، تدفق نقدي، churn — مع تنفيذ تلقائي.

---

## 5. طبقة الامتثال GCC

- **ZATCA Phase 2** (KSA): UBL 2.1 + CSID + UUID + QR + B2B clearance/B2C reporting — adapter اختياري per-company (مخطّط `epic-a3` + `K`).
- **VAT engine:** KSA 15% / UAE 5% / Kuwait toggle، فواتير مجمّعة ضريبياً، إقرارات VAT.
- **مدفوعات محلية:** KNET، mada، Tabby/Tamara، Apple Pay عبر MyFatoorah/Tap.
- **عربي/RTL أصلي:** UI + فواتير + بريد (logical CSS موجود؛ يُكمَّل).

---

## 6. خارطة الطريق (Waves — مرتّبة بأعلى أثر تنافسي)

**Wave 1 — Settings Hub + RBAC + Automation engine** (الأساس الذي يحتاجه كل شي + طلب المستخدم الصريح)
→ Settings module كامل (§3) + RBAC granular + audit viewer + automation rule builder.

**Wave 2 — Finance + Inventory/Purchasing depth** (نواة ERP — أكبر فجوة عن Shopify)
→ M2 (invoices/bills/bank rec/statements) + M3 (vendors/PO/3-way match/valuation).

**Wave 3 — Commerce depth (Shopify-parity)** 
→ M4 (storefront builder/collections/discounts/fulfillment/shipping/multichannel) + مدفوعات محلية.

**Wave 4 — CRM/Sales + Helpdesk + HR/Payroll + Projects + Marketing depth**
→ M1, M5, M6, M7, M8 (الموديولات العميقة).

**Wave 5 — AI autonomy + NL console + daily briefing + predictive**
→ طبقة §4 كاملة عبر كل الموديولات.

**Wave 6 — GCC compliance (ZATCA/VAT/payments) + Manufacturing/Subscriptions/Field Service**
→ §5 + M9 (الفجوات التي تتفوّق على Odoo).

**Wave 7 — Analytics/BI + polish + e2e + perf**
→ dashboards عبر الأقسام، NL queries، تقارير مجدولة، Playwright e2e شامل.

---

## 7. معايير الجودة (Definition of Done لكل موديل)
- [ ] جداول مخصّصة + migration إضافية تُطبّق نظيفة
- [ ] خدمة domain بمعاملات ذرية حيث يلزم (المال/المخزون)
- [ ] routes REST + validation + assertCompanyAccess + audit log
- [ ] صفحات React كاملة (list + detail + workflows) — loading/empty/error، RTL، لا أزرار وهمية
- [ ] أدوات وكيل AI + سياسات موافقة
- [ ] قسم إعدادات
- [ ] اختبارات: unit (خدمة) + e2e (تدفق)، typecheck نظيف
- [ ] تحقق حي عبر API + UI

---

## 8. البدء الفوري الموصى به
**Wave 1 (Settings Hub + RBAC + Automation)** — لأنه طلبك الصريح ("صفحة إعدادات متكاملة") وهو الأساس الذي تركب عليه كل الموديولات. ثم Wave 2 (Finance+Inventory) لأنها أكبر فجوة ERP.

أول مهمة تفصيلية تُكتب: `2026-05-30-wave1-settings-rbac-automation.md`.
