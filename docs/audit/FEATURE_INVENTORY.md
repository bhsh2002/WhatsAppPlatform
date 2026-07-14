# جرد الوظائف

## مفتاح الحالة

- **C — مكتملة ومتحقق منها محليًا**: أمكن تشغيلها دون اعتماد خارجي.
- **P — جزئية**: الكود والربط موجودان بدرجات مختلفة، لكن يمنع اعتبارها مكتملة عائق أو نقص موثق.
- **U — غير مربوطة**: route/screen موجودة ولا تظهر في التنقل المعتاد.
- **B — معطلة**: يوجد خلل مؤكد يمنع التدفق الأساسي.
- **T — تحتاج اختبارًا خارجيًا**: التنفيذ موجود لكن يتطلب Meta/بيانات/بيئة غير متاحة.

> **تحديث 2026-07-14:** هذا الجرد يحفظ حالة الخط الأساس. أُغلق عائق `/api` العام، ووصلت الاختبارات الآلية إلى 246 مع coverage gate وتشمل contract/security وstreaming/pagination/readiness وbackup/restore وMessenger Bot واستعلامات الرسائل وإرسال النص/القالب/التفاعل/الوسائط واكتشاف/رفع/تنزيل الوسائط وتنظيف ملفاتها وجهات الاتصال الإدارية/المستأجر/API v1 وقراءات/أحداث API v1 وتعليم القراءة والبث الإداري/المستأجر، مع عقد accessibility يفرض `h1` على كل lazy route وأسماءً لكل Dialog/IconButton/Select؛ اجتازت 4 صفحات عامة و19 صفحة إدارة و18 صفحة مستأجر `axe-core` بصفر violations، مع عينة responsive موثقة. راجع `AUDIT_SUMMARY.md` و`ISSUES_AND_GAPS.md` للحالة الحالية.

| # | الوحدة | الوظيفة | الشاشة أو API | Backend | Database | Permissions | Tests | الحالة | النواقص والملاحظات |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | Public | صفحة الهبوط | `/` | لا | لا | عام | Browser 1440/390 + semantic/keyboard contract + axe | C | متجاوبة؛ landmarks وتسلسل h1/h2/h3 وأسماء التحكم والتركيز سليمة؛ axe بلا violations، ويبقى قارئ شاشة يدوي ومراجعة incomplete اللونية |
| 2 | Public | سياسة الخصوصية React | `/privacy-policy` | لا | لا | عام | Browser 1280/390 + semantic contract | C | landmarks وتسلسل h1/h2/h3 سليمة؛ لا route إنجليزية مستقلة ولا consent workflow |
| 3 | Public | شروط الخدمة | Express `/terms` | نعم | لا | عام | Source only | P | Backend HTML فقط؛ النص في footer ليس رابطًا ولا route React |
| 4 | Auth | تسجيل الدخول | `/login`, `POST /auth/login` | نعم | `users`, `tenants` | عام + rate limit | Guard checks فقط | B | يقرأ username/password ويعيد JWT/user؛ `/api` يمنع الواجهة من الوصول افتراضيًا |
| 5 | Auth | تسجيل مستأجر ذاتيًا | tab التسجيل، `/auth/register-tenant` | نعم | `tenants`, `users`, `activity_logs` | عام + rate limit | لا | P | transaction وحالة Pending موجودان؛ لا قبول شروط ولا تحقق هاتف/بريد |
| 6 | Auth | استعادة الجلسة | `GET /auth/me` | نعم | `users`, `tenants`, `revoked_tokens` | JWT | فحص 401 | P | الواجهة تستخدم cache عند network error؛ لا test revocation/expiry |
| 7 | Auth | تسجيل الخروج وإلغاء token | `POST /auth/logout` | نعم | `revoked_tokens` | token اختياري | لا | P | route صحيح، لكن UI لا يستدعيه ويكتفي بمسح localStorage |
| 8 | Auth | تغيير كلمة المرور | `POST /auth/change-password` | نعم | `users`, `revoked_tokens` | JWT | لا | P | يعيد JWT جديدًا بعد إلغاء القديم؛ AuthContext يهمل JWT الجديد ولا توجد شاشة مستخدمة |
| 9 | Admin | لوحة المؤشرات | `/dashboard`, `/stats/*` | نعم | رسائل/مستأجرون/نشاط | admin | لا | P | إحصائيات ونشاط؛ لا freshness/empty/error E2E |
| 10 | Admin | CRUD المستأجرين | `/tenants`, `/tenants/*` | نعم | `tenants` | admin | لا | P | name/phone/Meta IDs/credits؛ يعيد حقول أسرار ويخزن access token صريحًا |
| 11 | Admin | الموافقة وحسابات المستأجر | TenantList + account endpoints | نعم | `users`, `tenants` | admin | لا | P | تفعيل/رفض/تعليق وكلمة مرور؛ يحتاج audit وسياسة lifecycle أوضح |
| 12 | Admin/Ops | فحص صحة رموز Meta | TenantList, `/tenants/token-health` | نعم + scheduler | `tenants`, `tenant_pages` | admin | لا | T | يعتمد على Meta app credentials؛ fetch بلا timeout في scheduler |
| 13 | Admin/WA | WhatsApp Console إرسال بسيط | `/whatsapp`, `/messages/send` | نعم | `messages`, billing | admin | لا | T | recipient/message/tenant؛ يحتاج Meta credentials ورقمًا حقيقيًا |
| 14 | Admin/WA | شاشة محادثة WhatsApp قديمة | `/chat` | نعم | `messages`, `contacts` | admin | لا | U | route موجود بلا عنصر Sidebar؛ يبدو مستبدلًا بـUnified Inbox |
| 15 | Admin/WA | جهات الاتصال | `/contacts`, `/messages/contacts*` | نعم | `contacts` | admin | validation/CRUD/Meta verification/read-receipt integration | C | router مستقل؛ pagination وحدود الحقول وclear/duplicate وtenant credentials والفوترة وMeta success/failure مختبرة |
| 16 | Admin/WA | البث الجماعي | `/broadcast`, `/messages/broadcast` | نعم | templates/jobs/messages/billing | admin | لا | T | recipients/template/media؛ background داخل نفس العملية بلا queue دائم |
| 17 | Admin/WA | القوالب المحلية وMeta | `/templates`, `/tenants/:id/templates*` | نعم | `templates`, activity | admin | لا | P | CRUD/sync/create موجود؛ حذف Meta محجوب بترتيب route |
| 18 | Admin/Ops | سجلات الرسائل والwebhooks | `/logs`, `/messages/logs*` | نعم | `messages`, `webhook_logs` | admin | لا | P | filtering جزئي؛ payloads حساسة ولا توجد redaction/export policy |
| 19 | Admin/Ops | Webhook failures | `/webhook-failures`, `/webhook-admin/*` | نعم | `webhook_failures` | admin | لا | P | list/retry/delete/clear؛ retry يحاكي أنواعًا محدودة وليس replay كاملًا |
| 20 | Admin | Unified Inbox | `/inbox`, `/unified/*` | نعم | WA + FB conversations/messages | admin | لا | P | channel list/messages/send/SSE؛ يحتاج Meta E2E واختبار ordering |
| 21 | Admin | الأتمتة | `/automation`, `/automation/*` | نعم | `automation_rules`, cooldowns | admin | pattern unit tests | P | CRUD/test/stats؛ regex معطل وحدود pattern مطبقة؛ يبقى UI كبير وroute integration أوسع |
| 22 | Admin | إدارة الفوترة | `/billing`, `/billing/*` | نعم | جميع billing tables | admin | math/lifecycle/period/history/invoice/Meta | P | الحسابات ودورة الرصيد والفترات/الفواتير وأسعار/إعدادات Meta محمية؛ بقية CRUD الإداري وMeta sync الفعلي ما زالا جزئيين/خارجيين |
| 23 | Admin/Ops | إعدادات وحالة النظام | `/settings`, `/settings/status` | نعم | قراءات متعددة | admin | لا | P | status سطحي؛ لا readiness/metrics/alerts |
| 24 | Admin/WA | أرقام الهاتف | `/phone-numbers`, `/phone-numbers/*` | نعم | tenant credentials | admin | لا | T | list/info/register/verify/request code عبر Meta |
| 25 | Admin/WA | اشتراكات WABA webhook | `/webhook-subscriptions` | نعم | tenants/activity | admin | لا | T | subscribe/status عبر Meta؛ لا test production callback |
| 26 | Admin/Meta | Business Manager والأصول | `/business-manager`, `/business-manager/*` | نعم | tenant credentials | admin | لا | T | businessId/ad accounts/assets/WABA؛ يحتاج صلاحيات Meta خاصة |
| 27 | Admin/Meta | شاشة ربط صفحات قديمة | `/facebook-pages` | نعم | `tenant_pages` | admin | لا | U | route موجود ولا يظهر في Sidebar؛ الوظيفة تظهر جزئيًا ضمن TenantList |
| 28 | Admin/FB | إدارة المحتوى | `/fb-manager`, `/fb-content/*` | نعم | pages/activity/billing | admin | لا | P | posts/photos/comments/likes/automation؛ يحتاج Meta E2E |
| 29 | Admin/FB | Messenger Inbox قديم | `/messenger` | نعم | `fb_conversations`, `fb_messages` | admin | لا | U | route بلا Sidebar؛ Unified Inbox يغطي جزءًا منه |
| 30 | Admin/FB | Messenger Bot | `/messenger-bot`, `/messenger-bot/*` | نعم | bot tables | admin | facade + product/flow/session/summary integration | P | 17 endpoint موزعة على routers مجالية مع عزل admin/tenant وCRUD/import/diagnostics مختبرة؛ لا Meta graph E2E |
| 31 | Admin/FB | Facebook Insights | `/fb-insights`, `/fb-insights/*` | نعم | tenant pages | admin | لا | T | overview/daily/posts؛ يعتمد على Meta insights permissions |
| 32 | Admin/Meta | Partner Solutions | `/partner-solutions`, `/partner/*` | نعم | tenants/activity | admin | لا | T | evidence/clients/WABA/system user؛ صلاحيات partner غير متاحة للفحص |
| 33 | Tenant | لوحة المستأجر | `/portal`, `/portal/dashboard` | نعم | بيانات المستأجر | tenant JWT | WhatsApp/Messenger/page/template/activity tenant A-B | C | router مستقل وaggregates مجمعة وtenant/activity allowlists وعزل متعدد القنوات |
| 34 | Tenant | Unified Inbox | `/portal/inbox` | نعم | WA/FB data | tenant JWT | لا | P | scoped by `req.user.tenant_id`; يحتاج E2E/SSE |
| 35 | Tenant | ملخص الفوترة | `/portal/billing`, `/portal/billing/*` | نعم | billing tables | tenant JWT | summary/ledger/invoice tenant A-B | C | router مستقل؛ internal metrics مخفية وperiod/filter validation وحد 100 واختبار 105 rows |
| 36 | Tenant | شاشة محادثة WhatsApp قديمة | `/portal/chat` | نعم | messages/contacts | tenant JWT | لا | U | route موجود بلا Sidebar؛ غالبًا مستبدل بـportal inbox |
| 37 | Tenant | القوالب | `/portal/templates`, `/portal/templates*` | نعم | `templates` | tenant JWT | لا | P | CRUD/sync/create؛ حذف Meta معطل بترتيب route |
| 38 | Tenant/API | إعدادات API | `/portal/api-settings`, `/portal/settings/api*` | نعم | `tenant_api_settings` | tenant JWT | credential/tenant integration | C | router مستقل؛ API key digest وsecret مشفر وعرض لمرة واحدة وSSRF/input policy وتدوير معزول |
| 39 | External API | REST v1 | `/v1/*` | نعم | messages/templates/events/billing | X-API-Key | guard 401 فقط | P | send/list/media/document/interactive/events؛ مفتاح API storage/auth يحتاج إصلاح |
| 40 | Tenant/WA | Business Profile | `/portal/business-profile` | نعم | tenants + Meta | tenant JWT | لا | P | get/update profile؛ يعتمد على Meta، validation جزئي |
| 41 | Tenant/WA | التحليلات المحلية | `/portal/analytics` | نعم | `messages` | tenant JWT | لا | P | summary/daily/type؛ لا pagination/timezone contract |
| 42 | Tenant/WA | QR Codes | `/portal/qr-codes` | نعم | activity + Meta | tenant JWT | لا | T | list/create/delete؛ يحتاج WABA حقيقيًا |
| 43 | Tenant/Meta | Conversions API | `/portal/conversions` | نعم | `conversion_events`, contacts | tenant JWT | لا | T | dataset/events/history/CTWA؛ يحتاج dataset وMeta token |
| 44 | Tenant | جهات الاتصال | `/portal/contacts` | نعم | `contacts` | tenant JWT | validation + CRUD/tenant A-B | C | router مستقل؛ E.164/field bounds وpagination/search وduplicate race وresponse allowlist وعزل الرسائل محمية |
| 45 | Tenant/WA | البث | `/portal/broadcast` | نعم | templates/jobs/messages/billing | tenant JWT | لا | P | scoped and billed؛ process-local job وعدم استئناف بعد crash |
| 46 | Tenant/WA | Embedded Signup | `/portal/whatsapp-connect` | نعم | `tenants`, activity | tenant JWT | لا | T | exchange code/store encrypted token/subscribe؛ يحتاج Meta config |
| 47 | Tenant/FB | Facebook OAuth وربط الصفحات | callback + `/portal/fb-pages` | نعم | `tenants`, `tenant_pages` | tenant JWT | لا | T | state in-memory؛ يفقد عند restart/multi-instance؛ يحتاج Meta login |
| 48 | Tenant/Meta | Meta Review readiness | `/portal/meta-review` | نعم | review checks/activity | tenant JWT | لا | P | evidence snapshots/readiness؛ صحة خارجية لم تُتحقق |
| 49 | Tenant/FB | إدارة المحتوى | `/portal/fb-content` | نعم | pages/activity/billing | tenant JWT | لا | P | posts/comments/likes + automation؛ تكرار admin UI/route logic |
| 50 | Tenant | الأتمتة | `/portal/automation` | نعم | automation tables | tenant JWT | CRUD/tenant A-B integration | P | router مستقل وCRUD/stats/filters/cascade معزولة؛ يبقى UI E2E والتوحيد مع admin |
| 51 | Tenant/FB | Insights | `/portal/fb-insights` | نعم | tenant pages | tenant JWT | لا | T | overview/daily/posts؛ يحتاج صلاحيات Meta |
| 52 | Tenant/FB | Messenger Bot | `/portal/messenger-bot` | نعم | bot tables | auth + `tenantMiddleware` | facade + product/flow/session/summary tenant isolation | P | نفس UI بوضع tenant؛ العزل مركزي ومختبر، ويبقى UI/Meta E2E |
| 53 | Webhook | استقبال Meta events | `GET/POST /webhook` | نعم | logs/messages/FB/billing | عام + HMAC عند ضبطه | signature tests غير موجودة | P | WhatsApp/Page/Messenger/status; يمكن تخطي signature إذا لم يضبط secret |
| 54 | Integrations | Forward webhook/status callback | إعدادات tenant + fetch | نعم | settings/failures | tenant config | لا | P | HMAC/retry/timeout؛ URL غير مقيد يسمح SSRF |
| 55 | Compliance | Data deletion callback/status | `/data-deletion`, `/deletion-status` | نعم | FB data/activity | Meta signed request | لا | B | يحذف `fb_conversations` فقط ويعلن حذف كل البيانات؛ سجلات أخرى تبقى |
| 56 | Database | Migration runner | startup + `migrator.js` | نعم | `_migrations` + schema | startup | fresh DB | C | 37/37 نجحت على DB جديدة؛ upgrade 018 له فقد بيانات منفصل |
| 57 | Operations | النسخ الاحتياطي | `scripts/backup.sh` + Node service | نعم | SQLite file | operator | 3 backup/restore tests | P | online snapshot وفحص quick/FK قبل وبعد restore وretention؛ لا scheduler/off-host encryption |
| 58 | Operations | التنظيف وفحص الرموز | `maintenance.js` | نعم | logs/tokens/files | process | لا | P | process-local timers؛ لا distributed lock ولا metrics |

## الملخص الرقمي

| الحالة | العدد |
|---|---:|
| C — مكتملة ومتحقق منها | 4 |
| P — جزئية | 35 |
| U — غير مربوطة | 4 |
| B — معطلة | 2 |
| T — تحتاج اختبارًا خارجيًا | 13 |
| **الإجمالي** | **58** |

## الشاشات غير المربوطة

1. `/chat` — WhatsAppChat للإدارة.
2. `/facebook-pages` — شاشة صفحات إدارية منفصلة.
3. `/messenger` — MessengerInbox القديم.
4. `/portal/chat` — TenantChat القديم.

لا ينبغي حذفها قبل مقارنة استخدامها الخارجي وروابط bookmarks. القرار المقترح: إما ربطها صراحة، أو وسمها deprecated مع redirect ثم حذفها في إصدار لاحق.
