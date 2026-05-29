# CLAUDE.md — paperclip (adminnewtech fork)

## الأولوية القصوى: CodeGraph أولاً

**قبل أي قراءة ملف أو grep → استخدم CodeGraph MCP تلقائياً.**

CodeGraph مفهرس بالكامل: 1,339 ملف · 21,860 node · 481 API route.
يوفّر الوقت ويمنع قراءة ملفات غير ضرورية.

### متى تستخدمه

| السؤال | الأمر |
|--------|-------|
| وين موجودة هذه الدالة؟ | `codegraph query "name"` |
| كيف يشتغل هذا الجزء؟ | `codegraph context "..."` |
| من يستدعي هذه الدالة؟ | `codegraph callers "name"` |
| هذه الدالة تستدعي شنو؟ | `codegraph callees "name"` |
| لو غيّرت هذا، شنو يتأثر؟ | `codegraph impact "name"` |
| شوف بنية مجلد | `codegraph files --filter "path"` |

---

## المشروع

Fork: `adminnewtech/paperclip` ← upstream: `paperclipai/paperclip`  
Branch النشط: `feature/upstream-sync-v2026.525`  
Local dev: `http://127.0.0.1:3101` (run `pnpm dev:once`)

## إضافاتنا فوق upstream

1. **Business Management Phase 1** — `server/src/routes/business.ts` + `packages/shared/src/business-modules.ts` + `packages/db/src/schema/business_entities.ts` + 3 UI pages
2. **plugin-business-agent-tools** — `packages/plugins/plugin-business-agent-tools/` — 5 agent tools (business.query/get/create/update/summary) + approval gate للمال
3. **Routing fix** — `/business` في `UnprefixedBoardRedirect` (ui/src/App.tsx)
4. **Migration** — `0093_business_management` (بعد upstream's 0092)

## NewTech AI Company

- Company ID: `a7993e1d-ce1e-4ede-8d62-7fe4a4773548`
- Board URL: `/NEWA/`
- 16 وكيل (claude-opus-4-7 للـ C-suite، claude-sonnet-4-6 للـ ICs)
- 6 modules مفعّلة: crm, sales, inventory, finance, ecommerce, helpdesk

## قواعد العمل

- لا تعدّل `.env` أو credentials
- لا `git push` أو `git commit` إلا بطلب صريح
- كل migration جديدة تأخذ رقم أعلى من `0093`
- أي كتابة على Finance/Sales modules → approval gate إجباري
