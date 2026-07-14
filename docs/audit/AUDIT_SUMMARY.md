# ملخص التدقيق الرقمي

> **تحديث الإصلاح — 2026-07-15:** الأرقام الواردة في بطاقة التدقيق تمثل خط الأساس وقت الاكتشاف. أُغلقت البنود AUD-001/002/003/004/005/006/007/008/009/011/012/013/014/015/016/017/019/020/021/024/026/027/028 محليًا، وأصبح AUD-010 جزئيًا مع 246 اختبارًا آليًا ناجحًا وبوابة `c8 --all` تشمل كل `routes/services/middleware/db` بحدود CI دنيا، وتشمل الاختبارات auth/cookie/role/tenant وpagination ورفع/تنزيل/تنظيف الملفات وrestore/metrics/bootstrap ودلالات الصفحات العامة والخاصة والأتمتة وأسرار API واستعلامات الرسائل وإرسال النصوص/القوالب/التفاعل/الوسائط عبر الإدارة والمستأجر وAPI v1 وقراءات/أحداث API v1 وجهات الاتصال والتحقق عبر Meta وتعليم القراءة والفوترة وحساباتها وحجوزاتها وعروضها وحركات ledger وملخصاتها وفتراتها/سجلها/فواتيرها وMeta usage/sync/reconciliation وأسعارها وحل شرائحها وتقديراتها وتكلفة الرسالة/status والبث وإعداداتها وprofile/analytics/dashboard/QR/conversions وصفحات Facebook ورسائلها الموسومة وOAuth/Meta Review/WhatsApp onboarding والبث الإداري وبث المستأجر والقوالب ومزامنة Messenger وصندوق الوارد الموحد ورسائل/وسائط WhatsApp المعزولة للمستأجر وكتالوج/تدفقات/جلسات/ملخص Messenger Bot وعقود تركيب facades وعميل API ومشاركة واجهات الأتمتة/القوالب/جهات الاتصال/البث/Facebook وترقيات قاعدة البيانات الذرية. AUD-018/022/023/025 تحسنت جزئيًا؛ بُنيت صورتا Docker فعليًا وشُغّلتا معزولتين بمستخدمين غير جذريين وrootfs للقراءة فقط ونجح `/health` وSPA وproxy ‏`/api`، وبقي فحص CVE لأن Scout يتطلب Docker ID وتنزيل قاعدة Trivy توقف من مصدريه. كما مرّ axe على 41 مسارًا بصفر violations، بينما تفعيل branch protection وMeta E2E وقارئ الشاشة اليدوي الكامل يبقى عملاً خارجيًا.

## نتيجة دفعة الإصلاح الحالية

| المجال | النتيجة المتحققة |
|---|---|
| التشغيل | عقد `/api` موحد في Vite/Nginx، healthcheck واعتماد ترتيب الحاويات، و`NODE_ENV=production` في Docker |
| webhooks والوسائط | توقيع Meta fail-closed، وmedia token محصور في مساري GET للتنزيل |
| رفع الملفات | magic-byte sniffing بسياسات image/media/document/CSV، حذف الرفض، وأسماء عامة عشوائية بامتداد موثوق |
| الأسرار | تشفير Meta tokens، DTOs محجوبة، API keys digest، webhook secrets مشفرة، وadmin bootstrap صريح لا يطبع كلمة المرور |
| SSRF | HTTPS:443 فقط، فحص DNS لكل الإجابات، حظر العناوين غير العامة، تثبيت IP في TLS، وتحويلات same-origin فقط |
| الأتمتة | تعطيل regex الذي يحدده المستخدم، والإبقاء على exact/contains بحدود معلنة |
| العزل | `tenantMiddleware` مركزي على كل mounts الخاصة بالبوابة، واختبار tenant A/B لمسارات Facebook واختبار role/status للمصادقة |
| الجلسات | cookie متصفح `HttpOnly/SameSite=Lax/Secure`، Origin guard، تدوير legacy JWT، وإبقاء Bearer لعملاء API |
| حذف البيانات | signed request صارم، سجل حالة pseudonymous، حذف stores التشغيلية وتنقيح metadata المالية |
| الاعتماديات | تحديث lockfiles دون `--force`؛ `npm audit --audit-level=low` = صفر للخادم والواجهة |
| الاستقرار | timeout افتراضي 30s، retry لـGET/HEAD فقط، streaming بحد 25MiB، pagination، readiness، وMeta JSON/error mapping مركزي معمّم على المسارات والخدمات |
| الواجهة | إزالة تحذيرات React، lazy loading لكل الصفحات، وتقسيم الحزمة من 1.54MB إلى entry 278KB + React 231KB + MUI 403KB، وتنقل دلالي بروابط مع حلقة focus و`PageTitle/SectionTitle/MetricValue`، وعقد يفرض عنوان `h1` على كل lazy route |
| البيانات | WAL + FK + busy timeout، migration 039 لملكية automation، تطبيق/تسجيل migrations ذري مع SHA-256 وsnapshot upgrade حارس، وتوثيق single-instance صريح |
| الهيكلة | اكتمل تحويل `tenantPortal.js` إلى composition facade عند 208 أسطر/صفر endpoints، و`messengerBot.js` إلى facade عند 21 سطرًا فوق أربعة routers مجالية ووحدة مشتركة، وتحول `messages.js` من 1,707 سطرًا/20 endpoint إلى facade عند 19 سطرًا/صفر endpoints بعد استخراج sends/media/queries/broadcast/contacts/read-receipts إلى routers محقونة، وفُصلت وسائط المستأجر، وانخفض `api/v1.js` من 876 إلى composition facade من 45 سطرًا بعد استخراج الإرسال والقراءات والأحداث إلى ثلاثة routers، ووُحّدت معالجة بث الإدارة والمستأجر في `broadcastProcessor.js` والتحقق من الرسائل ونافذة المحادثة بين الإدارة والمستأجر وAPI v1، وأُصلح إثراء fallback القالب ليستخدم قاعدة router المحقونة، واستخراج 18 وحدة فوترة مع `billing.js` facade عند 267 سطرًا، وتحويل `api/index.js` من 2,027 إلى 292 سطرًا مع خمس وحدات مجال، ومشاركة حدود العرض/التحقق في الأتمتة والقوالب وجهات الاتصال والبث ومحتوى Facebook بين admin وtenant |
| المراقبة والاستعادة | request IDs، JSON logs/redaction، 5m/DB signals، Prometheus bearer endpoint وقواعد alerts، وbackup/restore متحقق |
| Docker | صورتا server/client مبنيتان من digests مثبتة؛ تشغيل معزول ناجح بمستخدمَي `node`/`nginx`، rootfs للقراءة فقط، `cap_drop: ALL`، `no-new-privileges`، وtmpfs محددة؛ قاعدة البيانات على `/app/data` دون حجب مصدر `/app/db` |
| CI والمستودع | Actions مثبتة على SHA، tests/lint/build/audit/Compose وصور Docker، Gitleaks، Dependabot npm/actions/docker |
| الفوترة | account/reserve/commit/release + حركات مالية مدققة + summary/period/history/invoice + Meta usage/snapshot/reconciliation؛ pagination موحدة بلا تكرار، فترات وملكية فواتير صارمة، وsnapshot API محاكى، مع توافق legacy ومنع idempotency العابر للمستأجرين |
| التحقق | 246/246 server tests؛ coverage شامل: 51.51% statements/lines و66.74% branches و71.22% functions مع floors ‏51/51/66/71؛ 39 migration، عقود `h1` لكل lazy route وأسماء 40 حوارًا و92 `IconButton` و73 `Select` وupload/progress semantics، client build/lint بلا تحذيرات، و`npm audit` بصفر ثغرات للطرفين، وBrowser DOM/accessibility smoke لكل 19 مسار إدارة و18 مسار مستأجر عند 1440 مع عينة responsive/keyboard وحوار فعلي عند 390؛ axe على 41 مسارًا بصفر violations؛ Docker build وruntime smoke ناجحان، وبقي container CVE scan لعدم توفر قاعدة الماسح |

## بطاقة المشروع

| المؤشر | القيمة |
|---|---:|
| التطبيقات القابلة للتشغيل | 2: client + server |
| مجموعات Backend الرئيسية | 58 route modules + 46 service modules |
| مسارات React | 46 شامل 404 |
| Express endpoints | 297 |
| migrations | 39 |
| جداول قاعدة جديدة | 39 |
| الفهارس | 83 |
| JavaScript/JSX LOC | 67,175 تقريبًا |
| الوظائف المكتشفة | 58 |
| الوظائف المكتملة والمتحقق منها | 4 |
| الوظائف الجزئية | 35 |
| الوظائف غير المربوطة | 4 |
| الوظائف المعطلة | 2 |
| الوظائف المحتاجة اختبارًا خارجيًا | 13 |

## المشاكل حسب الشدة

| الشدة | العدد |
|---|---:|
| Critical | 2 |
| High | 10 |
| Medium | 12 |
| Low | 4 |
| Informational | 0 |
| **الإجمالي** | **28** |

## المشاكل حسب المجال

التصنيفات متداخلة؛ المشكلة الواحدة قد تُحسب في أكثر من مجال.

| المجال | العدد |
|---|---:|
| الأمان/الخصوصية | 10 |
| الأداء/الاستقرار | 6 |
| الواجهة/UX/التكامل الأمامي | 6 |
| قاعدة البيانات/migrations | 5 |
| النشر/التشغيل | 7 |
| جودة الكود/الاختبارات | 5 |

## الاختبارات والتحقق

| البند | ناجح | فاشل/تحذير | غير متاح |
|---|---:|---:|---:|
| اختبارات آلية موجودة | 246 + coverage gate | 0 | — |
| build الواجهة | 1 | 0 | — |
| lint | 1 | 0 | — |
| server syntax | 1 | 0 | — |
| DB fresh migration/integrity/FK | 3 | 0 | — |
| server startup/health/guards | 1 مجموعة | 0 | Meta E2E |
| browser responsive accessibility | كل 19 admin + 18 tenant عند 1440، وpublic + 6 admin + 6 tenant وحوار template عند 390؛ عقد 73 Select مع تحقق فعلي لأسماء حقول القالب؛ axe لكل 41 مسارًا مباشرًا | عنوان `h1` واحد، وتسلسل headings وlandmarks/control names/focus، وأسماء الحوار والحقول الفعلية بلا overflow، وصفر axe violations | قارئ شاشة يدوي، نتائج axe incomplete اللونية، وحالات rows الغنية بالبيانات |
| backup/restore drill | 3 | 0 | scheduler/off-host copy |
| migration upgrade regression | 2 | 0 | — |
| npm audit | 2 | 0 | — |
| Docker containers | build للصورتين + server/client runtime smoke + `/health` وSPA و`/api/health` proxy + non-root/read-only inspection | 0 في البناء والتشغيل | CVE database/scan |

## أهم عشرة بنود

1. AUD-001 — إصلاح `/api`/proxy.
2. AUD-002 — إعداد `CRYPTO_KEY` بأمان.
3. AUD-011 — production fail-closed لتوقيع webhook.
4. AUD-005 — حصر media token.
5. AUD-003 — إزالة plaintext Meta tokens وحقول response الحساسة.
6. AUD-004 — تدوير API keys وتخزين digest.
7. AUD-006 — منع SSRF.
8. AUD-009 — إصلاح route shadow لحذف Meta templates.
9. AUD-010 — إضافة اختبارات auth/tenant/billing/migrations.
10. AUD-007 — إصلاح حذف البيانات والصفحة التابعة له.

## مؤشرات الجاهزية

| البعد | التقدير |
|---|---|
| البناء | جيد: client build وserver syntax ناجحان |
| التشغيل المحلي الحالي | جاهز مبدئيًا؛ setup آمن ومتحقق وAPI smoke ناجح |
| قاعدة جديدة | جيدة بنيويًا مع ملاحظات constraints/upgrade |
| الوظائف Meta | تنفيذ واسع، غير مثبت E2E |
| الأمان | P0 ومخاطر الجلسة ورفع الملفات المكتشفة مغلقة محليًا؛ تبقى دفاعات المنصة والتشغيل الخارجية |
| الاختبارات | contract/security وDB/auth/billing integration وcoverage gate موجودة؛ يلزم رفع التغطية تدريجيًا وإضافة browser E2E وMeta E2E |
| الأداء | القوائم والوسائط محدودة؛ load/concurrency الفعليان غير مقاسين |
| النشر | Dockerfiles مثبتة digests، وCI يبني الصورتين؛ نجح build وruntime smoke محلي مع non-root/read-only/cap-drop/no-new-privileges؛ بقي فحص CVE للصورتين |
| المراقبة والاستعادة | جيدة محليًا: readiness/metrics/alerts وrestore drill؛ يلزم Alertmanager/tracing وجدولة نسخة off-host على منصة النشر |
| الجاهزية الإجمالية للإنتاج | متوسطة: بوابات الكود وDocker runtime محليًا خضراء؛ container CVE scan وMeta E2E وضوابط المنصة ما زالت شروط إطلاق |

## الحكم

المشروع يحتاج **إصلاحًا تدريجيًا مع إعادة هيكلة محدودة لاحقة**. لا يوجد مبرر تقني لإعادة كتابة كاملة: migrations الجديدة تعمل، المجالات الأساسية موجودة، والحماية الأولية ليست معدومة. لكن لا ينبغي إضافة ميزات إنتاجية جديدة قبل إغلاق P0، حماية الأسرار والتفويض، وإضافة اختبارات حرجة.
