# Wa Savana ↔ Savana POS

محول اختياري لكل Tenant عبر Savana Connect. تعمل المراسلات وMeta
والبوت والفوترة التشغيلية كاملةً عند تعطيل المحول أو توقف خدمة
Connect.

## الملكية والحدود

- POS هو مصدر أحداث المبيعات والإرجاعات والمخزون.
- Catalog هو مصدر بيانات المنتج التجارية عند وصول
  `catalog.product_snapshot.v1`.
- Wa Savana تحتفظ بنسخة projection محلية ولا تعدل المصدر.
- scope `pos.products.map` يسمح بتمرير projection من Catalog عبر اتصال
  POS الصريح، من غير إنشاء اعتماد خفي بين المنصتين.
- لا يرسل المحول رسائل تلقائية. ينشئ مرشح مراجعة فقط عند وجود
  `phone_e164` و`receipt_notification_consent=true`.
- الوحدة المحلية للأرصدة وتكلفة Meta هي دفتر تشغيلي؛ أما خطة المنصة
  واستحقاق الربط فمصدرهما Savana Subscriptions.

## الأمان والتشغيل

- توقيع entitlement يُتحقق منه محلياً ويُرفض عند الخطأ أو الانتهاء.
- callback يتطلب رمز خدمة خاصاً و`connection_id` نشطاً لنفس المؤسسة.
- Inbox يمنع تكرار `event_id` أو `idempotency_key`.
- Pause/Resume/Revoke لا تحذف بيانات Wa Savana الأساسية.
- في الإنتاج تضبط متغيرات `server/.env.example` وتطبق migration 042.
