# تقرير اكتشاف مشروع Wa Savana

تاريخ التدقيق: 2026-07-11
النطاق: قراءة وتحليل وتشغيل تشخيصي فقط؛ لم يُغيَّر أي سلوك وظيفي أو مخطط إنتاجي.
مستوى الثقة: مرتفع في نتائج المصدر والبناء المحلي، ومتوسط في وظائف Meta التي تتطلب حسابات ورموزًا حقيقية.

> **تحديث 2026-07-15:** هذا التقرير يحفظ خط أساس الاكتشاف في 2026-07-11. الحالة الحالية المحدثة في `AUDIT_SUMMARY.md`: أُصلح عقد `/api` والأسرار والاختبارات وDocker، وبُنيت وشُغلت صورتا server/client فعليًا مع تحصين non-root/read-only. لا تُقرأ عبارات «لا اختبارات» أو «daemon غير عامل» أدناه كحالة حالية.

## الملخص التنفيذي

المشروع منصة SaaS متعددة المستأجرين لإدارة WhatsApp Business وFacebook Pages وMessenger. يتكون من واجهة React/Vite، وخادم Express، وقاعدة SQLite محلية، ويتصل مباشرة بـMeta Graph API. يحتوي المصدر على نطاق وظيفي واسع: المحادثات، القوالب، البث، جهات الاتصال، Facebook، Messenger Bot، الأتمتة، الفوترة، التحليلات، API خارجية، Webhooks، وعمليات Meta review.

المشروع **يبنى محليًا**، ونجح تشغيل خادم مؤقت وقاعدة جديدة وجميع migrations. لكنه **غير قابل للتشغيل الكامل بالإعداد الحالي ولا عبر وصف Docker الحالي** للأسباب التالية:

1. ملف `server/.env` المحلي لا يحتوي المتغير الإلزامي `CRYPTO_KEY`؛ الخادم يفشل قبل الاستماع.
2. الواجهة تطلب `/api/...`، بينما Express لا يركّب بادئة `/api` وNginx لا يمررها للخادم. لذلك الواجهة لا تصل إلى Backend في وضعي التطوير أو Docker كما هما موثقان.
3. Docker daemon لم يكن عاملًا أثناء التدقيق، لذلك لم يمكن بناء/تشغيل الحاويات؛ `docker compose config --quiet` نجح فقط.
4. لا توجد أي اختبارات آلية، ولا CI/CD، ولا يمكن إثبات تدفقات Meta دون حسابات اختبار خارجية.

الجاهزية للإنتاج منخفضة. يلزم **إصلاح تدريجي مع إعادة هيكلة محدودة**، وليس إعادة كتابة شاملة: تثبيت التشغيل أولًا، ثم إغلاق مخاطر الأسرار والتفويض وSSRF وحذف البيانات، ثم إضافة اختبارات قبل تقسيم الملفات الضخمة.

## هوية المشروع

| البند | النتيجة |
|---|---|
| الاسم | Wa Savana / WhatsApp Management Platform |
| النوع | مشروع متعدد التطبيقات: SPA + REST API + Webhook receiver + مهام خلفية |
| المستخدمون | مدير المنصة، مستخدم إداري عام، مستخدم مستأجر، عميل API خارجي، Meta Webhooks |
| نموذج العزل | `tenant_id` داخل الجداول والطلبات؛ ليس كل الجداول تفرضه بقيد قاعدة بيانات |
| نقطة دخول الواجهة | `client/src/main.jsx` ثم `AppProviders.jsx` ثم `App.jsx` |
| نقطة دخول الخادم | `server/server.js` |
| قاعدة البيانات | SQLite عبر `better-sqlite3`، ملف `server/db/platform.db` |
| التكاملات | Meta Graph API v25.0، WhatsApp Cloud API، Facebook Pages/Messenger، callbacks خاصة بالمستأجر |
| البيئات المعرّفة | Development ضمنيًا؛ لا تعريف مكتمل لـTesting/Staging/Production |

## التقنيات والإصدارات

الإصدارات التالية هي الإصدارات المحلولة فعليًا في `node_modules` وقت التدقيق، لا مجرد النطاقات في manifests:

| الجزء | التقنية | الإصدار المحلول |
|---|---|---:|
| الواجهة | React / React DOM | 19.2.1 |
| الواجهة | Vite | 7.2.7 |
| التوجيه | react-router-dom | 7.10.1 |
| UI | MUI | 7.3.6 |
| الرسوم | Recharts | 3.5.1 |
| الخادم | Node المستخدم محليًا | 22.20.0؛ صور Docker تطلب Node 20 |
| الخادم | Express | 4.22.1 |
| قاعدة البيانات | better-sqlite3 | 11.10.0 |
| المصادقة | jsonwebtoken / bcryptjs | 9.0.3 / 3.0.3 |
| الحماية | helmet / express-rate-limit | 8.1.0 / 8.3.2 |
| الرفع | multer | 2.0.2 |
| الحاويات | Docker CLI / Compose | 29.1.3 / 5.0.0-desktop.1 |

## حجم المشروع

- تطبيقان قابلان للتشغيل: `client` و`server`.
- 67,175 سطر JavaScript/JSX تقريبًا، باستثناء الملفات المولدة.
- 46 مسار واجهة، منها مسار 404.
- 297 endpoint معلنًا عبر Express routers.
- 37 migration SQL.
- قاعدة جديدة بعد migrations: 39 جدولًا و83 فهرسًا، `integrity_check = ok`، ولا مخالفات FK.
- 58 قدرة وظيفية منطقية موثقة في `FEATURE_INVENTORY.md`.

## المكونات الرئيسية

### الواجهة

- `client/src/App.jsx`: تعريف المسارات وحماية الدور.
- `client/src/api/index.js`: عميل API مركزي، لكنه ملف ضخم (2,027 سطرًا) ويحتوي جميع المجالات.
- `client/src/context`: المصادقة، اللغة، واختيار المستأجر.
- `client/src/pages`: شاشات الإدارة وبوابة المستأجر.
- `client/src/i18n/translations.js`: 2,052 مفتاحًا لكل من العربية والإنجليزية دون مفاتيح ناقصة.
- `client/src/components`: المحادثات وFacebook وWhatsApp والتخطيط.

### الخادم

- `server/server.js`: تهيئة الأسرار، middleware، المسارات العامة والمحمية، SSE، والمهام الخلفية.
- `server/routes`: 25 ملف route؛ `tenantPortal.js` وحده 5,522 سطرًا و89 endpoint.
- `server/services`: Meta، التشفير، الفوترة، الأتمتة، bot، الأحداث، والصيانة.
- `server/db`: اتصال SQLite وmigrator و37 migration.

### التخزين والعمليات الخلفية

- تخزين الرسائل وجهات الاتصال والفوترة محليًا في SQLite.
- الملفات المؤقتة في `server/uploads`; صور bot عامة تحت `/bot-assets`.
- SSE داخل الذاكرة؛ لا يعمل عبر أكثر من نسخة خادم.
- تنظيف يومي للسجلات والملفات، وفحص رموز Meta كل 6 ساعات عند توافر إعدادات التطبيق.

## طريقة البناء والتشغيل المتوقعة

### التشغيل المحلي المقصود

```bash
cd server
npm start

cd client
npm run dev
```

يلزم ضبط `JWT_SECRET` و`CRYPTO_KEY`، وإعدادات Meta حسب الوظيفة. لكن المسارات الحالية في عميل API تمنع التواصل المحلي حتى لو عمل الخادم؛ انظر `AUD-001`.

### Docker المقصود

```bash
docker compose up --build -d
```

يتطلب شبكة Docker خارجية اسمها `proxy`، وملف `server/.env`. الوثيقة تقول إن Nginx يمرر `/api`، لكن `client/nginx.conf` لا يفعل ذلك. كما أن `NODE_ENV=production` غير مضبوط في Compose.

## نتائج الأوامر المنفذة

| الأمر/الفحص | النتيجة | الملاحظات |
|---|---|---|
| `npm run build` في `client` | نجح | bundle رئيسي 1,531.20 kB؛ gzip 431.81 kB؛ تحذير chunk أكبر من 500 kB |
| `npm run lint` في `client` | نجح مع 10 تحذيرات | Hook dependencies و`setState` داخل effects |
| `node --check` لكل ملفات server JS | نجح | لا أخطاء syntax |
| `docker compose config --quiet` | نجح | صحة YAML فقط |
| تطبيق 37 migration على DB مؤقتة | نجح | 39 جدولًا، 83 فهرسًا |
| `PRAGMA integrity_check` / FK check | نجح | `ok` و0 مخالفات |
| بدء خادم مؤقت على منفذ محلي | نجح | بعد توفير أسرار تشخيصية وقاعدة مؤقتة |
| `/health` | 200 | الحماية وheaders ظاهرة |
| `/auth/me`, `/tenants` دون token | 401 | حواجز المصادقة تعمل |
| `/v1/health` دون API key | 401 | حارس API key يعمل، رغم تعليق الكود بأنه public |
| CORS origin مسموح/غير مسموح | 204 | origin غير المسموح لا يحصل على `Access-Control-Allow-Origin` |
| سكربت backup على DB مؤقتة | نجح في خط الأساس | أصبح لاحقًا online snapshot مع فحص قبل/بعد restore و3 اختبارات |
| فحص واجهة 1280px و390px | نجح جزئيًا | لا overflow أفقي؛ تعذر دخول الشاشات الخاصة |
| اختبار ترقية migration 018 | كشف فشل بيانات | cooldowns: 1 قبل migration، 0 بعدها |
| `npm audit` | فشل بسبب ثغرات | client: 13؛ server: 8 |
| `docker network inspect proxy` | تعذر | Docker daemon غير عامل |

## قاعدة البيانات

المجالات الرئيسية:

- الهوية: `users`, `revoked_tokens`, `tenants`.
- المراسلة: `messages`, `contacts`, `templates`, `broadcast_jobs`.
- Facebook/Messenger: `tenant_pages`, `fb_conversations`, `fb_messages`.
- الأتمتة: `automation_rules`, `automation_cooldowns`.
- Messenger Bot: المنتجات، الصور، التدفقات، العقد، الجلسات، والأحداث.
- الفوترة: الخطط، الحسابات، usage events، ledger، المدفوعات، الفواتير، تكاليف Meta، reconciliation، snapshots.
- التشغيل: `webhook_logs`, `webhook_failures`, `activity_logs`, `meta_review_checks`.

نقاط القوة: migrations قابلة للتطبيق على قاعدة جديدة، معاملات فوترة في عدة مسارات، فهارس واسعة، وFKs كثيرة. نقاط الضعف: `automation_rules.tenant_id` nullable ولا FK، حقول أسرار legacy باقية، SQLite بلا WAL/busy timeout، وmigration 018 تحذف cooldowns القائمة.

## المصادقة والصلاحيات

- JWT مدة 7 أيام مع `jti` وقائمة إلغاء، وفحص نشاط المستخدم.
- أدوار فعلية: `admin`، وtenant user (`tenant_id` موجود)، و`user` عام.
- مسارات الإدارة محمية بـ`authMiddleware` و`adminMiddleware`.
- بوابة المستأجر محمية بالمصادقة فقط، دون middleware يفرض وجود `tenant_id`.
- API الخارجية تستخدم `X-API-Key`.
- SSE يستخدم token لمرة واحدة مع fallback إلى JWT في query.
- media token قصير العمر، لكنه مقبول حاليًا على أي مسار يمر عبر `authMiddleware`، وليس مسارات الوسائط فقط.

## حالة الواجهات وتجربة المستخدم

صفحات الهبوط وتسجيل الدخول متجاوبة في الاختبار المرئي. تدعم العربية/الإنجليزية وRTL/LTR، ولا توجد مفاتيح ترجمة ناقصة. النواقص المثبتة:

- زر إظهار كلمة المرور بلا accessible name.
- حقول الدخول/التسجيل بلا `autocomplete` مناسب.
- صفحة الهبوط لا تملك `h1` دلاليًا؛ أرقام الخطوات تستعمل `h1`.
- `/chat`, `/facebook-pages`, `/messenger`, `/portal/chat` موجودة دون عناصر تنقل.
- شروط الاستخدام تظهر كنص لا كرابط، ولا يوجد route React لها.
- جميع الشاشات الخاصة لم يمكن اختبار أحداثها بصريًا بسبب عائق Backend والمسارات وعدم وجود بيانات اعتماد اختبار.

## الاختبارات والجودة

لا يوجد test runner ولا ملفات unit/integration/E2E. مجلد `tests` يحتوي fixture JSON فقط. لذلك لا توجد نسبة تغطية قابلة للقياس، ولا حماية regression للفوترة أو العزل أو webhooks أو migrations.

أكبر ملفات المصدر: `tenantPortal.js` 5,522، `billing.js` 3,682، `MessengerBotManager.jsx` 2,180، `api/index.js` 2,027. يوجد تكرار واضح بين مسارات وصفحات admin وtenant، وهو سبب مباشر لتباين السلوك وترتيب المسارات.

## الاعتماديات

`npm audit` في 2026-07-11:

- client: 13 حزمة متأثرة: 7 High، 5 Moderate، 1 Low. تتضمن direct dependencies مثل `react-router-dom` و`vite`، وحزم build transitive.
- server: 8 حزم متأثرة: 3 High، 5 Moderate. تشمل direct dependencies: `multer`, `form-data`, `express`, `express-rate-limit`.
- توجد إصلاحات متاحة وفق npm audit، لكن لم تُرقّ أي حزمة ضمن مرحلة الاكتشاف.

## النشر والتشغيل

- لا CI/CD ولا smoke test للنشر.
- لا healthchecks في Compose؛ `/health` لا يفحص DB أو migrations أو Meta.
- لا reverse proxy صالح داخل Nginx الحالي، ولا TLS داخل المشروع.
- صور Docker غير مثبتة digest، وتستخدم `npm install` بدل `npm ci`، والخادم يعمل كـroot.
- شبكة `proxy` خارجية وغير موثقة الإنشاء.
- خط الأساس كان backup يدويًا بلا restore؛ المعالجة الحالية تضيف restore drill محليًا، وتبقى الجدولة والتشفير off-host خارج المشروع.
- لا staging أو rollback موثق.

## Git والمستودع

- الفرع `main` مطابق لـ`origin/main` وقت الفحص، والعمل tree كان نظيفًا قبل إنشاء التقارير.
- لا أسرار واضحة متتبعة وفق مسح أنماط محدود؛ `.env` وقواعد البيانات وbuild outputs مهملة.
- توجد ملفات محلية مهملة: `.DS_Store`, `.aider.tags.cache.v4`, `dist`, قواعد SQLite، و`node_modules`.
- بعض رسائل commits عامة جدًا ولا تصف التغيير (`Implement feature X...`).
- لا تغييرات تاريخ أو فروع أُجريت.

## الحكم النهائي

المعمارية مفهومة وقابلة للإصلاح، لكنها monolithic على مستوى routes/services والواجهة. لا توجد أسباب مثبتة لإعادة كتابة المشروع كله. التوصية: إصلاح تدريجي، ثم تقسيم محدود حسب المجالات (Auth، Messaging، Meta، Billing، Automation) بعد إنشاء اختبارات عقد وتكامل تحمي السلوك.

للتفاصيل:

- الخريطة: `PROJECT_ARCHITECTURE_MAP.md`
- الوظائف: `FEATURE_INVENTORY.md`
- المشاكل: `ISSUES_AND_GAPS.md`
- الأمان: `SECURITY_REVIEW.md`
- الطريق التنفيذي: `EXECUTION_ROADMAP.md`
