# فرص التحسين

## تحسينات تقنية

1. توحيد عقد HTTP تحت `/api` مع proxy واحد في التطوير والإنتاج.
2. إضافة error envelope ثابت: `code`, `message`, `details` الآمنة، `request_id`.
3. إنشاء Meta client مركزي يطبق timeout و429 handling وredaction.
4. إنشاء tenant authorization policy واختبارات ownership.
5. أُنجز تحويل API client إلى خمس وحدات مجال مع transport/session facade مشترك وعقد يمنع تصادم methods؛ يبقى توحيد upload/error helpers تحسينًا لاحقًا.
6. استخدام validators مشتركة بدل validation اليدوي المتكرر.
7. أضيف SHA-256 وsnapshot upgrade حارس وrollback ذري؛ يبقى التحقق الآلي الأشمل من schema المتوقع.

## تحسينات وظيفية

- إدارة opt-in/opt-out وsuppression list للبث وفق سياسات WhatsApp.
- جدولة بث مع queue دائم، إيقاف/استئناف، retries وidempotency.
- password reset، email/phone verification، MFA اختياري، وإدارة جلسات الأجهزة.
- export CSV/PDF للledger، الفواتير، usage، والسجلات مع صلاحيات واضحة.
- شاشة موثوقة لحالة حذف البيانات وطلباته.
- بيئة sandbox لمزودي التكامل مع fixtures دون إرسال حقيقي.
- lifecycle واضح للقالب: local draft → Meta pending/approved/rejected → archived.

هذه فرص منتج تحتاج تأكيدًا، وليست bugs واجبة التنفيذ تلقائيًا.

## تحسينات الواجهة وتجربة المستخدم

- معالجة loading/empty/error/toast بصورة موحدة عبر query layer.
- دمج أو redirect الشاشات القديمة غير المربوطة.
- إضافة رابط شروط الاستخدام وقبولها عند التسجيل إذا تطلبت السياسة.
- استكمال accessibility: صار لكل lazy route عنوان `h1` بعقد دائم، ووُحدت `PageTitle/SectionTitle/MetricValue` وسُمّيت كل Dialog/IconButton، كما تمر حقول `Select` الـ73 عبر primitive يضمن اسمًا ميسّرًا. اجتاز 4 مسارات عامة و19 مسار إدارة و18 مسار مستأجر `axe-core` بصفر violations بعد إصلاح بنية قوائم التنقل والتباين والأدوار وأسماء التقدم؛ بقي قارئ شاشة يدوي وحالات الصفوف غير الفارغة ومراجعة نتائج `incomplete` اللونية.
- جعل الجداول ذات pagination/filter URL state وresponsive cards للهاتف.
- توحيد format للأرقام والعملات والتواريخ عبر locale helpers.
- إبراز حالة Meta token/webhook/billing بطريقة قابلة للتصرف، لا badges فقط.
- code splitting حسب routes لتقليل bundle 1.53MB.

## تحسينات الأداء والاستقرار

- cursor pagination للمحادثات والسجلات وجهات الاتصال والمستأجرين.
- streaming لتنزيل/رفع الوسائط بدل buffers كاملة.
- timeout لكل طلب خارجي، retries للعمليات idempotent فقط.
- WAL/busy_timeout واختبارات concurrent writes إذا بقي SQLite.
- cache محدود لقراءات Meta البطيئة مع TTL وإبطال واضح.
- queue دائم للبث وعمليات sync الثقيلة.
- benchmark لـAPI key lookup والفوترة والبث.
- dynamic imports وmanual chunks للواجهة.

## تحسينات الأمان والبيانات

- إزالة plaintext Meta/API credentials وعرض المفتاح مرة واحدة.
- audience/resource-bound media tokens.
- SSRF allowlist/egress policy.
- fail-closed لتوقيع webhooks.
- safe regex engine أو إزالة regex من إعدادات المستخدم.
- schema-level tenant constraints وFKs.
- أُنجز content-type sniffing وأسماء public assets الآمنة؛ يبقى quarantine/antivirus وفصل storage خارجيًا إذا تطلب threat model.
- dependency/secret/container scanning داخل CI.

## تحسينات التشغيل والنشر

- بيئات واضحة: dev/test/staging/prod مع env matrix.
- `npm ci`, pinned images، non-root، Compose healthchecks.
- readiness يفحص DB/schema/secrets، وliveness يفحص event loop فقط.
- structured logs مع redaction، metrics، alerts، وdashboard.
- backup scheduler وoff-host encrypted copies؛ restore drill المحلي أصبح آليًا ومختبرًا.
- migration preflight وrollback/roll-forward runbook.
- smoke test بعد النشر يشمل Nginx `/api/health`, login، DB، webhook signature.

## فرص مستقبلية

- RBAC أدق داخل الإدارة بدل دور admin واحد.
- inbox assignment، teams، SLA، notes/tags، وaudit trail للمحادثات.
- omnichannel connectors إضافية خلف abstraction، بعد تثبيت WhatsApp/Facebook.
- analytics warehouse عند تجاوز SQLite وتقارير التشغيل المحلية.
- template/campaign approval workflows متعددة المراحل.
- usage anomaly detection وتنبيهات تكلفة Meta.
- disaster recovery متعدد المناطق عند وجود SLA تجاري يبرره.

## معايير اختيار الفرص

أي فرصة مستقبلية يجب أن تجيب عن: من المستخدم؟ ما التدفق الحالي المتألم؟ ما البيانات والصلاحيات؟ كيف ستُقاس؟ وما أثرها على Meta compliance والفوترة؟ لا تُدمج مع إصلاحات P0/P1 في نفس الإصدار.
