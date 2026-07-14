# خريطة طريق التنفيذ

> **تحديد نطاق 2026-07-15:** الهدف التشغيلي الحالي هو تشغيل UI وAPI وSQLite
> محليًا مع توثيق، لا إغلاق كل ديون التدقيق. تحقق هذا المسار عبر
> `docker-compose.local.yml` واختبار المتصفح؛ تبقى المراحل والتحسينات غير
> الحاجبة أدناه backlog مرجعيًا. راجع `../LOCAL_RUNTIME.md` لعقد التشغيل الحالي.

## تقدم التنفيذ حتى 2026-07-14

- أُنجزت الخطوات 1–8 من «أول عشر خطوات عملية»، بما يشمل `/api`، الأسرار، توقيع webhook، media token، credentials، SSRF، وترتيب routes.
- أُنشئت نواة الاختبارات ووصلت إلى 246 اختبارًا، تشمل حسابات الفوترة وquote وتوافر الرصيد/الدورة/الحجوزات ودورة reserve/commit/release وحركات payment/adjustment/plan/allowance وsummary/period/ledger/invoices وMeta usage/pagination/snapshot/reconciliation والأسعار وحل الدولة/العملة/الشرائح والتقديرات وتكلفة الرسالة/status والبث والإعدادات، ودورة auth/cookie/logout/password/legacy rotation، وسياسات role/tenant، وpagination وعزل tenant A/B، ورفع الملفات وتنزيلها وتنظيفها وrestore/metrics/bootstrap ودلالات الصفحات العامة والخاصة وعقد عنوان الصفحة لكل lazy route وأسماء dialogs/icon buttons/select fields والأتمتة وأسرار API واستعلامات الرسائل وإرسال النص/القالب/التفاعل/الوسائط عبر الإدارة والمستأجر وAPI v1 وقراءات/أحداث API v1 وجهات الاتصال والتحقق عبر Meta وتعليم القراءة وprofile/analytics/dashboard/QR/conversions وصفحات Facebook ورسائل Messenger الموسومة ومزامنتها وصندوق الوارد الموحد ورسائل/وسائط WhatsApp وOAuth/Meta Review/WhatsApp onboarding والبث الإداري وبث المستأجر غير المتزامن والقوالب المحلية/Meta وكتالوج/تدفقات/جلسات/ملخص Messenger Bot وعقود تركيب facades وعميل API ومشاركة المجالات الخمسة في UI وترقيات قاعدة البيانات. أضيفت بوابة `c8 --all` لكل مصادر الخادم بخط أساس 51.51/66.74/71.22 وحدود CI دنيا 51/66/71، كما أضيف harness تطويري لـ`axe-core` واجتاز 41 مسارًا بصفر violations؛ تبقى مراجعة screen reader/axe incomplete وBrowser/Meta E2E الفعلي.
- أُغلق أيضًا AUD-012 (regex) وAUD-015 (API-key lookup) وAUD-019 وAUD-021.
- أُنجزت الخطوة 10 بتدفق حذف وسجل حالة حقيقيين، واختُبرت migration 038 على DB جديدة ونسخة upgrade.
- أُصلح AUD-013 باختبار upgrade يحمي cooldowns؛ لا يمكن استعادة بيانات فُقدت سابقًا من دون backup.
- أُغلق AUD-008 بتحديث lockfiles ونتيجة audit صفر دون `--force`.
- أُغلق AUD-016 محليًا: timeout وretry آمن، قراءة JSON موحدة، وتطبيع/redaction لأخطاء Meta في جميع routes/services. أُغلق AUD-017 عبر streaming وحدود/offset للقوائم العامة واختبار أكثر من 200 سجل، وأضيف readiness فعلي ضمن AUD-022.
- أُزيلت تحذيرات React وقُسمت الصفحات والحزم فعليًا، مع حذف `recharts` و`lucide-react` غير المستخدمتين.
- أضيفت migration 039 وWAL/FK/busy timeout، ووُثقت حدود single-instance والنسخ/الاستعادة.
- أصبح تطبيق SQL وتسجيل كل migration عملية ذرية واحدة مع SHA-256؛ تُملأ checksums للقواعد الحالية مرة واحدة ويُرفض أي drift لاحق. أضيف snapshot upgrade مثبت على آخر migration ويتحقق من حفظ tenant/billing/ledger/automation/cooldown/deletion ومن idempotency، ويفشل صراحة عند إضافة migration أحدث دون تحديث fixture.
- رُبطت شروط الاستخدام، وتحولت المسارات القديمة غير المربوطة إلى redirects معلنة، واستُبدل README القالب بدليل تشغيل حقيقي.
- أضيفت حلقة focus موحدة، و`PageTitle/SectionTitle/MetricValue`، وعقد `h1` لكل lazy route، وتنقل جانبي بمعلم وروابط وقوائم/مناطق دلالية حقيقية، وأسماء صريحة لكل 40 حوارًا و92 زرًا أيقونيًا و73 حقل `Select`. نجح Browser DOM/accessibility sweep لكل 19 مسار إدارة و18 مسار مستأجر عند 1440×900، وعينة keyboard/responsive وحوار فعلي عند 390×844؛ ثم شُغّل `axe-core` على 41 مسارًا وأصلحت مخالفاته حتى الصفر. بقي قارئ شاشة يدوي كامل وحالات rows الغنية بالبيانات ونتائج incomplete اللونية.
- أضيفت JSON logs وrequest IDs وredaction ومقاييس HTTP محمية، واستُخرجت معادلات فوترة قابلة للاختبار.
- اكتمل تحويل service الفوترة إلى facade: خرجت 18 وحدة تشمل core/math/quote/account/usage/ledger/summary/period/history وMeta analytics/rates/pricing/message-cost/status/settings/usage/sync/reconciliation. أصبحت الفترات المستحيلة 400، والمستأجر الغائب 404، ويُحسب المال بدقة ثلاثية، وإنشاء الحساب idempotent، وتصادم مفاتيح idempotency و`wamid` بين المستأجرين 409، وفواتير المستأجر الآخر مرفوضة، وpagination Meta موحدة، وحل الدولة/العملة/الشريحة حتمي بلا fallback عشوائي، والحالات النهائية immutable، ويُغلق حجز البث حتى لو سبقت الحالات خطوة defer؛ انخفض `billing.js` إلى 267 سطرًا.
- وُحّدت routers محتوى وتحليلات Facebook بين admin والبوابة، واستُخرجت كل endpoints من `tenantPortal.js` إلى routers مجالية، بما فيها رسائل/وسائط WhatsApp وصندوق الوارد الموحد. تجمع dashboard عدادات WhatsApp في استعلام واحد وMessenger في استعلامين، وتجمع analytics وconversions الحالات في استعلامات تجميعية؛ وتمنع وحدة onboarding إعادة page tokens للمتصفح، ويحاسب البث المستلمين الناجحين فقط، وترفض مزامنة القوالب وMessenger روابط pagination خارج Meta، ويرفض proxy الوسائط روابط التنزيل خارج نطاقات Meta. انخفض `tenantPortal.js` من 5,522 إلى 208 أسطر وصفر endpoints مباشرة.
- تحول `server/routes/messengerBot.js` من 987 سطرًا إلى composition facade من 21 سطرًا، مع routers مستقلة للملخص والمنتجات/الأصول والتدفقات والجلسات ووحدة مشتركة لحل المستأجر والسياسات. تحمي الحد الجديد اختبارات لسطح 17 endpoint وعزل admin/tenant وCRUD ومعرض الصور وCSV quoting/upsert/cleanup وتشخيص التدفقات والجلسات والملخص.
- تحول `server/routes/messages.js` من 1,707 سطرًا/20 endpoint إلى composition facade من 19 سطرًا/صفر endpoints بعد استخراج الإرسال والوسائط والاستعلامات والبث وجهات الاتصال الإدارية وتعليم القراءة. تستعمل وحدة contacts validators المشتركة، وتسمح clear صريحًا، وترمّز Meta path IDs، وتحقن DB/Meta/billing/events؛ كما أُصلح استدعاء resolver الذي كان يمرر رقم tenant بدل `{ tenantId }` فيتجاهل credentials الخاصة به. يشترك بث الإدارة والمستأجر الآن في `broadcastProcessor.js` مع بقاء الحدود 500/100 والعزل والقنوات الخاصة بكل سياق. تفصل `messageQueries.js` سجلات الرسائل/webhooks والمحادثات ونافذة 24 ساعة، وتمنع tenant/direction/phone غير الصالح، وتحترم DB المحقونة عند إثراء fallback القالب. تفصل `messageSends.js` النصوص والقوالب والتفاعل، وتمنع سقوط tenant غير الموجود إلى credentials افتراضية، وتصحح عدّ متغير القالب المكرر، وتفرض نافذة 24 ساعة على التفاعل الإداري وتفاعل المستأجر. تفصل `messageMedia.js` الاكتشاف والتنزيل والرفع والإرسال، وتتحقق من المعرّف والنوع والرابط والمستأجر ونافذة 24 ساعة، ولا تتبع إلا روابط تنزيل Meta الموثوقة، وتضمن تنظيف الملفات وتسوية الفوترة مرة واحدة.
- تحول `client/src/api/index.js` من ملف 2,027 سطرًا إلى facade للنقل والجلسة عند 292 سطرًا، ونُقلت 265 method إلى وحدات `portalCore/metaAdmin/operations/tenantFacebook/tenantMeta` مع بقاء singleton وأسماء الاستدعاءات دون تغيير، ويحمي عقد آلي تركيب الوحدات وعدم تصادم الأسماء.
- أزيلت الحدود المشتركة من المجالات الخمسة المكررة في admin/tenant: الأتمتة تشترك في الخيارات والقيم الافتراضية والعرض، والقوالب في بناء حمولة Meta والنموذج والحالة، وجهات الاتصال في الجدول/CTWA/الحذف، والبث في تنقية المستلمين وخطوة اختيارهم وسياسة الوسائط، ومحتوى Facebook في composer tabs ونص المنشور والحذف والإشعارات. أزيل خيار `regex` المتروك، وبقيت adapters والصلاحيات والحدود 500/100 خاصة بكل سياق.
- أصبح `authMiddleware` يفرض الدور وتعيين المستأجر الحاليين من قاعدة البيانات، فلا يحتفظ JWT قديم بصلاحية مدير سُحبت منه.
- أُغلق AUD-020 للمتصفح: انتقلت الجلسة إلى cookie `HttpOnly/SameSite/Secure` مع Origin guard، وتدوير تلقائي لمرة واحدة لأي JWT قديم في `localStorage`.
- أُغلق AUD-028 محليًا: CI مثبت على commit SHAs، وGitleaks 8.30.1 محقق checksum يفحص التاريخ، وDependabot ودليل Conventional Commits/PR gate. يلزم تفعيل branch protection على مستضيف Git.
- أضيف تحقق محتوى مركزي لكل uploads: لا يُعتمد MIME أو امتداد العميل، وتُرفض ZIP/ثنائيات متنكرة وCSV غير نصي، وتستخدم أصول bot العامة UUID وامتدادًا مشتقًا من المحتوى.
- أضيف SQLite online backup متحقق: quick/FK check قبل الضغط، restore مؤقت وفحص ثانٍ وSHA-256 وretention آمن؛ بقيت الجدولة والنسخ المشفر off-host من مسؤوليات منصة النشر.
- أضيفت نافذة HTTP 5m وإشارات webhook/job/token مجمعة وPrometheus endpoint محمي بسر مستقل وقواعد alert؛ بقي توصيل Alertmanager/tracing على المنصة.
- أُلغي طبع كلمة مرور المدير عند أول تشغيل؛ bootstrap صار صريحًا، قويًا، idempotent، ويكتمل قبل فتح المنفذ.
- ثُبتت صور Node/Nginx على multi-arch digests، وأضيف Dependabot لـDocker وبناء الصورتين في CI. في 2026-07-15 نجح build فعلي وتشغيل server/client معزولين بمستخدمين غير جذريين وrootfs للقراءة فقط وcap-drop/no-new-privileges، ونجحت readiness وSPA وproxy ‏`/api`. بقي تقرير CVE للصورتين؛ Scout طلب Docker ID وتنزيل قاعدة Trivy توقف من مرآتي GCR/GHCR.

## مبادئ التنفيذ

- لا refactor واسع قبل اختبارات عقد أساسية.
- كل مرحلة صغيرة قابلة للنشر والرجوع، مع migration backup عند البيانات.
- أسرار production لا تُنقل إلى dev/test.
- وظائف Meta تُختبر أولًا على حساب sandbox/أصول اختبار.
- الجهد نسبي: XS < ساعتين، S < يوم، M 1–3 أيام، L 4 أيام–أسبوعين، XL أكبر ويُقسم.

## أول عشر خطوات عملية

1. إصلاح عقد `/api` في Vite/Nginx/Express وإضافة smoke test.
2. توفير `CRYPTO_KEY` آمن للبيئة الحالية وضبط `NODE_ENV=production` وMeta secrets في النشر.
3. جعل webhook fail-closed دون signature.
4. حصر media tokens على تنزيل الوسائط فقط.
5. منع plaintext Meta tokens وDTO leakage ثم تنفيذ migration آمنة للبيانات القديمة.
6. تدوير API keys وتخزين digest مفهرس، وتشفير webhook secrets.
7. تقييد callback URLs لمنع SSRF.
8. إصلاح ترتيب delete-meta routes وإضافة regression tests.
9. إنشاء test harness لقاعدة مؤقتة واختبارات auth/tenant/billing/migrations.
10. إصلاح حذف البيانات ليشمل كل stores ويعرض حالة حقيقية.

## المرحلة 0 — المشكلات الحرجة

- **الهدف:** جعل stack يتصل ويبدأ بأمان.
- **البنود:** AUD-001، AUD-002، AUD-011، AUD-005.
- **الاعتماديات:** قرار contract `/api`، secret store، حساب Meta test.
- **المخاطر:** كسر reverse proxy خارجي غير موجود في المستودع؛ rotation خاطئ.
- **شروط البدء:** حصر DNS/proxy الفعلي والاحتفاظ بنسخة env/DB آمنة.
- **شروط الانتهاء:** `/api/health` عبر frontend origin، startup production fail-closed، media token يفشل على non-media.
- **الاختبارات:** dev + production smoke، auth guards، webhook signed/unsigned، media-token scope.
- **الترتيب:** API contract → env/prod → webhook → media token.

## المرحلة 1 — تثبيت البناء والتشغيل

- **الهدف:** build ونشر قابلان للتكرار من clone نظيف.
- **البنود:** جزء AUD-023 وAUD-027؛ `npm ci`، pinned images، network docs، healthchecks.
- **الاعتماديات:** المرحلة 0.
- **المخاطر:** native better-sqlite3 على image جديدة.
- **شروط البدء:** lockfiles معتمدة وDocker daemon/runner متاح.
- **شروط الانتهاء:** clean Docker build وCompose up وsmoke/stop يعملان.
- **الاختبارات:** image build، container health، Nginx SPA fallback وAPI proxy.
- **الترتيب:** Dockerfiles → Compose → docs/runbook.

## المرحلة 2 — البيانات والأمان

- **الهدف:** إزالة credentials الصريحة وإغلاق SSRF/حذف البيانات/regex.
- **البنود:** AUD-003، 004، 006، 007، 012، 013، 014، 021، 024.
- **الاعتماديات:** backup verified، test DB snapshots، key management.
- **المخاطر:** فقد القدرة على فك tokens، تعطيل clients القديمة، حذف قانوني زائد.
- **شروط البدء:** restore drill ناجح وخطة rotation.
- **شروط الانتهاء:** plaintext count صفر، SSRF tests خضراء، tenant matrix خضراء، deletion fixtures خضراء.
- **الاختبارات:** migration upgrade، ownership، secret redaction، callback URL matrix، regex adversarial، deletion lineage.
- **الترتيب:** policies/tests → migrations → rotation → remove fallback.

## المرحلة 3 — إكمال الوظائف الجزئية

- **الهدف:** إصلاح التدفقات المؤكدة قبل توسيع المنتج.
- **البنود:** AUD-009، AUD-019، logout، API key lifecycle، job recovery للبث.
- **الاعتماديات:** test harness من المرحلة 2.
- **المخاطر:** تغييرات endpoint compatibility.
- **شروط البدء:** contract tests لمسارات templates/auth.
- **شروط الانتهاء:** delete Meta يعمل admin/tenant؛ password change/logout E2E؛ jobs تملك حالات recovery واضحة.
- **الاختبارات:** route precedence، AuthContext E2E، billing reservation release.
- **الترتيب:** quick functional bugs → lifecycle workflows.

## المرحلة 4 — الوظائف غير المكشوفة للمستخدم

- **الهدف:** حسم routes القديمة وغير المربوطة.
- **البنود:** `/chat`, `/facebook-pages`, `/messenger`, `/portal/chat`, Terms.
- **الاعتماديات:** analytics استخدام/قرار Product.
- **المخاطر:** bookmarks أو عملاء يعتمدون routes.
- **شروط البدء:** مقارنة الوظائف مع Unified Inbox والواجهات البديلة.
- **شروط الانتهاء:** كل route إما مرتبطة، redirect معلن، أو deprecated بخطة حذف.
- **الاختبارات:** navigation/redirect/role matrix.
- **الترتيب:** قياس واختيار → redirects → إزالة مؤجلة.

## المرحلة 5 — تجربة المستخدم

- **الهدف:** UX متسق، متجاوب، وقابل للوصول.
- **البنود:** AUD-025/026، loading/error/empty، tables، terms/consent، locale formatting.
- **الاعتماديات:** استقرار endpoints.
- **المخاطر:** تغيير layout في 40+ شاشة.
- **شروط البدء:** design tokens/component inventory.
- **شروط الانتهاء:** axe بلا مخالفات حرجة، keyboard smoke، breakpoints أساسية، رسائل خطأ موحدة.
- **الاختبارات:** component tests، visual regression، mobile/tablet/desktop E2E.
- **الترتيب:** primitives → auth/layout → high-traffic screens → البقية.

## المرحلة 6 — الاختبارات وCI

- **الهدف:** حماية السلوك وفتح باب refactor والترقيات.
- **البنود:** AUD-010 وAUD-008 gate.
- **الاعتماديات:** DB factory وMeta test doubles.
- **المخاطر:** tests هشة إذا ربطت بتفاصيل implementation.
- **شروط البدء:** contracts وfixtures موثقة.
- **شروط الانتهاء:** CI build/lint/unit/integration/security؛ critical paths مغطاة.
- **الاختبارات المطلوبة:** Unit للفوترة/normalizers؛ Integration للDB/routes؛ API contract؛ E2E auth/inbox/templates؛ migration/security/regression.
- **الترتيب:** auth/tenant → billing → webhooks → messaging → UI.

## المرحلة 7 — الأداء والاستقرار

- **الهدف:** حدود زمن/ذاكرة وتزامن قابلة للقياس.
- **البنود:** AUD-015، 016، 017، 024؛ pagination/streaming/timeouts/WAL/queue.
- **الاعتماديات:** metrics وload fixtures.
- **المخاطر:** contract changes للpagination، retries مكررة.
- **شروط البدء:** baseline latency/memory والحجم المتوقع.
- **شروط الانتهاء:** SLOs متفق عليها واختبارات load/fault passing.
- **الاختبارات:** concurrency، 429/timeout، large media، large chat/history، API-key scaling.
- **الترتيب:** timeouts/limits → pagination/streaming → queue/cache → DB tuning.

## المرحلة 8 — النشر والمراقبة

- **الهدف:** إنتاج قابل للرصد والاستعادة.
- **البنود:** AUD-022/023؛ readiness، logs، metrics، alerts، backup/restore، rollback.
- **الاعتماديات:** CI وstaging.
- **المخاطر:** logging بيانات حساسة، alert fatigue.
- **شروط البدء:** redaction policy وSLOs.
- **شروط الانتهاء:** staging deploy تلقائي، production checklist، restore drill، alerts مجربة.
- **الاختبارات:** chaos محدود، DB unavailable، disk full، Meta outage، rollback migration policy.
- **الترتيب:** observability → staging → backup/restore → controlled production.

## المرحلة 9 — الميزات المستقبلية وإعادة الهيكلة المحدودة

- **الهدف:** تطوير المنتج وسداد الدين دون تغيير شامل.
- **البنود:** تقسيم monoliths، shared admin/tenant UI، MFA، queue دائم، RBAC أدق، exports.
- **الاعتماديات:** المراحل 0–8 وقياسات استخدام.
- **المخاطر:** scope creep.
- **شروط البدء:** كل feature له owner/metric/data/permission design.
- **شروط الانتهاء:** release criteria خاصة بكل مبادرة.
- **الاختبارات:** حسب threat/data flow لكل feature.
- **الترتيب:** أعلى قيمة/أقل مخاطرة؛ لا تخلط feature مع migration أمنية كبيرة.

## بوابات الإصدار

| البوابة | الشرط |
|---|---|
| قبل أول نشر مصحح | P0 مغلقة، backup، smoke، signed webhooks |
| قبل rotation أسرار | restore drill، counts، dual-read نافذة محدودة |
| قبل refactor | contract/integration tests خضراء |
| قبل scale أفقي | DB/event bus/job design خارجي أو توثيق single instance |
| قبل ميزات جديدة | لا High أمنية مفتوحة قابلة للاستغلال |
