# المشاكل والنواقص

> **ملاحظة الحالة — 2026-07-15:** التفاصيل أدناه تحفظ دليل الاكتشاف الأصلي. حالة التنفيذ الحالية موضحة في الجدول التالي ولا تعني حذف الحاجة إلى مراجعة مستقلة أو Meta E2E.

| الحالة الحالية | البنود |
|---|---|
| مغلقة ومتحقق منها محليًا | AUD-001، AUD-002، AUD-003، AUD-004، AUD-005، AUD-006، AUD-007، AUD-008، AUD-009، AUD-011، AUD-012، AUD-013، AUD-014، AUD-015، AUD-016، AUD-017، AUD-019، AUD-020، AUD-021، AUD-024، AUD-026، AUD-027، AUD-028 |
| مغلقة جزئيًا | AUD-010: أضيف 246 اختبارًا وبوابة `c8 --all` تشمل كل مصادر الخادم بحدود دنيا؛ تشمل auth/cookie/role/tenant وpagination ورفع/تنزيل/تنظيف الملفات واستعلامات الرسائل وإرسال النص/القالب/التفاعل/الوسائط عبر الإدارة والمستأجر/API v1 وقراءات/أحداث API v1 وجهات الاتصال والتحقق عبر Meta وتعليم القراءة وفوترة quote/account/usage/ledger/summary/period/history/invoice وMeta analytics/rates/pricing/message-cost/status/settings/usage/sync/reconciliation والبث الإداري/المستأجر وrestore/metrics/bootstrap ودلالات الصفحات العامة والخاصة وكل routers البوابة المجالية وكتالوج/تدفقات/جلسات/ملخص Messenger Bot وعقود تركيب facades وعميل API ومشاركة UI وترقية migration ذرية، لكن التغطية ليست شاملة؛ AUD-018: أصبح `tenantPortal` composition facade عند 208 أسطر/صفر endpoints، و`messengerBot.js` facade عند 21 سطرًا فوق أربعة routers مجالية ووحدة مشتركة، وتحول `messages.js` من 1,707 سطرًا/20 endpoint إلى facade من 19 سطرًا/صفر endpoints باستخراج sends/media/queries/broadcast/contacts/read-receipts، وفُصلت وسائط المستأجر، وانخفض `api/v1.js` من 876 إلى composition facade من 45 سطرًا بعد استخراج routers الإرسال والقراءات والأحداث، مع processor بث وتحقق رسائل مشتركين، وتحول billing إلى facade فوق 18 وحدة، وتحول API client إلى facade فوق خمس وحدات، وأزيلت الحدود المكررة من المجالات الخمسة في UI؛ بقي ضبط أحجام بعض الوحدات المجالية؛ AUD-022: readiness/JSON logs/request IDs و5m/operational metrics وPrometheus rules وbackup/restore أضيفت وبقي tracing وتسليم Alertmanager والنسخ off-host خارجيًا؛ AUD-023: نجح build وتشغيل الصورتين بمستخدمين غير جذريين وrootfs للقراءة فقط وcap-drop/no-new-privileges، ونجح health وSPA وproxy، وبقي فحص CVE لأن Scout يحتاج Docker ID وقاعدة Trivy لم تُنزّل من المرآتين؛ AUD-025: أصلحت semantics/autocomplete/labels/focus والتنقل، وفُرضت أسماء على 40 حوارًا و92 زرًا أيقونيًا و73 حقل `Select`، ونُفذ Browser DOM sweep لكل 19 مسار إدارة و18 مسار مستأجر عند 1440 مع عينة keyboard/responsive وحوار فعلي عند 390، ثم أُصلحت نتائج axe على 41 مسارًا حتى صفر violations؛ بقي قارئ شاشة يدوي كامل وحالات rows الغنية ونتائج incomplete اللونية |
| مفتوحة | لا توجد بنود اكتشاف مفتوحة بالكامل؛ بقيت بنود جزئية واختبارات/إعدادات خارجية |

أدلة الإغلاق تشمل اختبارات العقد/الأمان، client build، syntax checks، Docker Compose validation، وruntime smoke لعقد `/api` والتوقيع ونطاق media token ودورة بيانات اعتماد API. تشمل كذلك اختبار tenant A/B فعليًا، ودورة cookie/logout/password/legacy rotation/role/status، وحدود القوائم وعزل read على قواعد مؤقتة مهاجرة. أضيف CI وDependabot وsecret history scan، ونجح Gitleaks محليًا على 319 commit دون تسريب. تم تنفيذ dry-run لترحيل credentials وكانت أعداد plaintext في قاعدة البيئة الحالية صفرًا.

## ملخص التصنيف

| Severity | العدد | الأولويات الغالبة |
|---|---:|---|
| Critical | 2 | P0 |
| High | 10 | P0–P1 |
| Medium | 12 | P1–P2 |
| Low | 4 | P3 |
| Informational | 0 | — |
| **الإجمالي** | **28** | — |

| ID | العنوان | التصنيف | المكون | Severity | Priority | Effort |
|---|---|---|---|---|---|---|
| AUD-001 | عقد `/api` وNginx/Express غير متطابق | تشغيل/تكامل | Client + Nginx + Server | Critical | P0 | S |
| AUD-002 | الإعداد المحلي يفتقد `CRYPTO_KEY` الإلزامي | إعداد | Server | Critical | P0 | XS |
| AUD-003 | تخزين وإرجاع رموز Meta بصيغة صريحة | أمان/أسرار | Tenants API | High | P0 | M |
| AUD-004 | مفاتيح API وwebhook secret نص صريح ومسار hash غير مستخدم | أمان | API Settings | High | P0 | M |
| AUD-005 | media token يصلح لأي route محمي | تفويض | Auth middleware | High | P0 | S |
| AUD-006 | URLs الخاصة بالمستأجر تسمح SSRF | أمان شبكي | Callbacks/Webhooks | High | P1 | M |
| AUD-007 | حذف البيانات جزئي مع ادعاء حذف كامل | خصوصية/بيانات | Data deletion | High | P1 | M |
| AUD-008 | 21 حزمة متأثرة حسب npm audit | اعتماديات/أمان | Client + Server | High | P1 | M |
| AUD-009 | حذف قالب Meta محجوب بترتيب routes | وظيفة | Templates | High | P1 | XS |
| AUD-010 | لا توجد اختبارات آلية | جودة/مخاطر | المشروع كاملًا | High | P1 | XL |
| AUD-011 | Docker لا يفرض production؛ webhook قد يقبل بلا signature | أمان/نشر | Compose + Webhooks | High | P0 | S |
| AUD-012 | regex يحدده المستأجر يعمل بلا قيود | أمان/أداء | Automation | High | P1 | M |
| AUD-013 | Migration 018 تحذف cooldowns القائمة | بيانات/Migration | DB | Medium | P1 | S |
| AUD-014 | ترحيل الأسرار القديمة موثق يدويًا لكنه غير منفذ | بيانات/أمان | Migration 010 | Medium | P1 | M |
| AUD-015 | API-key auth مسح O(n) مع bcrypt متسلسل | أداء/Auth | API v1 | Medium | P2 | M |
| AUD-016 | معظم Meta fetch بلا timeout/retry policy | استقرار | Meta integrations | Medium | P2 | L |
| AUD-017 | قراءات غير محدودة وbuffering كامل للوسائط | أداء | Messaging/Lists | Medium | P2 | M |
| AUD-018 | ملفات ضخمة وتكرار admin/tenant | دين تقني | Client + Server | Medium | P2 | XL |
| AUD-019 | تغيير كلمة المرور يترك الواجهة على token ملغى | وظيفة/Auth | AuthContext | Medium | P1 | XS |
| AUD-020 | logout لا يستدعي الإلغاء وJWT في localStorage | أمان جلسات | Client Auth | Medium | P2 | S |
| AUD-021 | لا يوجد tenant-only middleware مركزي | تفويض | Portal mounts | Medium | P1 | S |
| AUD-022 | Health/logging/monitoring غير كافية | تشغيل | Server/Ops | Medium | P2 | L |
| AUD-023 | صور Docker غير حتمية وتعمل root وشبكة خارجية غير موثقة | نشر | Docker | Medium | P2 | M |
| AUD-024 | قيود DB والتزامن غير كافيين | بيانات/توسع | SQLite schema | Medium | P2 | M |
| AUD-025 | نواقص Accessibility في الصفحات العامة | UX/A11y | Login/Landing | Low | P3 | S |
| AUD-026 | أربع شاشات غير مربوطة وشروط الاستخدام بلا رابط | UX/وظائف | Routing | Low | P3 | S |
| AUD-027 | توثيق التشغيل متناقض وقالب Vite باقٍ | توثيق | README/DEPLOY | Low | P3 | S |
| AUD-028 | نظافة محلية ورسائل commits ضعيفة | مستودع | Git | Low | P3 | S |

## التفاصيل

### AUD-001 — عقد `/api` وNginx/Express غير متطابق

- **التصنيف/المكون/المسار:** تشغيل وتكامل؛ `client/src/api/index.js:1-47`, `client/vite.config.js:8-16`, `client/nginx.conf:1-10`, `server/server.js:438-506`.
- **الوصف والدليل:** العميل يضيف `/api` ويستخدم في التطوير `http://localhost:3031` مباشرة، فيتجاوز Vite proxy ولا تُحذف البادئة. في الإنتاج يطلب Nginx نفسه، لكن Nginx لا يملك `location /api/`. Express مركب على `/auth`, `/tenants`, إلخ بلا `/api`.
- **التأثير/السبب الجذري:** كل وظيفة UI→Backend معطلة في التكوين الموثق؛ contract موزع ومتباين.
- **Severity/Priority/Effort:** Critical / P0 / S.
- **الإجراء:** اعتماد contract واحد واختبار smoke: إما relative `/api` + proxy في Vite/Nginx، أو mount `/api` في Express. إضافة CORS origin الصحيح إن استُخدم اتصال مباشر.
- **الاعتماديات/مخاطر التنفيذ:** كل عميل API ومسارات callback؛ خطر مضاعفة البادئة.
- **التحقق:** login من browser، `/api/health` عبر Nginx، وباقي guard status في dev وDocker.

### AUD-002 — الإعداد المحلي يفتقد `CRYPTO_KEY`

- **التصنيف/المكون/المسار:** إعداد؛ `server/.env` (تم فحص أسماء المفاتيح فقط)، `server/server.js:79-106`, `README.md:3-18`.
- **الوصف والدليل:** الملف المحلي لا يعرّف المفتاح الإلزامي؛ startup validation يخرج برمز 1. لم تُعرض أي قيمة سرية.
- **التأثير/السبب الجذري:** يمنع تشغيل الخادم الحالي؛ drift بين `.env.example` والملف المحلي.
- **Severity/Priority/Effort:** Critical / P0 / XS.
- **الإجراء:** توليد مفتاح 32-byte hex وإدارته عبر secret store؛ لا commit.
- **الاعتماديات/المخاطر:** تغيير مفتاح قائم يجعل ciphertext القديم غير قابل للفك؛ يجب تمييز bootstrap الجديد عن rotation.
- **التحقق:** startup ناجح + decrypt fixture/health دون طباعة المفتاح.

### AUD-003 — رموز Meta تُخزن وتُعاد بصيغة صريحة

- **التصنيف/المكون/المسار:** أمان وأسرار؛ `server/routes/tenants.js:21-25,138-180,199-240`, `server/services/credentials.js:10-40`.
- **الوصف والدليل:** CRUD الإداري يكتب `access_token` plaintext ويعيد `SELECT *`; fallback يواصل قراءته. ciphertext وحقول token الأخرى تعاد كذلك.
- **التأثير/السبب الجذري:** تسرب عبر response/browser state/log/XSS أو DB compromise؛ legacy compatibility بقيت في المسار الأساسي.
- **Severity/Priority/Effort:** High / P0 / M.
- **الإجراء:** تشفير عند الكتابة، تصفير plaintext، DTO allowlist، redaction، وخطة rotation.
- **الاعتماديات/المخاطر:** بيانات قديمة ومفتاح CRYPTO؛ يلزم backup واختبار decrypt قبل التصفير.
- **التحقق:** مسح DB يثبت NULL للplaintext؛ responses لا تحوي أي token field؛ Meta smoke ينجح.

### AUD-004 — مفاتيح API وwebhook secret نص صريح

- **التصنيف/المكون/المسار:** أمان؛ `server/routes/tenantPortal.js:2171-2244`, `server/middleware/apiKeyAuth.js:21-43`, `server/db/migrations/010_encrypt_sensitive_data.sql:6-18`.
- **الوصف والدليل:** GET يعيد `SELECT *`; الإنشاء والتدوير يكتبان `api_key`; `api_key_hash` لا يُكتب. `hashApiKey` غير مستخدم. المفتاح قابل للقراءة دائمًا بدل العرض مرة واحدة.
- **التأثير/السبب الجذري:** كشف credential وإطالة عمره؛ migration غير مكتملة.
- **Severity/Priority/Effort:** High / P0 / M.
- **الإجراء:** عرض المفتاح مرة واحدة، تخزين digest indexed/prefix، تشفير webhook secret، وإلغاء fallback بعد migration.
- **الاعتماديات/المخاطر:** clients الحالية تحتاج rotation نافذة انتقالية.
- **التحقق:** DB لا تحوي plaintext؛ old key يفشل بعد rotation؛ lookup ثابت الزمن/مفهرس.

### AUD-005 — media token يصلح لأي route محمي

- **التصنيف/المكون/المسار:** تفويض؛ `server/middleware/auth.js:41-70`, `server/server.js:475-503`.
- **الوصف والدليل:** `authMiddleware` يقبل `?media_token=` عامًا ويضع role، ثم يمرر request دون فحص المسار أو المستخدم/revocation. admin media token يجتاز `adminMiddleware`.
- **التأثير/السبب الجذري:** token مفترض للصور يتحول إلى bearer كامل لمدة 5 دقائق وقد يتسرب عبر URL/referrer.
- **Severity/Priority/Effort:** High / P0 / S.
- **الإجراء:** middleware مستقل على GET media المحددة فقط، audience + resource/tenant binding، وعدم تضمين admin role العام.
- **الاعتماديات/المخاطر:** `<img>/<video>` الحالية؛ تحديث URL builders.
- **التحقق:** media URL ينجح، نفس token على `/tenants` وPOST routes يعطي 401/403.

### AUD-006 — SSRF عبر webhook/callback URL

- **التصنيف/المكون/المسار:** أمان شبكي؛ `tenantPortal.js:2197-2225`, `webhooks.js:60-124,132-167`, `api/v1.js:44-59`.
- **الوصف والدليل:** tenant يستطيع حفظ URL اعتباطي؛ الخادم ينفذ fetch إليه ولا يمنع loopback/private/link-local أو redirects.
- **التأثير/السبب الجذري:** probing لخدمات داخلية/metadata وإرسال payloads إليها.
- **Severity/Priority/Effort:** High / P1 / M.
- **الإجراء:** HTTPS allowlist أو DNS/IP validation في كل redirect، منع private ranges، egress policy، وverification challenge.
- **الاعتماديات/المخاطر:** integrations ذات عناوين داخلية حالية قد تتوقف.
- **التحقق:** URLs عامة مصرح بها تعمل؛ localhost/RFC1918/metadata/redirect إليها تُرفض.

### AUD-007 — حذف البيانات جزئي ومضلل

- **التصنيف/المكون/المسار:** خصوصية/بيانات؛ `server/server.js:350-435`.
- **الوصف والدليل:** يحذف `fb_conversations` فقط، بينما `bot_sessions.user_psid`, raw webhook logs/failures وpayloads قد تبقى؛ يسجل user id ثم يعرض أن «جميع البيانات» حُذفت.
- **التأثير/السبب الجذري:** عدم امتثال وطلبات حذف غير مكتملة، ولا سجل حالة قابل للتحقق.
- **Severity/Priority/Effort:** High / P1 / M.
- **الإجراء:** data map، transaction، pseudonymous deletion request table، purge لكل نسخ/سجلات/ملفات وفق السياسة، وصف صادق للحالة.
- **الاعتماديات/المخاطر:** متطلبات retention/audit القانونية؛ لا تحذف أدلة واجبة دون سياسة.
- **التحقق:** fixtures عبر كل الجداول؛ FK/payload scan بعد callback؛ صفحة الحالة تقرأ سجلًا حقيقيًا.

### AUD-008 — ثغرات اعتماديات

- **التصنيف/المكون/المسار:** أمان supply-chain؛ `client/package-lock.json`, `server/package-lock.json`.
- **الوصف والدليل:** `npm audit --json`: client 13 (7 High/5 Moderate/1 Low)، server 8 (3 High/5 Moderate). direct affected تشمل Vite/react-router-dom وmulter/form-data/express/rate-limit.
- **التأثير/السبب الجذري:** DoS/path traversal/XSS/CRLF حسب مسار الاستخدام؛ lockfiles قديمة نسبيًا.
- **Severity/Priority/Effort:** High / P1 / M.
- **الإجراء:** upgrade منفصل لكل تطبيق، مراجعة advisories وقابلية الاستغلال، `npm ci`, audit gate.
- **الاعتماديات/المخاطر:** major/minor regressions؛ يلزم tests أولية.
- **التحقق:** audit بلا High/Critical + build/lint/smoke.

### AUD-009 — حذف قالب Meta محجوب

- **التصنيف/المكون/المسار:** وظيفة؛ `tenantPortal.js:1825-1843,2123-2154`, `tenants.js:694-710,998-1030`.
- **الوصف والدليل:** DELETE parameter routes تسبق literal `delete-meta` وتلتقطه كـid/templateId. فحص ترتيب static كشف الحالتين؛ tenant UI يستدعي المسار المتأثر.
- **التأثير/السبب الجذري:** حذف Meta يفشل 404 محليًا ولا يصل Meta.
- **Severity/Priority/Effort:** High / P1 / XS.
- **الإجراء:** نقل literal routes قبل dynamic أو تغيير path إلى `/meta-templates/:name`.
- **الاعتماديات/المخاطر:** clients الحالية؛ احفظ alias مؤقتًا.
- **التحقق:** integration test يثبت وصول handler الصحيح وعدم حذف template محلي خطأ.

### AUD-010 — غياب الاختبارات الآلية

> **تحديث 2026-07-14:** توجد الآن 246 حالة ناجحة وبوابة CI تستخدم `c8 --all` حتى تحسب الملفات غير المحملة ضمن `routes/services/middleware/db`. خط الأساس الحالي 51.51% statements/lines و66.74% branches و71.22% functions، والحدود الدنيا 51/51/66/71. أضيفت تغطية فعلية لاستعلامات الرسائل وإرسال النص/القالب/التفاعل/الوسائط واكتشاف/تنزيل/رفع الوسائط وتنظيف الملفات وجهات الاتصال الإدارية والمستأجر وAPI v1 وقراءات/أحداث API v1 والتحقق عبر Meta وتعليم القراءة والبث الإداري/المستأجر، وأُصلح تمرير tenant credentials في التحقق وحقن DB في إثراء القالب. بقي البند جزئيًا لأن browser/Meta E2E غير مكتمل ولأن التغطية تحتاج رفعًا تدريجيًا في الوحدات ذات الصفر أو النسب المنخفضة.

- **التصنيف/المكون/المسار:** جودة؛ `client/package.json:6-10`, `server/package.json:7-10`, `tests/fixtures/webhook_ex.json`.
- **الوصف والدليل:** لا test scripts ولا ملفات test/spec؛ coverage غير قابلة للقياس.
- **التأثير/السبب الجذري:** regressions عالية في الفوترة والعزل والمigrations؛ النمو الوظيفي سبق بنية الاختبار.
- **Severity/Priority/Effort:** High / P1 / XL مجزأ.
- **الإجراء:** contract/auth/DB tests أولًا، ثم billing/webhook/integration، ثم UI E2E.
- **الاعتماديات/المخاطر:** يحتاج DB factory وعزل Meta client.
- **التحقق:** CI ثابت، coverage للأجزاء الحرجة، regression لـAUD-005/009/013.

### AUD-011 — production mode غير مفروض وwebhook قد يقبل unsigned

- **التصنيف/المكون/المسار:** أمان نشر؛ `docker-compose.yml:5-12`, `server/server.js:91-99`, `webhooks.js:198-219`.
- **الوصف والدليل:** fail-fast لMeta secrets يعمل فقط عند `NODE_ENV=production`; Compose لا يضبطه، وعند غياب secret webhook يسجل warning ويتابع.
- **التأثير/السبب الجذري:** حقن events/fraud/رسائل وفوترة إذا نشر الإعداد كما هو.
- **Severity/Priority/Effort:** High / P0 / S.
- **الإجراء:** production default في image/Compose، fail-closed دائمًا إلا flag test صريح، secret readiness.
- **الاعتماديات/المخاطر:** بيئات dev تحتاج secret test أو تعطيل endpoint.
- **التحقق:** startup production يفشل دون secret؛ webhook unsigned يعيد 403.

### AUD-012 — regex غير مقيد في الأتمتة

- **التصنيف/المكون/المسار:** أمان/أداء؛ `autoResponder.js:249-273`, صفحات/Routes Automation.
- **الوصف والدليل:** tenant يدخل pattern، و`new RegExp(...).test()` ينفذ على webhook message داخل event loop بلا timeout/engine آمن.
- **التأثير/السبب الجذري:** catastrophic backtracking وDoS.
- **Severity/Priority/Effort:** High / P1 / M.
- **الإجراء:** إزالة regex للمستأجر أو RE2/safe-regex validation وحدود طول.
- **الاعتماديات/المخاطر:** قواعد موجودة قد تصبح غير مدعومة.
- **التحقق:** corpus خبيث لا يعلق العملية؛ validation واضح.

### AUD-013 — Migration 018 تحذف cooldowns

- **التصنيف/المكون/المسار:** بيانات؛ `017_automation_rules.sql:44-53`, `018_automation_post_scope.sql:56-76`.
- **الوصف والدليل:** اختبار ترقية مؤقت أدخل cooldown قبل 018؛ العدد انتقل من 1 إلى 0 بسبب إسقاط parent مع ON DELETE CASCADE.
- **التأثير/السبب الجذري:** فقد حالة cooldown وإمكان إرسال ردود مكررة بعد upgrade.
- **Severity/Priority/Effort:** Medium / P1 / S.
- **الإجراء:** وثق الأثر؛ migration repair للمستقبل وupgrade test من snapshots. لا يمكن استعادة ما حُذف بلا backup.
- **الاعتماديات/المخاطر:** قواعد مثبتة أقدم من 018.
- **التحقق:** test seed يحافظ على cooldown أو يهاجره مقصودًا.

### AUD-014 — ترحيل الأسرار القديمة غير منفذ

- **التصنيف/المكون/المسار:** بيانات/أمان؛ `010_encrypt_sensitive_data.sql:6-18`, `credentials.js:20-39`.
- **الوصف والدليل:** migration تطلب يدويًا script لتشفير tokens/hash keys، ولا يوجد script؛ fallback باقٍ.
- **التأثير/السبب الجذري:** بيانات legacy تظل plaintext بلا مؤشر completeness.
- **Severity/Priority/Effort:** Medium / P1 / M.
- **الإجراء:** idempotent migration command مع dry-run/count/backup/verification ثم إزالة fallback.
- **الاعتماديات/المخاطر:** صحة CRYPTO_KEY وrotation.
- **التحقق:** counts plaintext=0؛ decrypt وAPI key auth ينجحان.

### AUD-015 — API-key auth غير قابل للتوسع

- **التصنيف/المكون/المسار:** أداء/Auth؛ `apiKeyAuth.js:21-43`.
- **الوصف والدليل:** SELECT لكل settings ثم bcrypt.compare متسلسلًا حتى التطابق.
- **التأثير/السبب الجذري:** CPU/latency O(n)، ويسهل استنزافه عند keys كثيرة.
- **Severity/Priority/Effort:** Medium / P2 / M.
- **الإجراء:** key id/prefix + indexed digest constant-time؛ rate limit منفصل لـv1.
- **الاعتماديات/المخاطر:** تدوير keys وعقد headers.
- **التحقق:** query plan index؛ benchmark ثابت تقريبًا مع نمو tenants.

### AUD-016 — Meta fetch بلا policy موحدة

- **التصنيف/المكون/المسار:** استقرار؛ أمثلة `metaApi.js:89-165`, `tokenMonitor.js:53-216`, معظم routes.
- **الوصف والدليل:** عشرات fetch بلا `AbortSignal.timeout`; retry موجود فقط في callbacks تقريبًا.
- **التأثير/السبب الجذري:** requests/scheduler معلقة، استنزاف sockets، UX غير متوقع.
- **Severity/Priority/Effort:** Medium / P2 / L.
- **الإجراء:** Meta client مركزي بtimeout/error mapping/retry idempotent/circuit breaker محدود.
- **الاعتماديات/المخاطر:** POST غير idempotent؛ لا retry دون idempotency.
- **التحقق:** fault-injection timeout/5xx/429 tests.

### AUD-017 — قراءات ووسائط غير محدودة

- **التصنيف/المكون/المسار:** أداء؛ `messages.js:432-455,513-550`, `tenants.js:21-25`, templates lists.
- **الوصف والدليل:** chat يعيد كل التاريخ صراحة، tenants/templates lists كاملة، media proxy يستخدم `arrayBuffer()`.
- **التأثير/السبب الجذري:** memory/latency يتزايدان مع البيانات والملفات.
- **Severity/Priority/Effort:** Medium / P2 / M.
- **الإجراء:** cursor pagination، limits قصوى، streaming media، content-length guard.
- **الاعتماديات/المخاطر:** UI يعتمد حاليًا على all history.
- **التحقق:** load test وmemory ceiling وpagination contract.

### AUD-018 — ملفات ضخمة وتكرار

> **تحديث 2026-07-14:** أصبح `tenantPortal.js` composition facade عند 208 أسطر وصفر endpoints، وتحول `messengerBot.js` من 987 سطرًا إلى facade من 21 سطرًا فوق routers مستقلة للملخص والمنتجات/الأصول والتدفقات والجلسات مع وحدة سياسات مشتركة، وتحول `messages.js` من 1,707 سطرًا/20 endpoint إلى facade من 19 سطرًا/صفر endpoints بعد استخراج الإرسال والوسائط والاستعلامات والبث وجهات الاتصال وتعليم القراءة إلى routers محقونة ومختبرة، وفُصلت وسائط WhatsApp للمستأجر في `tenantWhatsAppMedia.js`، وانخفض `api/v1.js` من 876 إلى composition facade من 45 سطرًا بعد استخراج الإرسال والقراءات والأحداث إلى `api/v1Messaging.js` و`api/v1Queries.js` و`api/v1Events.js` مع تحقق/عزل/نافذة/فوترة واختبارات سلوكية. وُحّدت معالجة دفعات البث والتحقق من الرسائل بين الإدارة والمستأجر وAPI v1، وأُصلح إثراء fallback القالب ليستخدم DB المحقونة، وتحول service الفوترة إلى facade من 267 سطرًا فوق 18 وحدة، وتحول `api/index.js` من 2,027 إلى facade من 292 سطرًا فوق خمس وحدات مجال تحمل 265 method. تشترك الآن واجهات الأتمتة والقوالب وجهات الاتصال والبث ومحتوى Facebook في config/presentation/validation المجالي، مع adapters وصلاحيات منفصلة. تحمي الحدود 246 اختبارًا وبوابة coverage والبناء/lint؛ يبقى البند جزئيًا بسبب orchestration العميق داخل بعض الصفحات والـrouters المجالية الكبيرة.

- **التصنيف/المكون/المسار:** دين تقني؛ `tenantPortal.js` 5,522، `billing.js` 3,682، `api/index.js` 2,027، صفحات متكررة.
- **الوصف والدليل:** مسؤوليات متعددة ونسخ admin/tenant؛ route shadow مثال لنتيجة عملية.
- **التأثير/السبب الجذري:** تغييرات متباينة، review واختبار أصعب.
- **Severity/Priority/Effort:** Medium / P2 / XL مقسم.
- **الإجراء:** بعد tests، استخراج routers/services/API modules حسب المجال، ومشاركة UI composition.
- **الاعتماديات/المخاطر:** refactor واسع بلا tests خطر؛ يجب مراحل صغيرة.
- **التحقق:** no behavior change contract tests، انخفاض حجم/duplication.

### AUD-019 — token تغيير كلمة المرور لا يُعتمد

- **التصنيف/المكون/المسار:** وظيفة/Auth؛ `auth.js:188-227`, `AuthContext.jsx:143-153`.
- **الوصف والدليل:** Backend يلغي token الحالي ويعيد جديدًا؛ context يهمل response ولا يحدث storage/API.
- **التأثير/السبب الجذري:** الطلب التالي 401 وتجربة جلسة مربكة.
- **Severity/Priority/Effort:** Medium / P1 / XS.
- **الإجراء:** اعتماد token الجديد atomically أو logout صريح بعد نجاح التغيير.
- **الاعتماديات/المخاطر:** UX/جلسات متعددة.
- **التحقق:** E2E change password ثم request محمي/login قديم يفشل.

### AUD-020 — logout محلي وJWT في localStorage

- **التصنيف/المكون/المسار:** أمان جلسات؛ `AuthContext.jsx:5-37,137-142`, `auth.js:171-185`.
- **الوصف والدليل:** UI لا يستدعي logout server؛ JWT قابل للقراءة من JavaScript.
- **التأثير/السبب الجذري:** token المسروق يظل فعالًا؛ XSS أثره أكبر.
- **Severity/Priority/Effort:** Medium / P2 / S.
- **الإجراء:** call logout ثم clear؛ قيّم HttpOnly same-site cookie أو BFF مع CSRF controls.
- **الاعتماديات/المخاطر:** SSE/media token patterns وCORS.
- **التحقق:** token القديم يعطي 401 بعد logout؛ CSP/XSS tests.

### AUD-021 — لا tenant-only middleware

- **التصنيف/المكون/المسار:** تفويض؛ `server/server.js:498-500`.
- **الوصف والدليل:** `/portal` يتطلب auth فقط؛ كل handler مسؤول عن `req.user.tenant_id`. مستخدم عام/admin يمكنه الوصول للrouter حتى لو أخفقت الاستعلامات لاحقًا.
- **التأثير/السبب الجذري:** fail-open محتمل عند endpoint جديد، وتباين ownership.
- **Severity/Priority/Effort:** Medium / P1 / S.
- **الإجراء:** `tenantMiddleware` يفرض tenant_id/user status، وpolicy helpers للملكية.
- **الاعتماديات/المخاطر:** admin support workflows يجب أن تستخدم routes إدارية صريحة.
- **التحقق:** role matrix tests لكل mount.

### AUD-022 — جاهزية تشغيل ومراقبة ضعيفة

- **التصنيف/المكون/المسار:** تشغيل؛ `server.js:209-212`, request logging `182-186`, Compose بلا healthchecks.
- **الوصف والدليل:** health يعيد ok دون DB/migration؛ logs نصية؛ لا metrics/tracing/alerts/rotation خارج DB cleanup.
- **التأثير/السبب الجذري:** نشر مع DB غير صالح أو Meta misconfig، وتشخيص بطيء.
- **Severity/Priority/Effort:** Medium / P2 / L.
- **الإجراء:** liveness/readiness منفصلان، structured/redacted logs، metrics وalerts وrunbooks.
- **الاعتماديات/المخاطر:** لا تجعل readiness تعتمد على Meta transient بالكامل.
- **التحقق:** probes وفشل DB/secret simulation ولوحات monitoring.

### AUD-023 — Docker غير حتمي وغير محصن

> **تحديث 2026-07-15:** استُبدلت installs بـ`npm ci` وثُبتت صور Node/Nginx على multi-arch digests، ويعمل server كمستخدم `node` والواجهة كمستخدم `nginx`. أصبح rootfs للحاويتين للقراءة فقط مع `cap_drop: ALL` و`no-new-privileges` وtmpfs محددة، وصُحح mount قاعدة البيانات إلى `/app/data` حتى لا يحجب مصدر `/app/db`. نجح بناء الصورتين وتشغيلهما معزولتين: server readiness طبق 39 migration، والواجهة قدّمت SPA ومررت `/api/health` للخادم. بقي البند جزئيًا فقط لأن Docker Scout يتطلب تسجيل Docker ID، ومحاولتي Trivy لم تستطيعا تنزيل قاعدة CVE من `mirror.gcr.io` أو `ghcr.io`؛ لا يُعتبر المسح ناجحًا حتى ينتج تقرير High/Critical فعليًا.

- **التصنيف/المكون/المسار:** نشر؛ Dockerfiles و`docker-compose.yml:30-32`.
- **الوصف والدليل:** `npm install`، base tags غير pinned، server root، لا healthcheck، external network غير موثقة. Docker daemon لم يكن عاملًا للفحص.
- **التأثير/السبب الجذري:** builds متغيرة، blast radius أعلى، deployment يفشل إذا الشبكة غير موجودة.
- **Severity/Priority/Effort:** Medium / P2 / M.
- **الإجراء:** `npm ci --omit=dev`, pinned LTS/digest، non-root، healthcheck، توثيق/إنشاء network أو إزالة external.
- **الاعتماديات/المخاطر:** native `better-sqlite3` يحتاج build/runtime compatible.
- **التحقق:** clean Docker build وruntime/read-only smoke ناجحان؛ بقي container scan فعلي يرفض High/Critical.

### AUD-024 — قيود DB والتزامن ناقصة

- **التصنيف/المكون/المسار:** بيانات؛ `automation_rules` migrations، `database.js:8-14`.
- **الوصف والدليل:** `automation_rules.tenant_id` nullable بلا FK؛ connection لا يضبط WAL/busy_timeout؛ SQLite/SSE يمنعان horizontal scale الآمن.
- **التأثير/السبب الجذري:** orphan/global rules وdatabase locked تحت تزامن، وevents لا تعبر instances.
- **Severity/Priority/Effort:** Medium / P2 / M.
- **الإجراء:** migration قيود بعد تنظيف البيانات، WAL/busy timeout واختبارات concurrency؛ قرار scale موثق.
- **الاعتماديات/المخاطر:** rows null الحالية؛ backup قبل rebuild.
- **التحقق:** FK tests وconcurrent write/read tests.

### AUD-025 — Accessibility عامة

> **تحديث 2026-07-14:** أضيفت landmarks دلالية وتسلسل `h1/h2/h3` للصفحات العامة، ثم نُشرت primitives `PageTitle/SectionTitle/MetricValue` وعقد يقرأ كل lazy route ويفرض عنوان `h1`. عولجت العناوين الضمنية `h4–h6` والقيم الرقمية وحالة QR المبكرة، وفُرضت أسماء صريحة على كل 40 حوار MUI (على عنصر Paper ذي `role="dialog"`) وكل 92 `IconButton`. كما تمر حقول `Select` الـ73 عبر `AccessibleSelect` الذي يستنتج الاسم من `label` أو يحفظ `labelId/inputProps` الصريحين، ويمنع عقد مصدرّي استيراد MUI الخام أو إضافة حقل غير مسمى. اجتاز حوار إنشاء قالب فعلي على سطح المكتب والهاتف التحقق: ظهرت `الفئة/اللغة/نوع الرأس` في شجرة الوصول وعند `390×844` بلا overflow أفقي. أضيف harness تطويري محكوم بـ`DEV + ?axe=1`، وشُغّل `axe-core 4.12.1` على 4 مسارات عامة و19 إدارة و18 مستأجر؛ أصلحت قوائم `<li>` اليتيمة، تكرار ARIA ids، التباين، أدوار labels، واسم progressbar حتى أصبحت كل المسارات بصفر violations. لم ينفذ اختبار قارئ شاشة يدوي كامل أو كل حالات الصفوف غير الفارغة، وتبقى بعض نتائج `incomplete` اللونية لعناصر disabled/SVG، لذلك الحالة جزئية.

- **التصنيف/المكون/المسار:** UX/A11y؛ Login/Landing.
- **الوصف والدليل:** زر password toggle بلا اسم، inputs بلا autocomplete، landing بلا h1 دلالي وأرقام الخطوات h1.
- **التأثير/السبب الجذري:** قارئات الشاشة ومديرو كلمات المرور.
- **Severity/Priority/Effort:** Low / P3 / S.
- **الإجراء:** aria-label، autocomplete، heading hierarchy، keyboard/axe pass، ثم screen-reader/data-rich pass.
- **الاعتماديات/المخاطر:** لا تذكر كلمات المرور في aria live.
- **التحقق:** axe + keyboard-only + screen-reader smoke؛ تم keyboard/accessibility-tree وaxe بصفر violations محليًا، وبقي قارئ الشاشة اليدوي ونتائج incomplete والحالات الغنية.

### AUD-026 — شاشات وروابط غير مربوطة

- **التصنيف/المكون/المسار:** UX/وظائف؛ `App.jsx` و`Sidebar.jsx` وLanding.
- **الوصف والدليل:** `/chat`, `/facebook-pages`, `/messenger`, `/portal/chat` بلا nav؛ terms نص فقط.
- **التأثير/السبب الجذري:** كود قديم/مكرر ومسارات غير قابلة للاكتشاف.
- **Severity/Priority/Effort:** Low / P3 / S.
- **الإجراء:** قرار keep/redirect/deprecate؛ رابط Terms واضح.
- **الاعتماديات/المخاطر:** bookmarks خارجية.
- **التحقق:** route map/navigation test.

### AUD-027 — التوثيق متناقض

- **التصنيف/المكون/المسار:** توثيق؛ `DEPLOY.md:18-24`, `client/README.md`, Nginx.
- **الوصف والدليل:** DEPLOY يدعي proxy غير موجود ويعرض frontend على localhost رغم mapping 3133؛ client README قالب Vite.
- **التأثير/السبب الجذري:** setup خاطئ ووقت تشخيص زائد.
- **Severity/Priority/Effort:** Low / P3 / S.
- **الإجراء:** runbook dev/test/prod، env matrix، ports/network/backup/rollback.
- **الاعتماديات/المخاطر:** يحدث بعد حسم AUD-001.
- **التحقق:** onboarding على جهاز نظيف.

### AUD-028 — نظافة Git المحلية ورسائل commits

- **التصنيف/المكون/المسار:** مستودع؛ history وignored files.
- **الوصف والدليل:** `.DS_Store` و`.aider.tags.cache.v4` محلية مهملة؛ بعض commits عامة مثل “feature X / bug Y”. لا أسرار tracked ظهرت في المسح المحدود.
- **التأثير/السبب الجذري:** history أقل قابلية للتدقيق، وضوضاء محلية.
- **Severity/Priority/Effort:** Low / P3 / S.
- **الإجراء:** cleanup محلي اختياري، commit convention، PR template، secret scanning في CI.
- **الاعتماديات/المخاطر:** لا rewrite للتاريخ.
- **التحقق:** CI hygiene/secret scan وcommit lint اختياري.

## النواقص الوظيفية المنفصلة

1. لا workflow كامل لإدارة consent/opt-in/opt-out للبث داخل قاعدة البيانات.
2. لا queue دائم للبث والمهام؛ crash يفقد التنفيذ الجاري أو يترك job غير محسوم.
3. لا إدارة جلسات مستخدم/أجهزة أو MFA أو password reset/email verification.
4. لا export/import موحد للتقارير/السجلات ولا pagination contract ثابت.
5. لا شاشة/سجل موثوق لحالة طلب حذف البيانات.
6. لا staging sandbox أو fixtures رسمية لتكامل Meta.
7. لا backup scheduler أو تخزين مشفر off-host/retention مستقل؛ restore drill المحلي أصبح آليًا.

هذه نواقص مستنتجة من طبيعة التدفقات الحالية، وليست كلها bugs قائمة؛ يجب تأكيد الأولوية مع مالك المنتج.
