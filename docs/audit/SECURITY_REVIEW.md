# المراجعة الأمنية المبدئية

> **تحديث 2026-07-15:** الأقسام الوصفية تحفظ خط الأساس عند الاكتشاف. أُصلحت محليًا revocation وتدوير token، وانتقلت جلسة المتصفح إلى cookie `HttpOnly/SameSite/Secure` مع Origin guard، وفُرضت هوية role/tenant الحالية من قاعدة البيانات، وأُصلح نطاق media token وMeta error redaction وتشفير credentials وتوقيع webhook وstreaming الوسائط وحذف البيانات. أصبحت uploads تتحقق من magic bytes، وأصبح admin bootstrap صريحًا بلا طباعة password، وPrometheus محميًا بسر مستقل fail-closed. أضيف secret-history scan في CI ونجح محليًا على 319 commit. بُنيت وشُغلت صورتا Docker فعليًا مع non-root/read-only/cap-drop/no-new-privileges؛ بقي تقرير CVE للصورتين، واختبارات Meta/Browser وbranch protection دفاعات خارجية.

## النطاق والمنهج

مراجعة مصدرية وتشغيلية غير اختراقية شملت المصادقة، الأدوار، عزل المستأجر، webhooks، API keys، التشفير، الرفع، callbacks، CORS/headers، الأسرار، الاعتماديات، حذف البيانات، وإعداد Docker. لم تُستخدم بيانات حقيقية ولم تُعرض أي قيمة سرية. مسح محدود للملفات المتتبعة لم يجد Meta tokens أو private keys صريحة.

## ملخص المخاطر الأمنية

| المرجع | الخطر | الشدة | الحالة |
|---|---|---|---|
| AUD-003 | رموز Meta plaintext وتسريب حقول سرية في responses | High | مغلق محليًا: تشفير + redacted presenters + migration dry-run |
| AUD-004 | API keys/webhook secret plaintext وhash غير مستخدم | High | مغلق: digest مفهرس + secret مشفر + عرض مرة واحدة |
| AUD-005 | media token قابل لاستخدامه كجلسة عامة | High | مغلق ومختبر: audience ومسارات تنزيل محددة |
| AUD-006 | SSRF عبر callback/webhook URL | High | مغلق في التطبيق: DNS/IP pinning وسياسة HTTPS؛ يوصى أيضًا بـegress firewall |
| AUD-007 | حذف بيانات غير كامل | High | مغلق محليًا: lineage تشغيلي + financial redaction + سجل حالة حقيقي |
| AUD-008 | حزم ذات advisories High/Moderate | High | مغلق 2026-07-12: audit صفر في client/server بعد تحديث lockfiles |
| AUD-011 | webhook unsigned عند نشر Docker دون production secret enforcement | High | مغلق: production مفروض وunsigned fail-closed |
| AUD-012 | tenant-controlled regex DoS | High | مغلق: regex غير مقبول ولا ينفذ |
| AUD-020 | logout محلي وJWT في localStorage | Medium | مغلق محليًا: HttpOnly cookie + Origin guard + revocation + legacy rotation |
| AUD-021 | غياب tenant-only policy على mount | Medium | مغلق: policy مركزية على `/portal` و`/portal/messenger-bot` |

## نقاط الحماية الموجودة

- JWT موقّع مع مدة 7 أيام و`jti` وقائمة revocation؛ المتصفح يحمله داخل cookie لا يقرأها JavaScript.
- فحص نشاط المستخدم و`tokens_revoked_at`، وفرض `role` و`tenant_id` الحاليين من قاعدة البيانات في bearer auth.
- bcrypt لكلمات المرور، ورسالة login موحدة تقلل user enumeration.
- rate limiting عام ومشدد لمسارات credential entry.
- Helmet مع CSP على استجابات Express، وHSTS وnosniff وframe protections.
- CORS allowlist بدل wildcard.
- HMAC SHA-256 لتوقيع Meta webhooks عند ضبط `META_APP_SECRET`.
- AES-256-GCM لرموز الوصول الحديثة.
- one-time SSE tokens موجودة، مع استهلاكها بعد الاستخدام.
- قيود حجم رفع 16MB، وبعض MIME allowlists.
- parameterized SQL هو النمط الغالب؛ لم يثبت SQL injection من مدخل مستخدم.
- `.env` وقواعد البيانات وuploads وbuild outputs مهملة من Git.

## المصادقة والجلسات

### JWT

انتقلت جلسة المتصفح من `localStorage` إلى cookie `HttpOnly` مقيدة بـ`/api` و`SameSite=Lax` و`Secure` في production. ترسل الواجهة `credentials: include`، وتمنع Origin guard الطلبات المتغيرة العابرة للأصل، وتدور أي JWT قديم مرة واحدة ثم تحذفه من التخزين. تثبت اختبارات التكامل أن logout وتغيير كلمة المرور يلغيـان token القديم، وتُقرأ صلاحيات role/tenant الحالية من قاعدة البيانات. يبقى Bearer متاحًا لعملاء API غير المتصفح.

توصيات:

1. إضافة session/device list وإلغاء جميع الجلسات عند الاشتباه.
2. إضافة browser E2E يثبت خصائص cookie ورفض Origin خارجي خلف reverse proxy الحقيقي.

أزيل fallback الذي كان يقبل JWT كاملاً داخل SSE query؛ لا يُقبل الآن إلا token عشوائي قصير العمر وأحادي الاستخدام صادر من `/auth/sse-token`.

### Media token

أصبح media token ذا audience مقيد، ولا يُقبل عبر query إلا في مساري GET لتنزيل الوسائط. يتحقق middleware أيضًا من الدور والمستأجر الحاليين ومن نشاط المستخدم.

## التفويض وعزل المستأجر

مسارات admin محمية على مستوى mount، ومسارات tenant تستخدم `tenantMiddleware` مركزيًا قبل routers الخاصة بالبوابة. أضيف اختبار tenant A/B لمسارات Facebook المشتركة واختبار role/status للمصادقة؛ تبقى مصفوفة ownership أشمل مطلوبة لبقية الموارد الفردية.

ضوابط مطلوبة:

- `tenantMiddleware` يفرض `tenant_id` وحالة tenant/user.
- helpers مثل `requireTenantResource(table,id,tenantId)` أو repositories scoped.
- role/ownership matrix tests تشمل admin، tenant A، tenant B، user عام، inactive، suspended.
- منع أي credential fallback إلى «أول مستأجر نشط» في مسارات tenant.

## الأسرار والتشفير

### Meta tokens

تكتب مسارات Embedded Signup وصفحات Facebook وCRUD الإداري ciphertext، وتستخدم presenters محجوبة بدل إرجاع الحقول السرية. أضيف script ترحيل idempotent مع dry-run/verify، وكان عدد plaintext في قاعدة البيئة صفرًا وقت التحقق. أضيف backup/restore drill محلي متحقق؛ تبقى الجدولة والنسخ المشفر off-host وإدارة rotation مسؤولية تشغيلية.

خطة آمنة:

1. backup واختبار restore.
2. عدّ rows الصريحة دون إخراج القيم.
3. تشفير idempotent مع version/key-id.
4. تحقق decrypt/Meta token health.
5. تصفير plaintext.
6. حذف الحقل/fallback في migration لاحقة.
7. DTO allowlist يمنع ciphertext أيضًا من الواجهة.

### API keys

المفتاح عالي entropy ويمكن تخزين digest سريع ومفهرس (مثل SHA-256/HMAC server-side) مع مقارنة ثابتة، أو key id + secret digest. bcrypt scan لكل المستأجرين لا يوفر lookup عمليًا. يجب إظهار المفتاح مرة واحدة فقط عند الإنشاء/التدوير.

## Webhooks وcallbacks

### Meta inbound

التحقق بالتوقيع يستخدم HMAC-SHA256 وفحص طول قبل `timingSafeEqual`، ويفشل مغلقًا افتراضيًا. الاستثناء الصريح للاختبارات/التطوير غير متاح في production، وDocker يفرض production mode.

### Tenant outbound

أضيفت سياسة موحدة تتحقق من HTTPS والمنفذ وDNS وIPv4/IPv6، ترفض أي إجابة غير عامة، وتثبت العنوان المختار أثناء TLS، ولا تسمح إلا بتحويل same-origin. يبقى egress firewall وverification handshake دفاعين تشغيليين مستحسنين.

## التحقق من المدخلات وSQL/XSS

- SQL parameterization مستخدمة على نطاق واسع. Dynamic identifiers/clauses التي شوهدت مبنية غالبًا من allowlists داخلية؛ لم يثبت injection.
- Express JSON محدود بـ1MB.
- لا توجد schema validation موحدة؛ validation يدوي ومتباين في routes.
- automation regex معطل الآن في API والواجهة والتنفيذ؛ `exact` و`contains` فقط مع حدود طول وعدد كلمات.
- `/deletion-status?code=` أصبح مربوطًا بسجل حالة حقيقي مع escaping للمخرجات.
- أخطاء Meta تمر عبر normalizer مركزي يخفي `error_data` و`fbtrace_id` في الفشل؛ سجل التحويلات القديم يُنقح عند العرض أيضًا.

## رفع وتنزيل الملفات

- خط الأساس كان يثق في MIME المعلن ويترك `generalUpload` و`simpleUpload` بلا allowlist.
- المعالجة الحالية تقرأ المحتوى كاملًا ضمن حد 10/16MB، وتتحقق من magic bytes بسياسات image/document/media/CSV قبل دخول handler؛ OOXML يُفحص من central directory دون فك الضغط.
- الرفض يحذف الملف المؤقت، وملفات bot العامة تستخدم UUID وامتدادًا مشتقًا من MIME المكتشف بدل اسم العميل.
- media proxy يستخدم streaming بحد أقصى 25MiB ويوقف التدفق عند تجاوزه.
- `bot-assets` عام وقابل للتخزين المؤقت؛ يجب ألا يحتوي بيانات عميل خاصة.

الإجراءات:

- antivirus أو quarantine خارجي إذا كان threat model يتطلب فحص malware أعمق.
- streaming وحدود content length وtimeouts.
- فصل public assets عن private uploads وتوثيق retention.

## قاعدة البيانات والتزامن — تحديث 2026-07-12

اتصال SQLite يفعّل الآن WAL وforeign keys و`busy_timeout`، وتضيف migration 039
قيود ملكية فعلية لقواعد الأتمتة مع الحفاظ على cooldowns. النشر المدعوم موثق
كـsingle-instance لأن SSE والjobs ما زالت داخل العملية؛ التوسع الأفقي يتطلب
نقل قاعدة البيانات والـevent bus والjobs إلى خدمات مشتركة.

## CORS وHeaders وTLS

- Express headers جيدة، لكن frontend static من Nginx لا يحصل على Helmet headers؛ `nginx.conf` لا يضيف CSP أو headers.
- CORS الافتراضي يضم منافذ Vite 5173/5174، ولا يضم frontend Docker 3133. عند proxy same-origin لن تحتاجه، لكن العقد الحالي معطل.
- المشروع لا يكوّن TLS؛ الاعتماد على reverse proxy خارجي غير موثق. ادعاء HTTPS في السياسة يحتاج تحقق من البنية الفعلية.
- عند وضع rate limiter خلف proxy يجب ضبط `trust proxy` بدقة لتجنب اعتبار كل العملاء IP واحدًا أو الثقة الزائدة.

## الاعتماديات

### Client

- 7 High، 5 Moderate، 1 Low.
- direct affected: `react-router-dom` و`vite` ضمن التقرير الحالي.
- بعض advisories تخص dev/build/SSR surfaces وقد لا تكون قابلة للاستغلال في SPA static، لكن يجب الترقية والتحقق بدل تجاهلها.

### Server

- أظهر `npm audit --audit-level=low` صفر advisories في client/server بعد تحديث lockfiles دون `--force`.

## حذف البيانات والخصوصية

أضيف data-lineage تشغيلي يحذف الهوية من مخازن الرسائل/webhooks/bot/contacts والملفات ذات الصلة، وينقح metadata المالية المحتفظ بها، مع signed request وسجل حالة pseudonymous. تبقى سياسات retention للنسخ الاحتياطية والتوافق القانوني قرارات تشغيلية خارج التطبيق.

## ترتيب المعالجة الأمنية

1. AUD-011: fail-closed للwebhook وفرض production config.
2. AUD-005: حصر media token.
3. AUD-003/004/014: إزالة plaintext secrets وتدويرها.
4. AUD-006: SSRF controls وegress policy.
5. AUD-007: حذف بيانات كامل وقابل للتدقيق.
6. AUD-008: ترقية الحزم المتأثرة.
7. AUD-012: إزالة/عزل regex غير الآمن.
8. AUD-020/021: session وtenant policy.
9. file validation/static headers/rate limiter proxy config.
10. security regression tests وsecret scan في CI.

## حدود المراجعة

- لم تُجرَ اختبارات penetration على production أو حسابات Meta.
- لم تُفحص قيم قاعدة البيانات الفعلية أو محتوى رسائل المستخدمين.
- لم يُفحص reverse proxy/DNS/TLS الخارجي.
- لم تُبن صور Docker وقت المراجعة الأصلية؛ بُنيت وشُغلت لاحقًا في 2026-07-15، وبقي تقرير CVE النهائي.
- لم تُحسب exploitability النهائية لكل advisory؛ يلزم threat-specific triage بعد upgrade baseline.
