# الديون التقنية

## التقييم العام

الدين التقني مرتفع لكنه قابل للتقسيط. الخطر الأكبر ليس قدم التقنية، بل نمو المجالات داخل ملفات مركزية بلا اختبارات أو عقود ثابتة. أي إعادة هيكلة واسعة الآن ستزيد المخاطر؛ المطلوب أولًا تثبيت التشغيل والأمان وبناء شبكة اختبارات.

> **تحديث 2026-07-14:** القيم الأصلية في الجدول خط أساس. أصبح `tenantPortal.js` composition facade عند 208 أسطر/صفر endpoints مباشرة بعد استخراج جميع المجالات، و`messengerBot.js` facade عند 21 سطرًا فوق أربعة routers مجالية ووحدة مشتركة، وتحول `messages.js` من 1,707 سطرًا/20 endpoint إلى composition facade من 19 سطرًا/صفر endpoints بعد استخراج sends/media/queries/broadcast/contacts/read-receipts، وفُصلت وسائط المستأجر في router مستقل، وانخفض `api/v1.js` من 876 إلى composition facade من 45 سطرًا بعد استخراج الإرسال والقراءات والأحداث إلى routers محقونة ومختبرة، ووُحّد processor البث والتحقق من الرسائل بين الإدارة والمستأجر وAPI v1، وأصبح fallback القالب يحترم قاعدة البيانات المحقونة، وتحول service الفوترة إلى facade من 267 سطرًا فوق 18 وحدة، وانخفض `api/index.js` من 2,027 إلى 292 سطرًا بعد نقل 265 method إلى خمس وحدات مجال؛ تحمي هذه الحدود 246 اختبارًا وبوابة coverage وبناء/lint.

| الدين | الدليل | الأثر مع التوسع | المقترح | الأولوية | الجهد |
|---|---|---|---|---|---|
| Route monolith للبوابة | خط الأساس 5,522/89؛ الحالي `tenantPortal.js` 208/0 + 15 routers مجالية | أزيلت كتلة البوابة؛ بقي ضبط أحجام بعض routers المجالية | إبقاء facade للتركيب فقط وتقسيم أي router يتجاوز حد المجال | P3 | S مستمر |
| Route monolith لـMessenger Bot | خط الأساس `messengerBot.js` 987/17؛ الحالي facade 21/0 + 4 routers مجالية ووحدة مشتركة | عُزل الكتالوج والتدفقات والجلسات والملخص مع حقن قاعدة الاختبار | إبقاء facade تركيبية وتقسيم منطق use-case داخل الوحدات عند نموه | P3 | S مستمر |
| Route monolith للرسائل الإدارية | خط الأساس `messages.js` 1,707/20؛ الحالي facade 19/0 فوق ست وحدات محقونة | عُزل الإرسال والوسائط وSQL القراءة وCRUD/validation/Meta verification/read receipt والبث؛ بقي ضبط حجم الوحدات المجالية عند نموها | إبقاء facade تركيبية وتقسيم `messageMedia.js` حسب use-case إذا تجاوز مجاله الحالي | P3 | S مستمر |
| Service monolith للفوترة | خط الأساس 3,682؛ الحالي `billing.js` facade عند 267 + 18 وحدة مجالية | أُزيلت الكتلة المركزية؛ الخطر الآن إعادة تراكم المنطق | إبقاء facade بلا SQL جديد وتوجيه كل منطق إلى وحدة مجالية مختبرة | P3 | S مستمر |
| API client واحد | خط الأساس 2,027؛ الحالي `api/index.js` facade عند 292 + 5 وحدات مجال | أزيلت الكتلة المركزية؛ بقي توحيد upload/error helpers داخل transport | إبقاء facade متوافقًا وتقسيم الوحدات عند تجاوز حدود المجال | P3 | S مستمر |
| UI admin/tenant مكرر | أُزيلت الحدود المشتركة من Templates/Automation/Broadcast/Contacts/FB content | صار العرض والتحقق موحدًا؛ بقي orchestration عميق متشابه داخل بعض الصفحات | إبقاء adapters/permissions منفصلة واستخراج hooks/use-cases عند التعديل التالي | P3 | M مستمر |
| Accessibility غير متسقة | أضيفت `PageTitle/SectionTitle/MetricValue` و`AccessibleSelect` وعقود `h1` والأسماء لكل 40 Dialog و92 IconButton و73 Select، واجتازت 41 صفحة axe بصفر violations بعد إصلاح التباين والقوائم والأدوار والتقدم | حالات rows الغنية بالبيانات لم تُفتح كلها، ولا يوجد قارئ شاشة كامل، وتبقى نتائج axe incomplete لونية | تشغيل قارئ شاشة ومراجعة incomplete على الحالات الغنية بالبيانات | P3 | M |
| SQL مباشر في routes | معظم `server/routes` | صعوبة test والعزل المتكرر | repositories scoped أو query modules | P2 | L–XL |
| عزل tenant غير مركزي | كل handler يضيف predicate | IDOR محتمل عند endpoint جديد | tenant policy + scoped repositories | P1 | M |
| Meta client متكرر | عشرات `fetch` | timeouts/error mapping متباين | client مركزي بpolicy | P2 | L |
| أسرار legacy | plaintext fields/fallback | تسرب وrotation صعب | migration + حذف fallback/fields | P0 | M |
| تغطية غير شاملة | 246 اختبارًا وبوابة `c8 --all`: ‏51.51% statements/lines و66.74% branches و71.22% functions، بحدود دنيا 51/51/66/71؛ لا Browser/Meta E2E كامل | تبقى regressions ممكنة في الملفات ذات الصفر والتدفقات المرئية والتكامل الخارجي | رفع الحدود تدريجيًا + Browser E2E + Meta sandbox suite | P1 | L–XL |
| لا schema validation | validation يدوي | 400/500 غير متسقة ومدخلات خطرة | Zod/Joi أو validators بسيطة مشتركة | P2 | L |
| SQLite/SSE process-local | DB sync + EventBus memory | لا horizontal scale وفقد events | توثيق single-instance الآن؛ queue/pubsub عند الحاجة | P2 | L–XL |
| تغطية ترقية migrations جزئية | أضيفت fixtures لـ018/038/039 وsnapshot حارس لآخر migration مع rollback ذري وSHA-256؛ لا snapshots لكل إصدار تاريخي | فقد دلالات upgrade قديمة لا يغطيها snapshot الحالي | إبقاء snapshot محدثًا وإضافة fixtures عند أي migration تحويلية | P2 | S–M |
| Observability ضعيف | console logs/health سطحي | MTTR مرتفع | structured logs/metrics/readiness | P2 | L |
| Docker غير حتمي | أُغلقت أسباب عدم الحتمية والتحصين: digests + `npm ci` + non-root/read-only/cap-drop/no-new-privileges، ونجح build/runtime smoke؛ بقي تقرير CVE لتعذر تنزيل قاعدة الماسح | لا يوجد دليل CVE نهائي للصورتين حتى الآن | تشغيل scanner يرفض High/Critical في بيئة تستطيع تنزيل قاعدة CVE وإبقاؤه بوابة إصدار | P2 | S |
| Documentation drift | DEPLOY مقابل Nginx | onboarding ونشر خاطئ | docs-as-tested + smoke commands | P3 | S |

## ملفات متعددة المسؤوليات

| الملف | المسؤوليات المختلطة |
|---|---|
| `server/routes/tenantPortal.js` | تركيب routers البوابة وحقن الاعتماديات فقط |
| `server/routes/tenantAutomation.js` | CRUD/filters/stats لقواعد أتمتة المستأجر فقط |
| `server/routes/tenantApiSettings.js` | دورة مفاتيح API وwebhook secrets وcallback URLs للمستأجر فقط |
| `server/routes/tenantContacts.js` | CRUD/search/pagination لجهات اتصال المستأجر فقط |
| `server/routes/tenantBilling.js` | summary/ledger/invoices المقيدة للمستأجر فقط |
| `server/routes/tenantDashboard.js` | تجميع مؤشرات WhatsApp/Messenger/pages/templates/activity للمستأجر فقط |
| `server/routes/tenantProfile.js` | profile الحساب بallowlist وقراءة/تحديث WhatsApp business profile ضمن بيانات اعتماد المستأجر |
| `server/routes/tenantAnalytics.js` | عدادات الرسائل والتوزيع اليومي/النوعي المعزول للمستأجر |
| `server/routes/tenantQrCodes.js` | دورة QR عبر بيانات اعتماد المستأجر، مع allowlist للحمولة وترميز معرّف Meta |
| `server/routes/tenantConversions.js` | Dataset settings/history وWhatsApp business events مع عزل tenant وتنقيح Meta ودورة فوترة reserve/commit/release |
| `server/routes/tenantFacebookMessaging.js` | قائمة صفحات Facebook وحالة webhook ورسائل Messenger الموسومة مع عزل tenant ورمز في Authorization ودورة فوترة reserve/commit/release |
| `server/routes/tenantMetaOnboarding.js` | Facebook OAuth/link/disconnect والتشخيص وMeta Review snapshots وربط WhatsApp بعد التحقق من WABA، بجلسات state قصيرة ورموز لا تعاد للمتصفح |
| `server/routes/tenantBroadcasts.js` | إنشاء/متابعة broadcast jobs للمستأجر مع predicates ونتائج محدودة؛ يفوض معالجة الدفعات إلى processor مشترك |
| `server/routes/tenantTemplates.js` | CRUD/import/sync/create/delete للقوالب المحلية وMeta، مع تحديث جزئي allowlist وpagination same-origin وعزل tenant |
| `server/routes/tenantMessengerSync.js` | مزامنة محادثات ورسائل Messenger idempotent لكل صفحات المستأجر، برموز في Authorization وpagination same-origin |
| `server/routes/tenantUnifiedInbox.js` | دمج وقراءة وإرسال WhatsApp/Messenger وتعليم القراءة، مع تحقق channel/contact وملكية الصفحة/المحادثة ودورة فوترة |
| `server/routes/tenantWhatsAppMessaging.js` | محادثات ورسائل نصية/قالبية/تفاعلية مع نافذة 24 ساعة وفوترة؛ يركّب router الوسائط المستقل |
| `server/routes/tenantWhatsAppMedia.js` | رفع/إرسال/تنزيل وسائط المستأجر مع تحقق النوع والنافذة وتنظيف الملفات وفوترة وallowlist لرابط التنزيل |
| `server/routes/api/v1.js` | composition facade من 45 سطرًا يركّب routers الإرسال والقراءات والأحداث ويحتفظ بعقد health/callback فقط |
| `server/routes/api/v1Messaging.js` | إرسال النص/القالب/رابط الوسائط/المستند/التفاعل لعملاء API مع تحقق مشترك ونافذة 24 ساعة وتسوية فوترة أحادية |
| `server/routes/api/v1Queries.js` | قراءات المحادثات والرسائل والقوالب مع pagination وتحقق المعرفات وallowlists وعزل tenant في joins |
| `server/routes/api/v1Events.js` | إرسال/تاريخ أحداث WhatsApp مع حدود batch وattribution وتطبيع Meta وتسوية فوترة أحادية وتنقيح السجل |
| `server/routes/messengerBot.js` | تركيب routers الملخص والمنتجات والتدفقات والجلسات وحقن الاعتماديات فقط |
| `server/routes/messengerBotProducts.js` | كتالوج المنتجات ومعرض الصور واستيراد CSV وأصول الصور العامة ضمن عزل tenant |
| `server/routes/messengerBotFlows.js` | CRUD التدفقات والعقد والتشخيص والتفعيل والمعاينة وسجل الأحداث ضمن عزل tenant |
| `server/routes/messengerBotSessions.js` | قراءة وتحديث جلسات البوت مع pagination وعزل tenant |
| `server/routes/messengerBotSummary.js` | تجميع مؤشرات المنتجات والتدفقات والجلسات والأحداث والصفحات لكل tenant |
| `server/routes/messages.js` | composition facade لتركيب routers الإرسال والوسائط والاستعلامات والبث وجهات الاتصال وتعليم القراءة فقط |
| `server/routes/messageSends.js` | إرسال النصوص والقوالب والتفاعل مع تحقق tenant/phone/window/template، وMeta/فوترة/persistence محقونة |
| `server/routes/messageMedia.js` | اكتشاف/تنزيل/رفع وإرسال وسائط الرابط والملف مع تحقق tenant/phone/type/URL/window، ونطاقات Meta موثوقة وتنظيف وفوترة/persistence محقونة |
| `server/routes/messageQueries.js` | نافذة 24 ساعة وسجلات الرسائل/webhooks وقائمة المحادثات وخيوطها، مع pagination/validation وعزل tenant وإثراء القوالب من DB محقونة |
| `server/routes/messageBroadcasts.js` | إنشاء/قراءة broadcast jobs الإدارية وحقن بيانات الاعتماد/Meta/الفوترة/events في processor المشترك |
| `server/services/broadcastProcessor.js` | معالجة دفعات البث المشتركة، تسجيل النتائج، تسوية الفوترة، وتوجيه progress/complete لقناة السياق |
| `server/services/whatsappMessageValidation.js` | حدود مشتركة للمستلم والنص والقالب والوسائط وبنية الأزرار/القوائم التفاعلية بين الإدارة والمستأجر |
| `server/services/whatsappConversationWindow.js` | حساب موحد وآمن زمنيًا لنافذة خدمة WhatsApp بين الإدارة والمستأجر وAPI v1 |
| `server/routes/messageContacts.js` | قائمة وCRUD جهات الاتصال والتحقق الاختياري عبر قالب Meta مع validation وفوترة وحقن اعتماديات |
| `server/routes/messageReadReceipts.js` | إرسال إيصال القراءة عبر بيانات اعتماد tenant/overrides مع تطبيع Meta failure |
| `server/services/billing.js` | pricing، balances، reservations، ledger، rates، cost calculation، invoices، reconciliation، snapshots |
| `server/services/billingCore.js` | ثوابت العمليات، `BillingError`، normalizers وعقد HTTP للأخطاء |
| `server/services/billingMath.js` | تحويل تكلفة Meta إلى credits وتوزيع الخصم بين plan/wallet/credit |
| `server/services/billingMetaAnalytics.js` | بناء طلب analytics، قراءة Meta الموحدة، وتجميع message/conversation/pricing points |
| `server/services/billingMetaRates.js` | CRUD/upsert لأسعار Meta والتحقق من الفئة/العملة/المبلغ/tier/فترة السريان |
| `server/services/billingSettings.js` | قراءة/تحديث ذري لإعدادات التحويل والهامش وسياسة تسعير WhatsApp مع defaults آمنة |
| `server/services/billingPeriod.js` | توحيد تواريخ SQL والفترات وUnix timestamps مع رفض التواريخ المستحيلة |
| `server/services/billingHistory.js` | قراءات ledger/invoices محدودة ومعزولة وإنشاء فاتورة credits/LYD |
| `server/services/billingAccount.js` | إنشاء حساب idempotent، حالة الدورة، توافر الرصيد، الحجوزات، ومزامنة `tenants.credits` مع توافق legacy |
| `server/services/billingUsage.js` | reserve/commit/release الذرية، خصم balances، قيد usage، وidempotency مع منع التصادم بين المستأجرين |
| `server/services/billingLedgerMutations.js` | payment/adjustment/plan/allowance/account updates مع تحقق الملكية وledger لصافي كل تغير مالي |
| `server/services/billingSummary.js` | ملخص account/usage/profitability مع عزل tenant والفترة وحجب المقاييس الداخلية |
| `server/services/billingMetaUsage.js` | stream موحد ومحدود لـMeta costs/usage fallback، وتجميع التكلفة وقوائم invoices/snapshots |
| `server/services/billingMetaSync.js` | dedup للحساب المحلي، مقارنة snapshot، وتطبيع/مزامنة analytics مع Meta |
| `server/services/billingMetaReconciliation.js` | metrics/action items وربط usage/invoices وفترات المطابقة والمراجعة |
| `server/services/billingQuote.js` | عقد quote للـfixed/meta-like/meta-cost-plus مع النوافذ والرصيد والحجوزات |
| `server/services/billingMetaPricing.js` | حل سعر Meta حسب المستأجر والدولة/العملة/الشريحة، تقدير الرسائل والمستلمين، وحساب الكمية المحلية meta-like |
| `server/services/billingMetaMessageCosts.js` | تسجيل تكلفة الرسالة وتحديثها idempotently مع عزل `wamid` وحماية final/invoice-reconciled |
| `server/services/billingMetaStatus.js` | تنسيق status webhook واعتماد/تحرير الحجوزات وإنهاء فوترة البث عند اكتمال الحالات |
| `client/src/api/index.js` | transport والجلسة وauth وmedia token وتركيب واجهة API singleton المتوافقة |
| `client/src/api/portalCore.js` | حساب المستأجر وWhatsApp inbox/templates/settings/profile/analytics/QR/conversions للبوابة |
| `client/src/api/metaAdmin.js` | إدارة Meta الإدارية: WhatsApp/Facebook/Messenger bot/insights/partners/conversions |
| `client/src/api/operations.js` | contacts/broadcast/billing/token health/webhook failures/unified inbox/automation |
| `client/src/api/tenantFacebook.js` | صفحات ومحتوى وتحليلات ورسائل وbot Facebook الخاصة بالمستأجر |
| `client/src/api/tenantMeta.js` | OAuth/Meta Review وربط Facebook وWhatsApp ذاتيًا |
| `client/src/pages/Automation/automationConfig.js` و`AutomationPresentation.jsx` | خيارات وقيم افتراضية وعرض rule/channel المشترك بين admin/tenant |
| `client/src/pages/Templates/templateConfig.js` و`TemplatePresentation.jsx` | نموذج القالب وبناء Meta components وعرض status/quality المشترك |
| `client/src/pages/Contacts/contactConfig.js` و`ContactPresentation.jsx` | labels وجدول CTWA والهوية والحذف المشترك |
| `client/src/pages/Broadcast/broadcastConfig.js` و`BroadcastRecipientsStep.jsx` | تنقية المستلمين وحقول contact وسياسة media وخطوة الاختيار المشتركة بحدود سياق صريحة |
| `client/src/pages/Facebook/facebookContentConfig.js` و`FacebookContentPresentation.jsx` | tabs ونص المنشور والحذف والإشعارات وتنسيق الوقت المشترك |
| `client/src/pages/MessengerBot/MessengerBotManager.jsx` | products، flows، nodes، diagnostics، sessions، events، import/upload |
| `client/src/pages/Billing/BillingManager.jsx` | plans، prices، tenant accounts، Meta rates، usage، reconciliation، invoices |

## استراتيجية السداد

1. **حماية السلوك:** tests للعقود والعزل والفوترة وmigrations.
2. **تثبيت الحدود:** contract موحد `/api`، Meta client، tenant policy، error envelope.
3. **استخراج منخفض المخاطر:** نقل router كامل لمجال واحد دون تغيير endpoint.
4. **إزالة التكرار:** مشاركة components/hooks بعد تطابق behavior.
5. **تحسين البنية الداخلية:** repositories/use-cases عند وجود حاجة اختبارية، لا abstractions مسبقة.

## ما لا يُنصح به الآن

- إعادة كتابة Backend بإطار جديد.
- استبدال SQLite قبل قياس concurrency والحجم.
- دمج admin وtenant UI دفعة واحدة.
- ترقية كل dependencies وإعادة الهيكلة في commit واحد.
- حذف الشاشات غير المربوطة قبل قياس الاستخدام وروابط العملاء.

## شروط انخفاض الدين إلى مستوى مقبول

- 0 High/Critical advisories قابلة للاستغلال.
- اختبارات role/tenant matrix وbilling invariants وmigration upgrades في CI.
- لا ملف route يتجاوز مجالًا وظيفيًا واحدًا.
- لا plaintext credentials ولا `SELECT *` في DTOs الحساسة.
- deploy runbook مجرب من clone نظيف، مع backup/rollback/readiness.
