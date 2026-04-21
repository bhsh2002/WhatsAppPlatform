# Meta App Permissions — Usage Documentation

> **Platform**: Wa Savana — a multi-tenant SaaS platform operated by **Savana Company** (شركة سافانا) as a **Tech Service Provider (TSP)** registered with Meta.
>
> **Architecture**: Savana (the Manager) administrates the platform and manages multiple **Tenants** (business clients). Each tenant has their own WhatsApp Business Account, Facebook Pages, phone numbers, and automation rules. All operations described below are performed by the Manager on behalf of Tenants through the platform.
>
> This document details how each Meta permission is used, including exact file locations, API endpoints, and testing instructions. Required for Meta App Review.

---

## 1. `pages_show_list`

**Purpose**: Allows the app to access the list of Facebook Pages that a person manages.

### How We Use It

| Role | Use Case | Description |
|------|----------|-------------|
| **Admin (Manager)** | Fetch & link Pages | The manager calls `GET /me/accounts` to fetch all Pages, then links selected Pages to tenants for automation and messaging |
| **Admin (Manager)** | Verify Page ownership | Before enabling automation, the manager verifies the Page is manageable via the returned list |
| **Tenant** | View linked Pages | Each tenant can view their own linked Facebook Pages with connection status via `GET /api/portal/pages` |
| **Tenant** | Check subscription | Tenants can verify their Page's webhook subscription status via `GET /api/portal/pages/:id/subscription-status` |

### Where It's Used

#### Backend

| File | API Call | Description |
|------|----------|-------------|
| [pages.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/pages.js) | `GET /me/accounts` | Admin fetches the list of Pages the authenticated user manages via Meta Graph API |
| [facebookPages.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/facebookPages.js) | DB insert | Admin links a selected Page to a tenant in `tenant_pages` |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | DB query | Tenant views their linked pages via `GET /api/portal/pages` (scoped by `tenant_id`) |

#### Frontend

| File | Role | Description |
|------|------|-------------|
| [FacebookPages.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/Settings/FacebookPages.jsx) | Admin | Fetches and displays Pages for linking to tenants |
| [FacebookPageManager.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/Facebook/FacebookPageManager.jsx) | Admin | Shows linked Pages with posts, comments, and automation |
| [TenantFacebookPages.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/TenantPortal/TenantFacebookPages.jsx) | Tenant | Displays tenant's linked Pages with subscription status checker |

#### API Endpoints

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| `GET` | `/api/pages/me` | Admin | Returns the list of Pages the manager manages |
| `GET` | `/api/pages/me?tenant_id={id}` | Admin | Returns Pages for a specific tenant context |
| `GET` | `/api/portal/pages` | Tenant | Returns the tenant's linked Pages |
| `GET` | `/api/portal/pages/:id/subscription-status` | Tenant | Checks webhook subscription for a linked Page |

### How to Test

**As Admin:**
1. Login to the admin dashboard at `https://wa.savana.ly`
2. Navigate to **Settings → Facebook Pages** → click **"جلب الصفحات"** (Fetch Pages)
3. The app calls `GET /me/accounts` → displays all manageable Pages
4. Select a Page → link it to a tenant

**As Tenant:**
1. Login to the tenant portal
2. Navigate to **صفحات فيسبوك** (Facebook Pages)
3. View linked Pages with status cards
4. Click **"فحص الاشتراك"** (Check Subscription) to verify webhook status

### Meta Review Description (Arabic)

> نحن شركة سافانا، مزوّد خدمة تقنية (TSP). نستخدم هذا الإذن لعرض قائمة صفحات فيسبوك: يقوم المدير بجلب الصفحات وربطها بالمستأجرين لتشغيل أتمتة الردود وإدارة المحتوى، بينما يتمكن كل مستأجر من عرض صفحاته المرتبطة والتحقق من حالة الاشتراك في الإشعارات عبر بوابته الخاصة.

### Meta Review Description (English)

> We are Savana Company, a Tech Service Provider (TSP). We use this permission to display Facebook Pages: the manager fetches and links Pages to tenants for automation and content management, while each tenant can view their linked Pages and verify webhook subscription status through their own portal.


## 2. `pages_manage_metadata`

**Purpose**: Allows the app to subscribe to and receive webhooks about Page activity, and to update Page settings.

### How We Use It

| Role | Use Case | Description |
|------|----------|-------------|
| **Admin (Manager)** | Subscribe to webhooks | The manager subscribes tenant Pages to `feed`, `messages`, and `messaging_postbacks` webhook fields via `POST /{page-id}/subscribed_apps` |
| **Admin (Manager)** | Manage subscriptions | The manager can re-subscribe, check status, and unsubscribe webhooks for any tenant Page |
| **Admin (Manager)** | Receive notifications | Webhook events (comments, reactions, messages) arrive at our server for processing by the automation engine |
| **Tenant** | Check subscription status | Each tenant can verify their Page's webhook subscription status via `GET /api/portal/pages/:id/subscription-status` |

### Where It's Used

#### Backend

| File | API Call | Description |
|------|----------|-------------|
| [facebookPages.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/facebookPages.js) | `POST /{page-id}/subscribed_apps` | Admin subscribes a Page to webhook events when linking |
| [facebookPages.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/facebookPages.js) | `POST /{page-id}/subscribed_apps` | Admin re-subscribes a Page to webhooks (manual refresh) |
| [facebookPages.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/facebookPages.js) | `DELETE /{page-id}/subscribed_apps` | Admin unsubscribes webhooks when unlinking a Page |
| [facebookPages.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/facebookPages.js) | `GET /{page-id}/subscribed_apps` | Admin checks webhook subscription status |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | `GET /{page-id}/subscribed_apps` | Tenant checks their Page's webhook subscription status |
| [webhooks.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/webhooks.js) | Receives `POST /webhook` | Processes incoming webhook events (comments, reactions, messages) |

#### Frontend

| File | Role | Description |
|------|------|-------------|
| [FacebookPageManager.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/Facebook/FacebookPageManager.jsx) | Admin | Shows webhook status per Page, re-subscribe button, real-time activity |
| [TenantFacebookPages.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/TenantPortal/TenantFacebookPages.jsx) | Tenant | Displays linked Pages with subscription status checker |

#### API Endpoints

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| `POST` | `/api/facebook-pages/tenant/:tenantId` | Admin | Links a Page and subscribes to webhooks |
| `POST` | `/api/facebook-pages/{id}/subscribe` | Admin | Re-subscribes a Page to webhooks |
| `GET` | `/api/facebook-pages/{id}/subscription-status` | Admin | Checks webhook subscription status |
| `DELETE` | `/api/facebook-pages/{id}` | Admin | Unlinks a Page and removes webhook subscription |
| `GET` | `/api/portal/pages/:id/subscription-status` | Tenant | Checks webhook subscription for tenant's Page |
| `POST` | `/webhook` | System | Receives incoming webhook events from Meta |

### How to Test

**As Admin:**
1. Login to the admin dashboard at `https://wa.savana.ly`
2. Navigate to **Facebook Page Manager** → link a Page → webhooks auto-subscribe
3. Check the **webhook status indicator** on the Page card
4. Comment on a Page post → webhook fires → comment appears in dashboard
5. Use **⟳ re-subscribe button** to refresh, or unlink to remove subscription

**As Tenant:**
1. Login to the tenant portal
2. Navigate to **صفحات فيسبوك** (Facebook Pages)
3. Click **"فحص الاشتراك"** (Check Subscription) on a Page card
4. Verify the webhook subscription shows as active

### Meta Review Description (Arabic)

> بصفتنا مزوّد خدمة تقنية، نستخدم هذا الإذن للاشتراك في webhooks لصفحات فيسبوك الخاصة بعملائنا لتلقي إشعارات فورية عند ورود تعليقات أو رسائل جديدة. يقوم المدير بإدارة اشتراكات Webhook ويمكن لكل مستأجر التحقق من حالة اشتراك صفحته عبر بوابته الخاصة.

### Meta Review Description (English)

> As a Tech Service Provider, we use this permission to subscribe to Facebook Page webhooks for our clients' Pages to receive real-time notifications for comments and messages. The manager handles webhook subscriptions, and each tenant can verify their Page's subscription status through their own portal.


## 3. `pages_utility_messages`

**Purpose**: Allows the app to access Page utility message templates and send utility messages via Messenger using `MESSAGE_TAG` — enabling messages **outside the 24-hour messaging window**.

### How We Use It

| Role | Use Case | Description |
|------|----------|-------------|
| **Admin (Manager)** | Send utility messages | The manager sends tagged messages (`POST_PURCHASE_UPDATE`, `ACCOUNT_UPDATE`, etc.) via the admin inbox outside the 24h window |
| **Admin (Manager)** | HUMAN_AGENT fallback | Admin Unified Inbox and auto-responder automatically fallback to `HUMAN_AGENT` tag when `RESPONSE` fails |
| **Admin (Manager)** | Automated DMs | Auto-responder sends private DMs via `POST /{comment-id}/private_replies` to Page commenters |
| **Tenant** | Send utility messages | Tenants send tagged messages from their portal via `POST /api/portal/fb-messenger/:linkedPageId/conversations/:convId/utility-message` |
| **Tenant** | HUMAN_AGENT fallback | Tenant portal Messenger send auto-fallbacks to `HUMAN_AGENT` when outside 24h window |
| **Tenant** | List available tags | Tenants view available tags via `GET /api/portal/fb-messenger/message-tags` |

### Where It's Used

#### Backend

| File | Role | API Call | Description |
|------|------|----------|-------------|
| [fbMessenger.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/fbMessenger.js) | Admin | `POST /{page-id}/messages` | Dedicated utility message endpoint with `MESSAGE_TAG` |
| [fbMessenger.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/fbMessenger.js) | Admin | `GET /message-tags` | Returns available tags with Arabic labels |
| [autoResponder.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/services/autoResponder.js) | System | `POST /{page-id}/messages` | Auto-responder RESPONSE → HUMAN_AGENT fallback |
| [unified.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/unified.js) | Admin | `POST /{page-id}/messages` | Unified Inbox with HUMAN_AGENT fallback |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `POST /{page-id}/messages` | Tenant send with HUMAN_AGENT fallback |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `POST /{page-id}/messages` | Tenant dedicated utility message endpoint |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `GET /message-tags` | Tenant available tags list |

#### Frontend

| File | Role | Description |
|------|------|-------------|
| [UnifiedChatWindow.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/components/Inbox/UnifiedChatWindow.jsx) | Admin | Messenger chat message display and reply input |
| [TenantInbox.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/TenantPortal/TenantInbox.jsx) | Tenant | Messenger chat with utility message dialog |

#### API Endpoints

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| `POST` | `/api/fb-messenger/{pageId}/conversations/{convId}/utility-message` | Admin | Send utility message with MESSAGE_TAG |
| `GET`  | `/api/fb-messenger/message-tags` | Admin | List available message tags |
| `POST` | `/api/fb-messenger/{pageId}/conversations/{convId}/send` | Admin | Send message (RESPONSE + HUMAN_AGENT fallback) |
| `POST` | `/api/unified/conversations/{channel}/{id}/send` | Admin | Unified Inbox send with fallback |
| `POST` | `/api/portal/fb-messenger/:linkedPageId/conversations/:convId/utility-message` | Tenant | Send utility message with MESSAGE_TAG |
| `GET`  | `/api/portal/fb-messenger/message-tags` | Tenant | List available message tags |
| `POST` | `/api/portal/unified/:channel/:id/send` | Tenant | Tenant send with HUMAN_AGENT fallback |

### Supported Message Tags

| Tag | Use Case | Arabic Label |
|-----|----------|--------------|
| `CONFIRMED_EVENT_UPDATE` | Event reminders and updates | تحديث موعد / فعالية مؤكدة |
| `POST_PURCHASE_UPDATE` | Order status, shipping, receipts | تحديث ما بعد الشراء |
| `ACCOUNT_UPDATE` | Account changes, payment issues | تحديث الحساب |
| `HUMAN_AGENT` | Human agent response (7-day window) | رد وكيل بشري |

### How to Test

**As Admin:**
1. Login to the admin dashboard → **Unified Inbox** → select Messenger conversation
2. Send a reply → tries `RESPONSE`, auto-fallbacks to `HUMAN_AGENT` if outside 24h
3. Test utility message: `POST /api/fb-messenger/{pageId}/conversations/{convId}/utility-message` with `{ "message": "تم شحن طلبك!", "tag": "POST_PURCHASE_UPDATE" }`

**As Tenant:**
1. Login to the tenant portal → **صندوق الوارد** (Inbox) → select Messenger conversation
2. Send a reply → auto-fallback to `HUMAN_AGENT` if outside 24h
3. Click **"رسالة مُعلَّمة"** (Tagged Message) → select tag → send utility message
4. View available tags via `GET /api/portal/fb-messenger/message-tags`

### Meta Review Description (Arabic)

> بصفتنا مزوّد خدمة تقنية، نستخدم هذا الإذن لإرسال رسائل المساعدة المُعلَّمة (MESSAGE_TAG) عبر Messenger نيابة عن صفحات عملائنا خارج نافذة الـ 24 ساعة. يستخدم كل من المدير والمستأجر هذه الميزة: المدير عبر لوحة التحكم المركزية والمستأجر عبر بوابته الخاصة، وتشمل تحديثات الطلبات والحساب والمواعيد وردود الوكلاء البشريين.

### Meta Review Description (English)

> As a Tech Service Provider, we use this permission to send tagged utility messages (MESSAGE_TAG) via Messenger on behalf of our clients' Pages outside the 24-hour window. Both the manager and each tenant use this feature: the manager via the central dashboard and tenants via their own portal, for order updates, account notifications, event reminders, and human agent responses.


## 4. `pages_messaging`

**Purpose**: Allows the app to manage and access Page conversations in Messenger.

### How We Use It

| Role | Use Case | Description |
|------|----------|-------------|
| **Admin (Manager)** | Receive messages | Webhooks deliver incoming Messenger messages to the server for all tenant Pages |
| **Admin (Manager)** | Display inbox | Admin Unified Inbox shows all Messenger conversations across all tenants |
| **Admin (Manager)** | Send replies | Admin replies to customer messages via `POST /{page-id}/messages` from the Unified Inbox |
| **Admin (Manager)** | Auto-respond | Automation rules auto-reply to incoming Messenger messages (keyword, welcome, away) |
| **Tenant** | Display inbox | Tenant Unified Inbox shows Messenger conversations scoped to their own Pages only |
| **Tenant** | Send replies | Tenant replies to customers from their portal via `POST /api/portal/unified/:channel/:id/send` |
| **Tenant** | Sync history | Tenant syncs Messenger conversation history via `POST /api/portal/unified/messenger/sync` |
| **Tenant** | Fetch profiles | User names and profile pictures are displayed in the tenant inbox |

### Where It's Used

#### Backend

| File | Role | API Call | Description |
|------|------|----------|-------------|
| [webhooks.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/webhooks.js) | System | Receives `entry.messaging[]` | Processes incoming Messenger messages, creates conversations, stores messages |
| [fbMessenger.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/fbMessenger.js) | Admin | `POST /{page-id}/messages` | Sends a reply in a Messenger conversation |
| [fbMessenger.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/fbMessenger.js) | Admin | DB query | Lists conversations, messages for a linked Page |
| [autoResponder.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/services/autoResponder.js) | System | `POST /{page-id}/messages` | Auto-responds to incoming Messenger messages |
| [unified.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/unified.js) | Admin | DB query + Send API | Admin Unified Inbox (WhatsApp + Messenger combined) |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | DB query | Tenant-scoped Messenger conversation listing |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `POST /{page-id}/messages` | Tenant sends Messenger replies |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `GET /{page-id}/conversations` | Tenant syncs Messenger history from Meta |

#### Frontend

| File | Role | Description |
|------|------|-------------|
| [UnifiedInbox.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/Inbox/UnifiedInbox.jsx) | Admin | Main inbox combining WhatsApp and Messenger |
| [UnifiedChatWindow.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/components/Inbox/UnifiedChatWindow.jsx) | Admin | Message history and reply composer |
| [TenantInbox.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/TenantPortal/TenantInbox.jsx) | Tenant | Tenant's Unified Inbox with Messenger support |

#### API Endpoints

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| `GET` | `/api/fb-messenger/{pageId}/conversations` | Admin | List Messenger conversations |
| `POST` | `/api/fb-messenger/{pageId}/conversations/{convId}/send` | Admin | Send a Messenger reply |
| `POST` | `/api/fb-messenger/{pageId}/sync` | Admin | Sync conversation history |
| `GET` | `/api/unified/conversations` | Admin | List all conversations (WA + Messenger) |
| `POST` | `/api/unified/conversations/{channel}/{id}/send` | Admin | Send via either channel |
| `GET` | `/api/portal/unified/conversations` | Tenant | Tenant-scoped conversations (WA + Messenger) |
| `GET` | `/api/portal/unified/:channel/:id/messages` | Tenant | Tenant-scoped message history |
| `POST` | `/api/portal/unified/:channel/:id/send` | Tenant | Tenant sends via either channel |
| `POST` | `/api/portal/unified/messenger/sync` | Tenant | Tenant syncs Messenger history |

### How to Test

**As Admin:**
1. Login to admin dashboard → **Unified Inbox**
2. Customer sends a Messenger message → appears in real-time
3. Click conversation → view history → send reply
4. Test auto-reply: create automation rule → customer sends keyword → bot auto-replies

**As Tenant:**
1. Login to tenant portal → **صندوق الوارد** (Inbox)
2. Filter by Messenger channel → view conversations scoped to tenant's Pages
3. Click conversation → view messages → send reply
4. Click **"مزامنة"** (Sync) to pull Messenger history from Meta

### Meta Review Description (Arabic)

> بصفتنا مزوّد خدمة تقنية نُدير منصة متعددة المستأجرين، نستخدم هذا الإذن لإدارة محادثات Messenger الخاصة بصفحات عملائنا. يعرض المدير جميع المحادثات عبر صندوق الوارد الموحد، بينما يتمكن كل مستأجر من عرض محادثات صفحاته والرد عليها ومزامنة السجل عبر بوابته الخاصة.

### Meta Review Description (English)

> As a Tech Service Provider operating a multi-tenant platform, we use this permission to manage Messenger conversations for our clients' Pages. The manager views all conversations via the Unified Inbox, while each tenant can view their Pages' conversations, send replies, and sync history through their own portal.


## 5. `business_management`

**Purpose**: Allows the app to read and write via the Business Manager API.

### How We Use It

| Role | Use Case | Description |
|------|----------|-------------|
| **Admin (Manager)** | View business info | Fetches business details via `GET /{business-id}` to display name, verification status, and profile |
| **Admin (Manager)** | List business assets | Fetches owned Pages and WABAs via `GET /{business-id}/owned_pages` and `owned_whatsapp_business_accounts` |
| **Admin (Manager)** | Manage ad accounts | Lists and claims ad accounts for business asset management |
| **Admin (Manager)** | Partner solutions | Manages client businesses via the Partner Solutions API for tenant onboarding |
| **Tenant** | *Indirect benefit* | Tenants are onboarded via this permission — their Pages and WABAs are linked through Business Manager |

> **Note**: This permission is used exclusively by the admin (manager). Tenants do not directly interact with Business Manager APIs but benefit from the onboarding and asset linking it enables.

### Where It's Used

#### Backend

| File | Role | API Call | Description |
|------|------|----------|-------------|
| [businessManager.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/businessManager.js) | Admin | `GET /{business-id}` | Fetches business profile information |
| [businessManager.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/businessManager.js) | Admin | `GET /{business-id}/owned_ad_accounts` | Lists ad accounts owned by the business |
| [businessManager.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/businessManager.js) | Admin | `GET /{business-id}/owned_pages` | Lists Pages owned by the business |
| [businessManager.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/businessManager.js) | Admin | `GET /{business-id}/owned_whatsapp_business_accounts` | Lists WABAs owned by the business |
| [partnerSolutions.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/partnerSolutions.js) | Admin | Partner client management | Manages client businesses for tenant onboarding |

#### Frontend

| File | Role | Description |
|------|------|-------------|
| [BusinessManager.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/Settings/BusinessManager.jsx) | Admin | Displays business info, ad accounts, Pages, and WABAs |
| [PartnerSolutions.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/Settings/PartnerSolutions.jsx) | Admin | Manages partner client businesses |

#### API Endpoints

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| `GET` | `/api/business-manager/{businessId}` | Admin | Gets business profile info |
| `GET` | `/api/business-manager/{businessId}/ad-accounts` | Admin | Lists owned ad accounts |
| `GET` | `/api/business-manager/{businessId}/assets` | Admin | Lists all business assets |
| `GET` | `/api/business-manager/{businessId}/whatsapp-accounts` | Admin | Lists WABAs |

### How to Test

**As Admin:**
1. Login to admin dashboard → **Settings → Business Manager**
2. Enter **Business ID** → click **Search**
3. View business name, verification status, owned Pages, WABAs, ad accounts
4. Click **Claim Ad Account** to associate an external account

### Meta Review Description (Arabic)

> بصفتنا مزوّد خدمة تقنية، نستخدم هذا الإذن لعرض وإدارة أصول الأنشطة التجارية لعملائنا بما في ذلك الصفحات وحسابات واتساب للأعمال والحسابات الإعلانية. يستخدم المدير هذا الإذن لتسجيل المستأجرين الجدد وربط أصولهم بالمنصة.

### Meta Review Description (English)

> As a Tech Service Provider, we use this permission to view and manage our clients' business assets including Pages, WhatsApp Business Accounts, and Ad Accounts. The manager uses this permission to onboard new tenants and link their assets to the platform.


## 6. `pages_read_engagement`

**Purpose**: Allows the app to read Page content (posts, photos, videos), follower data (names, PSIDs, profile pictures), and Page metadata/insights.

### How We Use It

| Role | Use Case | Description |
|------|----------|-------------|
| **Admin (Manager)** | List Page posts | Fetches posts via `GET /{page-id}/posts` for the Page Manager |
| **Admin (Manager)** | Read comments | Fetches comments via `GET /{post-id}/comments` for moderation |
| **Admin (Manager)** | Page insights | Fetches follower counts, engagement stats for the insights dashboard |
| **Admin (Manager)** | User profiles | Fetches `name,profile_pic` for Messenger sender display |
| **Tenant** | List Page posts | Tenant views their Page's posts via `GET /api/portal/fb-content/:linkedPageId/posts` |
| **Tenant** | Read comments | Tenant reads comments on their posts via `GET /api/portal/fb-content/:linkedPageId/posts/:postId/comments` |
| **Tenant** | Page insights | Tenant views their Page analytics via `GET /api/portal/fb-insights/:linkedPageId/overview` |

### Where It's Used

#### Backend

| File | Role | API Call | Description |
|------|------|----------|-------------|
| [fbContent.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/fbContent.js) | Admin | `GET /{page-id}/posts` | Fetches Page posts for the Page Manager |
| [fbContent.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/fbContent.js) | Admin | `GET /{post-id}/comments` | Fetches comments with commenter profiles |
| [fbInsights.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/fbInsights.js) | Admin | `GET /{page-id}?fields=followers_count,...` | Fetches Page overview data |
| [fbInsights.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/fbInsights.js) | Admin | `GET /{page-id}/posts` | Fetches posts with engagement metrics |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `GET /{page-id}/posts` | Tenant fetches their Page posts |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `GET /{post-id}/comments` | Tenant fetches comments on their posts |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `GET /{page-id}?fields=...` | Tenant fetches Page insights overview |
| [webhooks.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/webhooks.js) | System | `GET /{user-psid}?fields=name,profile_pic` | Fetches Messenger user profile for conversations |

#### Frontend

| File | Role | Description |
|------|------|-------------|
| [FacebookPageManager.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/Facebook/FacebookPageManager.jsx) | Admin | Displays Page posts and comments with engagement data |
| [TenantContentManager.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/TenantPortal/TenantContentManager.jsx) | Tenant | Tenant views their Page posts and comments |
| [TenantFbInsights.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/TenantPortal/TenantFbInsights.jsx) | Tenant | Tenant views Page analytics (KPIs, daily metrics, post performance) |

#### API Endpoints

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| `GET` | `/api/fb-content/{pageId}/posts` | Admin | Lists Page posts |
| `GET` | `/api/fb-content/{pageId}/posts/{postId}/comments` | Admin | Lists comments on a post |
| `GET` | `/api/fb-insights/{pageId}/overview` | Admin | Page follower/engagement stats |
| `GET` | `/api/fb-insights/{pageId}/posts` | Admin | Posts with performance metrics |
| `GET` | `/api/portal/fb-content/:linkedPageId/posts` | Tenant | Tenant's Page posts |
| `GET` | `/api/portal/fb-content/:linkedPageId/posts/:postId/comments` | Tenant | Comments on tenant's post |
| `GET` | `/api/portal/fb-insights/:linkedPageId/overview` | Tenant | Tenant's Page overview stats |
| `GET` | `/api/portal/fb-insights/:linkedPageId/daily` | Tenant | Tenant's daily metrics |
| `GET` | `/api/portal/fb-insights/:linkedPageId/posts` | Tenant | Tenant's post performance |

### How to Test

**As Admin:**
1. Login to admin dashboard → **Facebook Page Manager** → select a Page
2. Posts load with message, image, date → click a post → comments load with commenter profiles
3. Navigate to **Facebook Insights** → Page overview shows follower count and engagement

**As Tenant:**
1. Login to tenant portal → **إدارة المحتوى** (Content Manager)
2. Select a linked Page → view posts feed → click post → view comments
3. Navigate to **تحليلات فيسبوك** (Facebook Insights) → view KPIs, daily metrics, post performance

### Meta Review Description (Arabic)

> بصفتنا مزوّد خدمة تقنية، نستخدم هذا الإذن لقراءة منشورات صفحات عملائنا وتعليقات المستخدمين وإحصائيات الصفحة. يعرض المدير بيانات جميع الصفحات من لوحة التحكم المركزية، بينما يتمكن كل مستأجر من عرض منشورات وتعليقات وتحليلات صفحته عبر بوابته الخاصة.

### Meta Review Description (English)

> As a Tech Service Provider, we use this permission to read our clients' Page posts, user comments, and Page statistics. The manager views all Pages' data from the central dashboard, while each tenant can view their own Page's posts, comments, and analytics through their portal.


## 7. `pages_manage_engagement`

**Purpose**: Allows the app to create, edit, and delete comments on the Page, and create/delete likes on Page content.

### How We Use It

| Role | Use Case | Description |
|------|----------|-------------|
| **Admin (Manager)** | Reply to comments | Posts public replies via `POST /{comment-id}/comments` — manually from the Page Manager |
| **Admin (Manager)** | Auto-reply & auto-like | Automation rules reply to and like comments automatically |
| **Admin (Manager)** | Hide/delete comments | Hides or deletes inappropriate comments for moderation |
| **Tenant** | Reply to comments | Tenant replies to comments on their posts via `POST /api/portal/fb-content/:linkedPageId/comments/:commentId/reply` |
| **Tenant** | Hide/delete comments | Tenant hides or deletes comments on their own posts for moderation |

### Where It's Used

#### Backend

| File | Role | API Call | Description |
|------|------|----------|-------------|
| [fbContent.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/fbContent.js) | Admin | `POST /{comment-id}/comments` | Admin manually replies to a comment |
| [fbContent.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/fbContent.js) | Admin | `POST /{comment-id}` (is_hidden) | Hides/unhides a comment |
| [fbContent.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/fbContent.js) | Admin | `DELETE /{comment-id}` | Deletes a comment |
| [autoResponder.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/services/autoResponder.js) | System | `POST /{comment-id}/comments` | Auto-responder posts a public reply |
| [autoResponder.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/services/autoResponder.js) | System | `POST /{comment-id}/likes` | Auto-likes a comment when `auto_like` is enabled |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `POST /{comment-id}/comments` | Tenant replies to a comment |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `POST /{comment-id}` (is_hidden) | Tenant hides/unhides a comment |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `DELETE /{comment-id}` | Tenant deletes a comment |

#### Frontend

| File | Role | Description |
|------|------|-------------|
| [FacebookPageManager.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/Facebook/FacebookPageManager.jsx) | Admin | Reply, hide, delete buttons for comments + auto-like toggle |
| [AutomationManager.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/Automation/AutomationManager.jsx) | Admin | Auto-like toggle and reaction selector in automation rules |
| [TenantContentManager.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/TenantPortal/TenantContentManager.jsx) | Tenant | Tenant reply, hide, delete buttons for comments on their posts |

#### API Endpoints

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| `POST` | `/api/fb-content/{pageId}/comments/{commentId}/reply` | Admin | Reply to a comment |
| `POST` | `/api/fb-content/{pageId}/comments/{commentId}/hide` | Admin | Hide/unhide a comment |
| `DELETE` | `/api/fb-content/{pageId}/comments/{commentId}` | Admin | Delete a comment |
| `POST` | `/api/portal/fb-content/:linkedPageId/comments/:commentId/reply` | Tenant | Tenant replies to a comment |
| `POST` | `/api/portal/fb-content/:linkedPageId/comments/:commentId/hide` | Tenant | Tenant hides/unhides a comment |
| `DELETE` | `/api/portal/fb-content/:linkedPageId/comments/:commentId` | Tenant | Tenant deletes a comment |

### How to Test

**As Admin:**
1. Login to admin dashboard → **Facebook Page Manager** → select post → view comments
2. Reply to a comment → click reply icon → type message → Send
3. Hide a comment → click hide icon → comment is hidden from public
4. Test auto-like: create `comment_reply` rule with Auto-Like → user comments → bot replies and likes

**As Tenant:**
1. Login to tenant portal → **إدارة المحتوى** (Content Manager) → select post → view comments
2. Reply to a comment → type message → Send
3. Hide or delete inappropriate comments from the comments panel

### Meta Review Description (Arabic)

> بصفتنا مزوّد خدمة تقنية، نستخدم هذا الإذن لإدارة التعليقات على منشورات صفحات عملائنا. يمكن للمدير الرد والإخفاء والحذف من لوحة التحكم المركزية مع دعم الردود التلقائية والإعجاب التلقائي، بينما يتمكن كل مستأجر من الرد على تعليقات صفحته وإخفائها وحذفها عبر بوابته الخاصة.

### Meta Review Description (English)

> As a Tech Service Provider, we use this permission to manage comments on our clients' Page posts. The manager can reply, hide, and delete from the central dashboard with automation support for auto-reply and auto-like, while each tenant can reply to, hide, and delete comments on their own Page through their portal.


## 8. `pages_manage_posts`

**Purpose**: Allows the app to create, edit, and delete Page posts.

### How We Use It

| Role | Use Case | Description |
|------|----------|-------------|
| **Admin (Manager)** | Create posts | Publishes text/link posts via `POST /{page-id}/feed` and photo posts via `POST /{page-id}/photos` |
| **Admin (Manager)** | Schedule posts | Creates unpublished posts with `scheduled_publish_time` for future publishing |
| **Admin (Manager)** | Edit/delete posts | Updates or removes posts from the Page Manager |
| **Tenant** | Create posts | Tenant publishes text, link, and photo posts on their Page via `/api/portal/fb-content/:linkedPageId/posts` |
| **Tenant** | Schedule posts | Tenant schedules posts for future publishing |
| **Tenant** | Edit/delete posts | Tenant edits or removes their own posts |

### Where It's Used

#### Backend

| File | Role | API Call | Description |
|------|------|----------|-------------|
| [fbContent.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/fbContent.js) | Admin | `POST /{page-id}/feed` | Creates a text/link post |
| [fbContent.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/fbContent.js) | Admin | `POST /{page-id}/photos` | Creates a photo post |
| [fbContent.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/fbContent.js) | Admin | `POST /{post-id}` | Edits a post |
| [fbContent.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/fbContent.js) | Admin | `DELETE /{post-id}` | Deletes a post |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `POST /{page-id}/feed` | Tenant creates a text/link post |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `POST /{page-id}/photos` | Tenant creates a photo post |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `POST /{post-id}` | Tenant edits a post |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `DELETE /{post-id}` | Tenant deletes a post |

#### Frontend

| File | Role | Description |
|------|------|-------------|
| [FacebookPageManager.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/Facebook/FacebookPageManager.jsx) | Admin | Create, edit, delete posts with text, photos, and scheduling |
| [TenantContentManager.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/TenantPortal/TenantContentManager.jsx) | Tenant | Post composer (text/photo/link/schedule), posts feed, edit/delete |

#### API Endpoints

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| `POST` | `/api/fb-content/{pageId}/posts` | Admin | Creates a text/link post |
| `POST` | `/api/fb-content/{pageId}/posts/photo` | Admin | Creates a photo post |
| `PUT` | `/api/fb-content/{pageId}/posts/{postId}` | Admin | Edits a post |
| `DELETE` | `/api/fb-content/{pageId}/posts/{postId}` | Admin | Deletes a post |
| `POST` | `/api/portal/fb-content/:linkedPageId/posts` | Tenant | Tenant creates a text/link post |
| `POST` | `/api/portal/fb-content/:linkedPageId/posts/photo` | Tenant | Tenant creates a photo post |
| `PUT` | `/api/portal/fb-content/:linkedPageId/posts/:postId` | Tenant | Tenant edits a post |
| `DELETE` | `/api/portal/fb-content/:linkedPageId/posts/:postId` | Tenant | Tenant deletes a post |

### How to Test

**As Admin:**
1. Login to admin dashboard → **Facebook Page Manager** → select a Page
2. Create a post → type message → Publish → calls `POST /{page-id}/feed`
3. Create a photo post → upload image → Publish
4. Schedule a post → toggle schedule → set date/time → publish
5. Edit/delete existing posts from the posts list

**As Tenant:**
1. Login to tenant portal → **إدارة المحتوى** (Content Manager)
2. Select a linked Page → click **"منشور جديد"** (New Post)
3. Choose post type (text/photo/link) → compose → publish or schedule
4. Edit or delete existing posts from the posts feed

### Meta Review Description (Arabic)

> بصفتنا مزوّد خدمة تقنية، نستخدم هذا الإذن لإنشاء وتعديل وحذف وجدولة منشورات على صفحات عملائنا. يدير المدير محتوى جميع الصفحات من لوحة التحكم المركزية، بينما يتمكن كل مستأجر من نشر وتعديل وحذف منشوراته عبر بوابته الخاصة.

### Meta Review Description (English)

> As a Tech Service Provider, we use this permission to create, edit, delete, and schedule posts on our clients' Pages. The manager manages all Page content from the central dashboard, while each tenant can publish, edit, and delete their own posts through their portal.


## 9. `pages_read_user_content`

**Purpose**: Allows the app to read user-generated content on the Page (posts, comments, ratings), delete user comments, and read posts where the Page is tagged.

### How We Use It

| Role | Use Case | Description |
|------|----------|-------------|
| **Admin (Manager)** | Read user comments | Reads comments via `GET /{post-id}/comments` for display and automation keyword matching |
| **Admin (Manager)** | Process for automation | Webhook delivers comment text → auto-responder matches keywords → triggers auto-replies/DMs |
| **Admin (Manager)** | Moderate content | Reads and deletes inappropriate user comments |
| **Tenant** | Read user comments | Tenant reads comments on their posts via `/api/portal/fb-content/:linkedPageId/posts/:postId/comments` |
| **Tenant** | Moderate content | Tenant hides or deletes inappropriate comments on their own posts |

### Where It's Used

#### Backend

| File | Role | API Call | Description |
|------|------|----------|-------------|
| [fbContent.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/fbContent.js) | Admin | `GET /{post-id}/comments` | Reads user comments with commenter info |
| [fbContent.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/fbContent.js) | Admin | `DELETE /{comment-id}` | Deletes a user's comment |
| [webhooks.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/webhooks.js) | System | Receives `entry.changes` | Processes incoming user comments for automation |
| [autoResponder.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/services/autoResponder.js) | System | Keyword matching | Reads comment text to match automation keywords |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `GET /{post-id}/comments` | Tenant reads comments on their posts |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `DELETE /{comment-id}` | Tenant deletes a comment |

#### Frontend

| File | Role | Description |
|------|------|-------------|
| [FacebookPageManager.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/Facebook/FacebookPageManager.jsx) | Admin | Displays user comments with moderation controls |
| [TenantContentManager.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/TenantPortal/TenantContentManager.jsx) | Tenant | Tenant views and moderates comments on their posts |

#### API Endpoints

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| `GET` | `/api/fb-content/{pageId}/posts/{postId}/comments` | Admin | Lists user comments |
| `DELETE` | `/api/fb-content/{pageId}/comments/{commentId}` | Admin | Deletes a user comment |
| `GET` | `/api/portal/fb-content/:linkedPageId/posts/:postId/comments` | Tenant | Tenant lists comments |
| `DELETE` | `/api/portal/fb-content/:linkedPageId/comments/:commentId` | Tenant | Tenant deletes a comment |

### How to Test

**As Admin:**
1. Login to admin dashboard → **Facebook Page Manager** → select post
2. View user comments with name, profile picture, like count
3. Delete inappropriate comment → confirm → comment removed
4. Test automation: user comments a keyword → auto-responder matches and triggers reply

**As Tenant:**
1. Login to tenant portal → **إدارة المحتوى** (Content Manager) → select post
2. View user comments → moderate by hiding or deleting

### Meta Review Description (Arabic)

> بصفتنا مزوّد خدمة تقنية، نستخدم هذا الإذن لقراءة تعليقات المستخدمين على منشورات صفحات عملائنا لعرضها وإدارتها. يقرأ المدير التعليقات لتطبيق قواعد الأتمتة وإدارة المحتوى، بينما يتمكن كل مستأجر من عرض وإدارة تعليقات صفحته عبر بوابته الخاصة.

### Meta Review Description (English)

> As a Tech Service Provider, we use this permission to read user comments on our clients' Page posts for display and moderation. The manager reads comments for automation processing and content management, while each tenant can view and moderate comments on their own Page through their portal.


## 10. `whatsapp_business_messaging`

**Purpose**: Allows the app to send WhatsApp messages, upload/retrieve media, manage business profile info, and register phone numbers with Meta.

### How We Use It

| Role | Use Case | Description |
|------|----------|-------------|
| **Admin (Manager)** | Send messages | Sends WhatsApp messages via Unified Inbox on behalf of tenants |
| **Admin (Manager)** | Bulk broadcasts | Sends template-based broadcasts to up to 500 recipients |
| **Admin (Manager)** | Auto-respond | Automation rules auto-reply based on keywords |
| **Admin (Manager)** | Business profile | Reads and updates WhatsApp business profile for tenants |
| **Tenant** | Send messages | Tenant sends text, template, image, document messages from their inbox |
| **Tenant** | Bulk broadcasts | Tenant sends broadcasts to their contacts |
| **Tenant** | Download media | Tenant downloads incoming media attachments |
| **Tenant** | Business profile | Tenant views and updates their WhatsApp business profile |
| **System** | Receive messages | Webhooks deliver incoming WhatsApp messages for all tenants |

### Where It's Used

#### Backend

| File | Role | API Call | Description |
|------|------|----------|-------------|
| [messages.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/messages.js) | Admin | `POST /{phone-number-id}/messages` | Sends text messages with 24h window enforcement |
| [messages.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/messages.js) | Admin | `POST /{phone-number-id}/media` | Uploads media files |
| [webhooks.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/webhooks.js) | System | Receives `POST /webhook` | Processes incoming WhatsApp messages and statuses |
| [autoResponder.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/services/autoResponder.js) | System | `POST /{phone-number-id}/messages` | Auto-responds based on keyword rules |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `POST /{phone-number-id}/messages` | Tenant sends text, template, image, document messages |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `POST /broadcast` | Tenant sends bulk broadcasts |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `GET /{media-id}` | Tenant downloads media |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `GET/POST business_profile` | Tenant reads/updates business profile |

#### Frontend

| File | Role | Description |
|------|------|-------------|
| [UnifiedInbox.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/Inbox/UnifiedInbox.jsx) | Admin | Send/receive WhatsApp messages, view media |
| [AutomationManager.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/Automation/AutomationManager.jsx) | Admin | Configure keyword-based auto-reply rules |
| [TenantInbox.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/TenantPortal/TenantInbox.jsx) | Tenant | Tenant's WhatsApp inbox with send, media, templates |

#### API Endpoints

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| `POST` | `/api/messages/send` | Admin | Sends a WhatsApp message |
| `POST` | `/api/messages/broadcast` | Admin | Sends bulk broadcast |
| `GET` | `/api/business-profile/:phoneNumberId` | Admin | Gets WhatsApp business profile |
| `POST` | `/api/portal/messages/send` | Tenant | Tenant sends WhatsApp message |
| `POST` | `/api/portal/messages/send-image` | Tenant | Tenant sends image message |
| `POST` | `/api/portal/messages/send-document` | Tenant | Tenant sends document |
| `POST` | `/api/portal/broadcast` | Tenant | Tenant sends broadcast |
| `GET` | `/api/portal/media/:mediaId/download` | Tenant | Tenant downloads media |
| `GET` | `/api/portal/business-profile` | Tenant | Tenant reads business profile |
| `PUT` | `/api/portal/business-profile` | Tenant | Tenant updates business profile |

### How to Test

**As Admin:**
1. Login to admin dashboard → **Unified Inbox** → send WhatsApp message
2. Receive a customer message → appears in real-time
3. Send a template → broadcast to recipients
4. Upload media → send image/document

**As Tenant:**
1. Login to tenant portal → **صندوق الوارد** (Inbox) → select WhatsApp conversation
2. Send text, image, document, or template messages
3. Navigate to **بث جماعي** (Broadcast) → select contacts → send template
4. Navigate to **ملف النشاط التجاري** (Business Profile) → view/edit

### Meta Review Description (Arabic)

> بصفتنا مزوّد خدمة تقنية، نستخدم هذا الإذن لإرسال واستقبال رسائل واتساب نيابة عن حسابات عملائنا. يستخدم المدير صندوق الوارد الموحد لإدارة جميع المحادثات، بينما يتمكن كل مستأجر من إرسال الرسائل والوسائط والبث الجماعي وإدارة ملف نشاطه التجاري عبر بوابته الخاصة.

### Meta Review Description (English)

> As a Tech Service Provider, we use this permission to send and receive WhatsApp messages on behalf of our clients' accounts. The manager uses the Unified Inbox to manage all conversations, while each tenant can send messages, media, broadcasts, and manage their business profile through their own portal.


## 11. `whatsapp_business_management`

**Purpose**: Allows the app to read/manage WhatsApp Business assets including accounts, phone numbers, message templates, QR codes, and webhook subscriptions.

### How We Use It

| Role | Use Case | Description |
|------|----------|-------------|
| **Admin (Manager)** | List/create templates | Manages message templates via `GET/POST /{waba-id}/message_templates` |
| **Admin (Manager)** | List phone numbers | Fetches registered numbers via `GET /{waba-id}/phone_numbers` |
| **Admin (Manager)** | Manage QR codes | Creates and lists QR codes for customer engagement |
| **Admin (Manager)** | View analytics | Fetches conversation/messaging analytics |
| **Admin (Manager)** | Webhook subscriptions | Subscribes WABAs to webhooks |
| **Admin (Manager)** | Token monitoring | Monitors access token health |
| **Tenant** | List templates | Tenant views approved templates for broadcasts and messaging |
| **Tenant** | Manage QR codes | Tenant creates and lists QR codes for their phone number |
| **Tenant** | View analytics | Tenant views their conversation and messaging analytics |

### Where It's Used

#### Backend

| File | Role | API Call | Description |
|------|------|----------|-------------|
| [tenants.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenants.js) | Admin | `GET /{waba-id}/message_templates` | Lists message templates |
| [tenants.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenants.js) | Admin | `POST /{waba-id}/message_templates` | Creates a template |
| [tenants.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenants.js) | Admin | `POST /{waba-id}/subscribed_apps` | Subscribes WABA to webhooks |
| [phoneNumbers.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/phoneNumbers.js) | Admin | `GET /{waba-id}/phone_numbers` | Lists registered phone numbers |
| [qrCodes.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/qrCodes.js) | Admin | `GET/POST /{phone-number-id}/message_qrdls` | Lists/creates QR codes |
| [analytics.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/analytics.js) | Admin | `GET /{waba-id}/analytics` | Fetches analytics |
| [tokenMonitor.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/services/tokenMonitor.js) | System | `GET /debug_token` | Monitors token health |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `GET /{waba-id}/message_templates` | Tenant lists templates |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `GET/POST /{phone-number-id}/message_qrdls` | Tenant manages QR codes |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | Local DB query | Tenant views analytics summary |

#### Frontend

| File | Role | Description |
|------|------|-------------|
| [AutomationManager.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/Automation/AutomationManager.jsx) | Admin | Template selection for auto-reply rules |
| [BusinessManager.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/Settings/BusinessManager.jsx) | Admin | Displays WABAs and phone numbers |
| [TenantInbox.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/TenantPortal/TenantInbox.jsx) | Tenant | Template picker for tenant messaging |

#### API Endpoints

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| `GET` | `/api/tenants/{id}/templates` | Admin | Lists message templates |
| `POST` | `/api/tenants/{id}/templates` | Admin | Creates a template |
| `GET` | `/api/phone-numbers/:wabaId` | Admin | Lists phone numbers |
| `GET` | `/api/qr-codes/:phoneNumberId` | Admin | Lists QR codes |
| `POST` | `/api/qr-codes/:phoneNumberId` | Admin | Creates a QR code |
| `GET` | `/api/analytics/conversations/:wabaId` | Admin | Conversation analytics |
| `GET` | `/api/portal/templates` | Tenant | Tenant lists templates |
| `GET` | `/api/portal/qr-codes` | Tenant | Tenant lists QR codes |
| `POST` | `/api/portal/qr-codes` | Tenant | Tenant creates QR code |
| `GET` | `/api/portal/analytics/summary` | Tenant | Tenant analytics summary |

### How to Test

**As Admin:**
1. Login to admin dashboard → tenant management → view/create templates
2. Navigate to Settings → phone numbers with quality rating
3. Navigate to QR Codes → create/list → scan to start conversation
4. Navigate to Analytics → conversation and messaging stats

**As Tenant:**
1. Login to tenant portal → **القوالب** (Templates) → view approved templates
2. Navigate to **رموز QR** (QR Codes) → create/list
3. Navigate to **التحليلات** (Analytics) → view conversation stats

### Meta Review Description (Arabic)

> بصفتنا مزوّد خدمة تقنية، نستخدم هذا الإذن لإدارة أصول واتساب للأعمال لعملائنا. يدير المدير القوالب وأرقام الهواتف والاشتراكات، بينما يتمكن كل مستأجر من عرض قوالبه وإنشاء رموز QR ومتابعة تحليلات حسابه عبر بوابته الخاصة.

### Meta Review Description (English)

> As a Tech Service Provider, we use this permission to manage our clients' WhatsApp Business assets including templates, phone numbers, QR codes, and webhooks. The manager handles configuration, while each tenant can view templates, create QR codes, and monitor analytics through their own portal.


## 12. `manage_app_solution`

**Purpose**: Allows the app to manage partner solutions between tech providers and solution partners — listing managed apps and making API calls on their behalf.

### How We Use It

| Role | Use Case | Description |
|------|----------|-------------|
| **Admin (Manager)** | List managed clients | Fetches managed businesses via `GET /{business-id}/owned_businesses` |
| **Admin (Manager)** | Onboard new clients | Creates/links client businesses for tenant onboarding |
| **Admin (Manager)** | Remove clients | Removes managed clients |
| **Admin (Manager)** | Client WABA accounts | Fetches client WABAs for asset linking |
| **Admin (Manager)** | Create system users | Creates system users for clients for API access |
| **Tenant** | *Indirect benefit* | Tenants are onboarded and their assets are managed through this permission |

> **Note**: This permission is used exclusively by the admin (manager) for tenant onboarding and asset management.

### Where It's Used

#### Backend

| File | Role | API Call | Description |
|------|------|----------|-------------|
| [partnerSolutions.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/partnerSolutions.js) | Admin | `GET /{business-id}/owned_businesses` | Lists managed client businesses |
| [partnerSolutions.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/partnerSolutions.js) | Admin | `POST /{business-id}/managed_businesses` | Onboards a client |
| [partnerSolutions.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/partnerSolutions.js) | Admin | `DELETE /{business-id}/managed_businesses` | Removes a client |
| [partnerSolutions.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/partnerSolutions.js) | Admin | `POST /{client-business-id}/system_users` | Creates a system user |

#### Frontend

| File | Role | Description |
|------|------|-------------|
| [PartnerSolutions.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/Settings/PartnerSolutions.jsx) | Admin | Manages partner clients with search, add, remove |

#### API Endpoints

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| `GET` | `/api/partner/clients` | Admin | Lists managed clients |
| `POST` | `/api/partner/clients` | Admin | Onboards a new client |
| `DELETE` | `/api/partner/clients/{id}` | Admin | Removes a client |
| `GET` | `/api/partner/clients/{id}/waba` | Admin | Gets client's WABAs |

### How to Test

**As Admin:**
1. Login to admin dashboard → **Settings → Partner Solutions**
2. Enter Business ID → Search → managed clients listed
3. Add a client → enter name/ID → click Add
4. View client WABA → click client → see WhatsApp accounts
5. Remove a client → click remove → confirm

### Meta Review Description (Arabic)

> بصفتنا شركة سافانا - مزوّد خدمة تقنية (TSP)، نستخدم هذا الإذن لإدارة حلول الشركاء وتسجيل المستأجرين الجدد وربط حسابات واتساب الخاصة بهم من منصتنا المركزية. يستخدم المدير هذا الإذن حصرياً لإدارة عملية التسجيل والأصول التقنية.

### Meta Review Description (English)

> As Savana Company — a Tech Service Provider (TSP), we use this permission to manage partner solutions, onboard tenants, and link their WhatsApp accounts from our centralized platform. This permission is used exclusively by the manager for onboarding and technical asset management.


## 13. `email`

**Purpose**: Allows the app to read the primary email address of a person's Facebook profile. Auto-granted for all apps.

### How We Use It

| Role | Use Case | Description |
|------|----------|-------------|
| **Admin (Manager)** | Facebook Login | The email is included in the OAuth scope when the admin authenticates via Facebook Login |
| **Admin (Manager)** | User identification | Identifies the admin user during authentication and token exchange |

> **Note**: This is an admin-only permission used during the Facebook Login OAuth flow. Tenants authenticate via the platform's own auth system and do not use Facebook Login.

### Where It's Used

This permission is part of the **Facebook Login OAuth flow**. It is not called via Graph API endpoints directly.

#### Related Backend

| File | Role | Description |
|------|------|-------------|
| [facebookPages.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/facebookPages.js) | Admin | Receives Page Access Token from OAuth flow |
| [auth.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/auth.js) | Admin | Authenticates users into the platform |

### How to Test

**As Admin:**
1. Admin connects Facebook account via Login → OAuth requests `email` scope
2. Verify: `GET /api/facebook-pages/webhook-diagnostic` → `token_scopes` includes `"email"`

### Meta Review Description (Arabic)

> بصفتنا مزوّد خدمة تقنية، يُستخدم إذن البريد الإلكتروني كجزء من تسجيل دخول المدير عبر فيسبوك لإنشاء رمز الوصول المستخدم لإدارة أصول عملائنا. المستأجرون يسجلون الدخول عبر نظام المنصة الخاص ولا يستخدمون تسجيل دخول فيسبوك.

### Meta Review Description (English)

> As a Tech Service Provider, the email permission is used during the manager's Facebook Login to generate the access token for managing our clients' assets. Tenants authenticate via the platform's own system and do not use Facebook Login.


## 14. `whatsapp_business_manage_events`

**Purpose**: Allows the app to register events (Purchase, AddToCart, Lead, etc.) on behalf of a WhatsApp Business Account for ad targeting, optimization, and reporting.

### How We Use It

| Role | Use Case | Description |
|------|----------|-------------|
| **Admin (Manager)** | Send conversion events | Sends events (Purchase, Lead, etc.) via `POST /{dataset-id}/events` from the admin dashboard |
| **Admin (Manager)** | Dataset management | Fetches datasets from `GET /{waba-id}/dataset` for correct WABA association |
| **Admin (Manager)** | Track event history | Views send/fail statistics for all tenants |
| **Tenant** | Log conversion events | Tenant logs events from their portal via `POST /api/portal/conversions/log-event` |
| **Tenant** | View event history | Tenant views their conversion event history and stats |
| **System** | External API | `POST /api/v1/events` allows e-commerce systems to send events via API key |

### Where It's Used

#### Backend

| File | Role | API Call | Description |
|------|------|----------|-------------|
| [conversions.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/conversions.js) | Admin | `POST /{dataset-id}/events` | Sends batch events with `lead_id` attribution |
| [conversions.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/conversions.js) | Admin | `GET /{waba-id}/dataset` | Lists datasets linked to a WABA |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | `POST /{dataset-id}/events` | Tenant-scoped event logging |
| [v1.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/api/v1.js) | System | `POST /{dataset-id}/events` | Public API for external systems |

#### Event Data Format

```json
{
  "event_name": "Purchase",
  "event_time": 1713536400,
  "action_source": "business_messaging",
  "messaging_channel": "whatsapp",
  "data_processing_options": [],
  "user_data": {
    "phones": ["sha256_hashed_phone"],
    "lead_id": "wamid.xxx"
  },
  "custom_data": { "value": 99.99, "currency": "LYD" }
}
```

#### Supported Event Types

| Event | Description |
|-------|-------------|
| `Purchase` | Customer completed a purchase |
| `AddToCart` | Customer added item to cart |
| `Lead` | Lead form submitted |
| `CompleteRegistration` | Customer completed registration |
| `ViewContent` | Customer viewed content |
| `InitiateCheckout` | Customer started checkout |
| `Subscribe` | Customer subscribed |
| `Contact` | Customer initiated contact |

#### API Endpoints

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| `GET` | `/api/conversions/datasets/{wabaId}` | Admin | Lists datasets |
| `POST` | `/api/conversions/events/{datasetId}` | Admin | Sends batch events |
| `GET` | `/api/conversions/events/history` | Admin | Event history |
| `POST` | `/api/portal/conversions/log-event` | Tenant | Tenant logs event |
| `GET` | `/api/portal/conversions/history` | Tenant | Tenant event history |
| `POST` | `/api/v1/events` | System | Public API for external tracking |

### How to Test

**As Admin:**
1. Login to admin dashboard → **Settings → Conversions**
2. Select dataset → choose event type → fill data → Send
3. View event history with send/fail stats

**As Tenant:**
1. Login to tenant portal → **التحويلات** (Conversions)
2. Log a conversion event → fill phone, value, currency → Send
3. View event history and statistics

### Meta Review Description (Arabic)

> بصفتنا مزوّد خدمة تقنية، نستخدم هذا الإذن لتسجيل أحداث التحويل على حسابات واتساب عملائنا. يرسل المدير الأحداث من لوحة التحكم المركزية، بينما يتمكن كل مستأجر من تسجيل أحداثه ومتابعة إحصائياته عبر بوابته الخاصة أو عبر API خارجي.

### Meta Review Description (English)

> As a Tech Service Provider, we use this permission to log conversion events on our clients' WhatsApp Business Accounts. The manager sends events from the central dashboard, while each tenant can log events and view stats through their portal or via an external API.


## 15. `public_profile`

**Purpose**: Allows the app to read default public profile fields (name, profile picture, etc.) on the User node. Auto-granted for all apps.

### How We Use It

| Role | Use Case | Description |
|------|----------|-------------|
| **Admin (Manager)** | Authentication | Read during Facebook Login to authenticate the admin and create their session |
| **Admin (Manager)** | Personalization | Admin's name and profile picture personalize the dashboard |

> **Note**: This is an admin-only permission, auto-granted. Tenants authenticate via the platform's own auth system.

### Where It's Used

This permission is part of the **Facebook Login OAuth flow** and is automatically included.

#### Related Backend

| File | Role | Description |
|------|------|-------------|
| [auth.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/auth.js) | Admin | Authenticates users and manages sessions |
| [facebookPages.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/facebookPages.js) | Admin | Uses authenticated user context for Page management |

### How to Test

**As Admin:**
1. Admin authenticates via Facebook Login → `public_profile` auto-requested
2. Verify: `GET /api/facebook-pages/webhook-diagnostic` → `token_scopes` includes `"public_profile"`

### Meta Review Description (Arabic)

> بصفتنا مزوّد خدمة تقنية، يُستخدم إذن الملف الشخصي العام لمصادقة المدير عبر فيسبوك. المستأجرون يسجلون الدخول عبر نظام المنصة الخاص ولا يستخدمون تسجيل دخول فيسبوك.

### Meta Review Description (English)

> As a Tech Service Provider, the public_profile permission is used to authenticate the manager via Facebook Login. Tenants use the platform's own authentication system.

---

## 16. `Business Asset User Profile Access` (Feature)

**Purpose**: Allows the app to read user fields (id, ids_for_business, name, picture) for users who interact with business assets like Pages and WhatsApp accounts.

### How We Use It

| Role | Use Case | Description |
|------|----------|-------------|
| **Admin (Manager)** | Fetch user profiles | Calls `GET /{user-psid}?fields=name,profile_pic` to get Messenger user info |
| **Admin (Manager)** | Display in inbox | User names and avatars shown in admin Unified Inbox |
| **Admin (Manager)** | Identify commenters | Reads commenter name/ID from webhook `from` field |
| **Tenant** | Display in inbox | User names and profile pictures shown in tenant inbox conversations |
| **Tenant** | Comment profiles | Commenter profiles displayed in tenant Content Manager |
| **System** | Auto-responder context | Reads user identity for personalized auto-replies |

### Where It's Used

#### Backend

| File | Role | API Call | Description |
|------|------|----------|-------------|
| [webhooks.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/webhooks.js) | System | `GET /{user-psid}?fields=name,profile_pic` | Fetches user name and picture for new conversations |
| [webhooks.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/webhooks.js) | System | Reads `entry.changes[].value.from` | Extracts commenter info from feed webhooks |
| [autoResponder.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/services/autoResponder.js) | System | DB lookup by `user_psid` | Identifies users for conversation matching |
| [tenantPortal.js](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/server/routes/tenantPortal.js) | Tenant | Reads conversation participants | Extracts user identity from Messenger sync |

#### Frontend

| File | Role | Description |
|------|------|-------------|
| [UnifiedSidebar.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/components/Inbox/UnifiedSidebar.jsx) | Admin | User names and profile pictures in conversation list |
| [UnifiedChatWindow.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/components/Inbox/UnifiedChatWindow.jsx) | Admin | Sender name and avatar on message bubbles |
| [FacebookPageManager.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/Facebook/FacebookPageManager.jsx) | Admin | Commenter names and profile pictures |
| [TenantInbox.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/TenantPortal/TenantInbox.jsx) | Tenant | User names and avatars in tenant inbox |
| [TenantContentManager.jsx](file:///Users/savana/Dev/Savana/WhatsAppMessageController/WhatsAppPlatform/client/src/pages/TenantPortal/TenantContentManager.jsx) | Tenant | Commenter profiles in tenant content manager |

#### Database Fields

| Table | Column | Description |
|-------|--------|-------------|
| `fb_conversations` | `user_psid` | Page-scoped user ID |
| `fb_conversations` | `user_name` | User's display name |
| `fb_conversations` | `user_profile_pic` | User's profile picture URL |

### How to Test

**As Admin:**
1. Login to admin dashboard → customer sends Messenger message for first time
2. Webhook fires → user name and profile picture appear in Unified Inbox
3. Page Manager → comments show commenter names and pictures

**As Tenant:**
1. Login to tenant portal → **صندوق الوارد** (Inbox) → Messenger conversations show user names/avatars
2. **إدارة المحتوى** (Content Manager) → comments show commenter profiles

### Meta Review Description (Arabic)

> بصفتنا مزوّد خدمة تقنية، نستخدم هذه الميزة لقراءة بيانات المستخدمين الذين يتفاعلون مع صفحات عملائنا. يعرض المدير هذه البيانات في صندوق الوارد الموحد، ويتمكن كل مستأجر من رؤية أسماء وصور عملائه في بوابته الخاصة لتحسين خدمة العملاء.

### Meta Review Description (English)

> As a Tech Service Provider, we use this feature to read user data (name, profile picture) for users who interact with our clients' Pages. The manager views this data in the Unified Inbox, and each tenant sees their customers' names and avatars in their own portal for improved customer service.
