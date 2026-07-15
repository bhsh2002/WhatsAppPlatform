import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(testDir, '../..');
const read = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
const collectJsxFiles = (directory) => fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return collectJsxFiles(entryPath);
        return entry.name.endsWith('.jsx') ? [entryPath] : [];
    });
const collectOpeningTags = (source, tagName) => {
    const tags = [];
    const prefix = `<${tagName}`;
    let cursor = 0;
    while ((cursor = source.indexOf(prefix, cursor)) !== -1) {
        const boundary = source[cursor + prefix.length];
        if (boundary && !/[\s>]/.test(boundary)) {
            cursor += prefix.length;
            continue;
        }
        let braceDepth = 0;
        let quote = null;
        let escaped = false;
        let end = cursor + prefix.length;
        for (; end < source.length; end += 1) {
            const char = source[end];
            if (quote) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === quote) quote = null;
                continue;
            }
            if (char === '"' || char === "'" || char === '`') quote = char;
            else if (char === '{') braceDepth += 1;
            else if (char === '}') braceDepth -= 1;
            else if (char === '>' && braceDepth === 0) break;
        }
        tags.push(source.slice(cursor, end + 1));
        cursor = end + 1;
    }
    return tags;
};

test('browser API defaults to same-origin and Vite strips the public /api prefix', () => {
    const apiClient = read('client/src/api/index.js');
    const viteConfig = read('client/vite.config.js');

    assert.match(apiClient, /VITE_API_URL\s*\|\|\s*''/);
    assert.doesNotMatch(apiClient, /localhost:3031/);
    assert.match(viteConfig, /['"]\/api['"]\s*:/);
    assert.match(viteConfig, /replace\(\/\^\\\/api\//);
});

test('browser API composes domain modules without changing its singleton facade', () => {
    const apiIndex = read('client/src/api/index.js');
    const domainFiles = [
        'portalCore',
        'metaAdmin',
        'operations',
        'tenantFacebook',
        'tenantMeta',
    ];
    const sources = [apiIndex];

    for (const domain of domainFiles) {
        assert.match(apiIndex, new RegExp(`from ['"]\\./${domain}['"]`));
        sources.push(read(`client/src/api/${domain}.js`));
    }

    assert.match(apiIndex, /Object\.assign\(\s*ApiService\.prototype,/);
    assert.match(apiIndex, /const api = new ApiService\(\);\s*export default api;/);
    assert.ok(apiIndex.split('\n').length < 400, 'transport facade should stay compact');
    assert.doesNotMatch(apiIndex, /async getPortalDashboard\(/);

    const methodNames = sources.flatMap((source) => (
        [...source.matchAll(/^ {4}(?:async )?([A-Za-z_$][A-Za-z0-9_$]*)\([^)]*\)\s*\{/gm)]
            .map((match) => match[1])
    ));
    assert.ok(methodNames.length >= 290, 'expected the existing API surface to remain available');
    assert.equal(new Set(methodNames).size, methodNames.length, 'API methods must not collide across modules');
});

test('Messenger bot router remains a compact composition facade over domain routers', () => {
    const messengerBot = read('server/routes/messengerBot.js');

    assert.match(messengerBot, /createMessengerBotSummaryRouter\(\{ database \}\)/);
    assert.match(messengerBot, /createMessengerBotProductsRouter\(\{ database, \.\.\.products \}\)/);
    assert.match(messengerBot, /createMessengerBotFlowsRouter\(\{ database, \.\.\.flows \}\)/);
    assert.match(messengerBot, /createMessengerBotSessionsRouter\(\{ database \}\)/);
    assert.doesNotMatch(messengerBot, /router\.(get|post|put|patch|delete)\(/);
    assert.ok(messengerBot.split('\n').length < 50, 'Messenger bot facade should stay compact');
});

test('admin message sends, media, queries, broadcasts, contacts and read receipts remain isolated domain routers', () => {
    const messages = read('server/routes/messages.js');
    const sends = read('server/routes/messageSends.js');
    const media = read('server/routes/messageMedia.js');
    const conversationWindow = read('server/services/whatsappConversationWindow.js');
    const sendValidation = read('server/services/whatsappMessageValidation.js');
    const queries = read('server/routes/messageQueries.js');
    const broadcasts = read('server/routes/messageBroadcasts.js');
    const processor = read('server/services/broadcastProcessor.js');
    const contacts = read('server/routes/messageContacts.js');
    const receipts = read('server/routes/messageReadReceipts.js');

    assert.match(messages, /router\.use\(createMessageSendsRouter\(\)\)/);
    assert.match(messages, /router\.use\(createMessageMediaRouter\(\)\)/);
    assert.match(messages, /router\.use\(createMessageQueriesRouter\(\)\)/);
    assert.match(messages, /router\.use\(createMessageBroadcastsRouter\(\)\)/);
    assert.match(messages, /router\.use\(createMessageContactsRouter\(\)\)/);
    assert.match(messages, /router\.use\(createMessageReadReceiptsRouter\(\)\)/);
    assert.doesNotMatch(messages, /router\.(get|post|put|patch|delete)\(/);
    assert.ok(messages.split('\n').length < 50, 'admin messages facade should stay compact');
    assert.match(sends, /credentialResolver\(\{[\s\S]*tenantId: requestedTenantId,/);
    assert.match(sends, /encodeURIComponent\(context\.phoneNumberId\)/);
    assert.match(sends, /getWhatsAppConversationWindow\([\s\S]*context\.tenantId,[\s\S]*input\.recipient/);
    assert.doesNotMatch(sends, /console\.log\([^\n]*(payload|Sending)/);
    assert.match(media, /normalizeWhatsAppMediaUrl\(body\.mediaUrl\)/);
    assert.match(media, /isAllowedMetaMediaUrl\(urlData\.url\)/);
    assert.match(media, /getWhatsAppConversationWindow\([\s\S]*context\.tenantId,[\s\S]*recipient/);
    assert.match(media, /encodeURIComponent\(context\.phoneNumberId\)/);
    assert.doesNotMatch(media, /console\.log\([^\n]*(payload|Sending)/);
    assert.match(sendValidation, /interactive lists support at most 10 rows/);
    assert.match(sendValidation, /countTemplateBodyVariables/);
    assert.match(conversationWindow, /elapsed >= 0 && elapsed <= WHATSAPP_CONVERSATION_WINDOW_MS/);
    assert.match(queries, /enrichTemplateFallbackMessages\(messages, contentField, database\)/);
    assert.match(queries, /unread\.tenant_id IS latest\.tenant_id/);
    assert.doesNotMatch(queries, /SELECT \* FROM (messages|webhook_logs|contacts|tenants)/);
    assert.match(broadcasts, /createBroadcastProcessor\(/);
    assert.match(broadcasts, /credentialResolver\(\{[\s\S]*tenantId,/);
    assert.match(processor, /WHERE id = \? AND tenant_id IS \?/);
    assert.match(contacts, /normalizeContactCreate\(req\.body\)/);
    assert.match(contacts, /normalizeAdminContactUpdate\(req\.body\)/);
    assert.match(contacts, /credentialResolver\(\{ tenantId \}\)/);
    assert.doesNotMatch(contacts, /credentialResolver\(tenantId\)/);
    assert.match(contacts, /encodeURIComponent\(credentials\.phoneNumberId\)/);
    assert.match(receipts, /encodeURIComponent\(phoneNumberId\)/);
});

test('API v1 composes validated tenant-scoped messaging, query and event routers', () => {
    const apiV1 = read('server/routes/api/v1.js');
    const messaging = read('server/routes/api/v1Messaging.js');
    const queries = read('server/routes/api/v1Queries.js');
    const events = read('server/routes/api/v1Events.js');

    assert.match(apiV1, /router\.use\(createApiV1MessagingRouter\(\{ database: db, callbackSender: sendCallback \}\)\)/);
    assert.match(apiV1, /router\.use\(createApiV1QueriesRouter\(\{ database: db \}\)\)/);
    assert.match(apiV1, /router\.use\(createApiV1EventsRouter\(\{ database: db \}\)\)/);
    assert.doesNotMatch(apiV1, /router\.(get|post)\('\/(?:messages|conversations|templates|events)/);
    assert.ok(apiV1.split('\n').length < 80, 'API v1 facade should stay compact');
    assert.match(messaging, /normalizeWhatsAppRecipient/);
    assert.match(messaging, /normalizeWhatsAppMediaUrl/);
    assert.match(messaging, /normalizeInteractiveInput/);
    assert.match(messaging, /countTemplateBodyVariables/);
    assert.match(messaging, /getWhatsAppConversationWindow/);
    assert.match(messaging, /mediaMessageTypeForMime/);
    assert.match(messaging, /encodeURIComponent\(context\.phoneNumberId\)/);
    assert.match(messaging, /billingSettled = true;[\s\S]*settleBilling/);
    assert.doesNotMatch(messaging, /SELECT \* FROM (tenants|templates)/);
    assert.doesNotMatch(messaging, /console\.log\([^\n]*(payload|Sending)/);
    assert.match(queries, /contact\.tenant_id = latest\.tenant_id/);
    assert.match(queries, /normalizeWhatsAppRecipient\(req\.params\.phone\)/);
    assert.doesNotMatch(queries, /SELECT \* FROM (messages|templates|contacts)/);
    assert.match(events, /MAX_EVENTS_PER_REQUEST = 100/);
    assert.match(events, /encodeURIComponent\(context\.datasetId\)/);
    assert.match(events, /billingSettled = true/);
    assert.match(events, /sanitizeStoredMetaResponse\(event\.meta_response/);
    assert.doesNotMatch(events, /SELECT \* FROM (tenants|conversion_events|contacts)/);
});

test('server CI enforces a whole-source coverage floor', () => {
    const serverPackage = JSON.parse(read('server/package.json'));
    const workflow = read('.github/workflows/ci.yml');
    const coverage = serverPackage.scripts['test:coverage'];

    assert.match(coverage, /c8 --all/);
    for (const sourceArea of ['routes', 'services', 'middleware', 'db']) {
        assert.match(coverage, new RegExp(`--include '${sourceArea}/\\*\\*/\\*\\.js'`));
    }
    assert.match(coverage, /--check-coverage/);
    assert.match(coverage, /--statements 51/);
    assert.match(coverage, /--branches 66/);
    assert.match(coverage, /--functions 71/);
    assert.match(coverage, /--lines 51/);
    assert.match(workflow, /Run server tests with coverage gate[\s\S]*npm run test:coverage/);
});

test('admin and tenant automation share the same safe match options and presentation', () => {
    const adminPage = read('client/src/pages/Automation/AutomationManager.jsx');
    const tenantPage = read('client/src/pages/TenantPortal/TenantAutomation.jsx');
    const config = read('client/src/pages/Automation/automationConfig.js');
    const presentation = read('client/src/pages/Automation/AutomationPresentation.jsx');

    assert.match(adminPage, /from ['"]\.\/automationConfig['"]/);
    assert.match(tenantPage, /from ['"]\.\.\/Automation\/automationConfig['"]/);
    assert.match(adminPage, /from ['"]\.\/AutomationPresentation['"]/);
    assert.match(tenantPage, /from ['"]\.\.\/Automation\/AutomationPresentation['"]/);
    assert.match(config, /value:\s*['"]exact['"]/);
    assert.match(config, /value:\s*['"]contains['"]/);
    assert.doesNotMatch(config, /value:\s*['"]regex['"]/);
    assert.doesNotMatch(adminPage, /const getMATCH_TYPES/);
    assert.doesNotMatch(tenantPage, /const getMATCH_TYPES/);
    assert.match(presentation, /export const AutomationChannelChip/);
    assert.match(presentation, /export const AutomationRuleTypeIcon/);
});

test('Facebook comment DMs use the Page Send API and likes cannot mask reply failures', () => {
    const autoResponder = read('server/services/autoResponder.js');
    const privateReplies = read('server/services/facebookPrivateReplies.js');

    assert.match(privateReplies, /recipient:\s*\{ comment_id: normalizedCommentId \}/);
    assert.match(privateReplies, /encodeURIComponent\(normalizedPageId\)\}\/messages/);
    assert.doesNotMatch(privateReplies, /\/private_replies/);
    assert.match(autoResponder, /return publicSent \|\| dmSent;/);
    assert.doesNotMatch(autoResponder, /return publicSent \|\| dmSent \|\| !!rule\.auto_like/);
});

test('admin and tenant template pages share Meta payload and status behavior', () => {
    const adminPage = read('client/src/pages/Templates/AdminTemplates.jsx');
    const tenantPage = read('client/src/pages/TenantPortal/TenantTemplates.jsx');
    const config = read('client/src/pages/Templates/templateConfig.js');
    const presentation = read('client/src/pages/Templates/TemplatePresentation.jsx');

    assert.match(adminPage, /from ['"]\.\/templateConfig['"]/);
    assert.match(tenantPage, /from ['"]\.\.\/Templates\/templateConfig['"]/);
    assert.match(adminPage, /from ['"]\.\/TemplatePresentation['"]/);
    assert.match(tenantPage, /from ['"]\.\.\/Templates\/TemplatePresentation['"]/);
    assert.doesNotMatch(adminPage, /const buildMetaComponents/);
    assert.doesNotMatch(tenantPage, /const buildMetaComponents/);
    assert.doesNotMatch(adminPage, /const getStatusChip/);
    assert.doesNotMatch(tenantPage, /const getStatusChip/);
    assert.match(config, /export const buildMetaTemplateComponents/);
    assert.match(config, /body_text:\s*\[bodyVars\.map/);
    assert.match(presentation, /String\(status \|\| ['"]draft['"]\)\.toLowerCase\(\)/);
    assert.match(presentation, /export const TemplateQualityChip/);
});

test('admin and tenant contact pages share table, CTWA, labels, and deletion presentation', () => {
    const adminPage = read('client/src/pages/Contacts/ContactManager.jsx');
    const tenantPage = read('client/src/pages/TenantPortal/TenantContacts.jsx');
    const config = read('client/src/pages/Contacts/contactConfig.js');
    const presentation = read('client/src/pages/Contacts/ContactPresentation.jsx');

    assert.match(adminPage, /from ['"]\.\/ContactPresentation['"]/);
    assert.match(tenantPage, /from ['"]\.\.\/Contacts\/ContactPresentation['"]/);
    assert.match(adminPage, /<ContactTable[\s\S]*showTenant=\{true\}/);
    assert.match(tenantPage, /<ContactTable[\s\S]*showTenant=\{false\}/);
    assert.doesNotMatch(adminPage, /const getLabelChip/);
    assert.doesNotMatch(tenantPage, /const getLabelChip/);
    assert.match(config, /export const getContactLabelOptions/);
    assert.match(presentation, /export const ContactIdentitySummary/);
    assert.match(presentation, /export const ContactDeleteDialog/);
    assert.match(presentation, /export const ContactTable/);
});

test('admin and tenant broadcast pages share recipient selection and normalization with explicit limits', () => {
    const adminPage = read('client/src/pages/Broadcast/BroadcastManager.jsx');
    const tenantPage = read('client/src/pages/TenantPortal/TenantBroadcast.jsx');
    const config = read('client/src/pages/Broadcast/broadcastConfig.js');
    const recipientsStep = read('client/src/pages/Broadcast/BroadcastRecipientsStep.jsx');

    assert.match(adminPage, /from ['"]\.\/BroadcastRecipientsStep['"]/);
    assert.match(tenantPage, /from ['"]\.\.\/Broadcast\/BroadcastRecipientsStep['"]/);
    assert.match(adminPage, /<BroadcastRecipientsStep[\s\S]*maxRecipients=\{500\}/);
    assert.match(tenantPage, /<BroadcastRecipientsStep[\s\S]*maxRecipients=\{100\}/);
    assert.doesNotMatch(adminPage, /const getCONTACT_FIELDS/);
    assert.doesNotMatch(tenantPage, /const getCONTACT_FIELDS/);
    assert.doesNotMatch(adminPage, /recipientsTab === 0/);
    assert.doesNotMatch(tenantPage, /recipientsTab === 0/);
    assert.match(config, /export const buildBroadcastRecipients/);
    assert.match(config, /recipient\.length >= 8/);
    assert.match(recipientsStep, /uniqueRecipients\.length > maxRecipients/);
    assert.match(recipientsStep, /availableCredits < uniqueRecipients\.length/);
});

test('admin and tenant Facebook content pages share composer and post presentation', () => {
    const adminPage = read('client/src/pages/Facebook/FacebookPageManager.jsx');
    const tenantPage = read('client/src/pages/TenantPortal/TenantContentManager.jsx');
    const config = read('client/src/pages/Facebook/facebookContentConfig.js');
    const presentation = read('client/src/pages/Facebook/FacebookContentPresentation.jsx');

    assert.match(adminPage, /from ['"]\.\/FacebookContentPresentation['"]/);
    assert.match(tenantPage, /from ['"]\.\.\/Facebook\/FacebookContentPresentation['"]/);
    assert.doesNotMatch(adminPage, /const POST_TABS/);
    assert.doesNotMatch(tenantPage, /const POST_TABS/);
    assert.match(adminPage, /<FacebookPostComposerTabs/);
    assert.match(tenantPage, /<FacebookPostComposerTabs/);
    assert.match(adminPage, /<FacebookPostMessage/);
    assert.match(tenantPage, /<FacebookPostMessage/);
    assert.match(config, /FACEBOOK_POST_TRUNCATE_LENGTH = 200/);
    assert.match(presentation, /export const FacebookDeleteDialog/);
    assert.match(presentation, /export const FacebookContentSnackbar/);
});

test('production Nginx proxies /api to Express and supports SSE', () => {
    const nginx = read('client/nginx.conf');

    assert.match(nginx, /location \/api\//);
    assert.match(nginx, /proxy_pass http:\/\/server:3031\//);
    assert.match(nginx, /proxy_buffering off/);
    assert.match(nginx, /proxy_read_timeout 1h/);
});

test('Docker runs the backend in production mode and waits for health', () => {
    const compose = read('docker-compose.yml');
    const localCompose = read('docker-compose.local.yml');
    const dockerfile = read('server/Dockerfile');
    const clientDockerfile = read('client/Dockerfile');
    const ci = read('.github/workflows/ci.yml');

    assert.match(compose, /NODE_ENV:\s*production/);
    assert.match(compose, /condition:\s*service_healthy/);
    assert.match(compose, /healthcheck:/);
    assert.match(compose, /DATABASE_PATH:\s*\/app\/data\/platform\.db/);
    assert.match(compose, /\.\/server\/db:\/app\/data/);
    assert.doesNotMatch(compose, /\.\/server\/db:\/app\/db/);
    assert.match(compose, /\.\/server\/\.env:\/app\/\.env:ro/);
    assert.equal((compose.match(/read_only:\s*true/g) || []).length, 2);
    assert.equal((compose.match(/no-new-privileges:true/g) || []).length, 2);
    assert.equal((compose.match(/cap_drop:/g) || []).length, 2);
    assert.match(dockerfile, /ENV NODE_ENV=production/);
    assert.match(dockerfile, /npm ci --omit=dev/);
    assert.match(dockerfile, /USER node/);
    assert.match(dockerfile, /mkdir -p \/app\/data \/app\/uploads/);
    assert.match(dockerfile, /^FROM node:20@sha256:[a-f0-9]{64}/m);
    assert.match(clientDockerfile, /^FROM node:20-alpine@sha256:[a-f0-9]{64} AS build/m);
    assert.match(clientDockerfile, /^FROM nginx:alpine@sha256:[a-f0-9]{64}/m);
    assert.match(clientDockerfile, /USER nginx/);
    assert.match(clientDockerfile, /EXPOSE 8080/);
    assert.match(clientDockerfile, /sed -i '\/\^user \/d' \/etc\/nginx\/nginx\.conf/);
    assert.match(clientDockerfile, /10-listen-on-ipv6-by-default\.sh/);
    assert.match(compose, /3133:8080/);
    assert.match(localCompose, /NODE_ENV:\s*development/);
    assert.match(localCompose, /DISABLE_BACKGROUND_JOBS:\s*"true"/);
    assert.match(localCompose, /CORS_ORIGINS:\s*http:\/\/localhost:3133,http:\/\/127\.0\.0\.1:3133/);
    assert.match(read('client/nginx.conf'), /listen 8080/);
    assert.match(read('client/nginx.conf'), /listen \[::\]:8080/);
    assert.match(ci, /docker build --tag whatsapp-platform-server:ci server/);
    assert.match(ci, /docker build --tag whatsapp-platform-client:ci client/);
    assert.doesNotMatch(dockerfile, /RUN npm install/);
});

test('literal Meta template delete routes are registered before dynamic template ids', () => {
    const tenantTemplates = read('server/routes/tenantTemplates.js');
    const tenants = read('server/routes/tenants.js');

    assert.ok(
        tenantTemplates.indexOf("router.delete('/templates/delete-meta'")
            < tenantTemplates.indexOf("router.delete('/templates/:id'")
    );
    assert.ok(
        tenants.indexOf("router.delete('/:id/templates/delete-meta'")
            < tenants.indexOf("router.delete('/:id/templates/:templateId'")
    );
});

test('browser auth uses HttpOnly cookies while logout and password rotation remain server-side', () => {
    const authContext = read('client/src/context/AuthContext.jsx');
    const apiClient = read('client/src/api/index.js');
    const authRoute = read('server/routes/auth.js');
    const server = read('server/server.js');

    assert.match(apiClient, /async logout\(\)/);
    assert.match(apiClient, /['"]\/api\/auth\/logout['"]/);
    assert.match(apiClient, /credentials:\s*['"]include['"]/);
    assert.match(apiClient, /takeLegacyAuthToken\(\)/);
    assert.match(apiClient, /['"]\/api\/auth\/me['"][\s\S]*suppressErrorStatuses:\s*\[401, 403\]/);
    assert.match(authContext, /api\.logout\(\)/);
    assert.match(authContext, /api\.adoptLegacySession\(legacyToken\)/);
    const unauthenticatedBranch = authContext.indexOf('if (err.status === 401 || err.status === 403)');
    const otherFailureBranch = authContext.indexOf('} else {', unauthenticatedBranch);
    const sessionErrorLog = authContext.indexOf("console.error('Session verification failed:'");
    assert.ok(unauthenticatedBranch !== -1 && otherFailureBranch !== -1);
    assert.ok(sessionErrorLog > otherFailureBranch);
    assert.doesNotMatch(authContext, /localStorage\.setItem\(['"]auth_token/);
    assert.doesNotMatch(authContext, /api\.setAuthToken/);
    assert.doesNotMatch(apiClient, /this\.authToken/);
    assert.match(authRoute, /setSessionCookie\(res, token\)/);
    assert.match(authRoute, /clearSessionCookie\(res\)/);
    assert.match(server, /createOriginGuard\(\{ allowedOrigins: CORS_ORIGINS \}\)/);
});

test('admin tenant CRUD encrypts access tokens and presents redacted tenants', () => {
    const tenantsRoute = read('server/routes/tenants.js');

    assert.match(tenantsRoute, /INSERT INTO tenants[\s\S]*access_token_encrypted/);
    assert.match(tenantsRoute, /setClauses\.push\('access_token_encrypted = \?', 'access_token = NULL'\)/);
    assert.match(tenantsRoute, /presentTenants\(tenants\)/);
    assert.match(tenantsRoute, /presentTenant\(updatedTenant\)/);
});

test('tenant API credentials are stored as digests or ciphertext and revealed once', () => {
    const tenantPortal = read('server/routes/tenantPortal.js');
    const tenantApiSettings = read('server/routes/tenantApiSettings.js');
    const apiKeyAuth = read('server/middleware/apiKeyAuth.js');
    const apiSettingsPage = read('client/src/pages/TenantPortal/TenantApiSettings.jsx');

    assert.match(tenantPortal, /router\.use\('\/settings\/api', tenantApiSettingsRouter\)/);
    assert.doesNotMatch(tenantPortal, /router\.(get|post|put)\('\/settings\/api/);
    assert.match(tenantApiSettings, /api_key, api_key_hash, webhook_secret/);
    assert.match(tenantApiSettings, /api_key = NULL/);
    assert.match(tenantApiSettings, /ON CONFLICT\(tenant_id\) DO NOTHING/);
    assert.match(tenantApiSettings, /webhook_secret = \?/);
    assert.match(tenantApiSettings, /normalizeIsActive\(is_active, settings\.is_active\)/);
    assert.match(apiKeyAuth, /WHERE api_key_hash = \? AND is_active = 1/);
    assert.match(apiSettingsPage, /regeneratePortalWebhookSecret\(\)/);
    assert.doesNotMatch(apiSettingsPage, /fetchSettings\(\);\s*\n\s*} catch \(err\) \{\s*\n\s*console\.error\('Failed to regenerate key/);
});

test('all tenant portal mounts apply the centralized tenant policy', () => {
    const server = read('server/server.js');
    const portal = read('server/routes/tenantPortal.js');
    const tenantAutomation = read('server/routes/tenantAutomation.js');
    const tenantBilling = read('server/routes/tenantBilling.js');
    const tenantContacts = read('server/routes/tenantContacts.js');
    const tenantDashboard = read('server/routes/tenantDashboard.js');
    const tenantProfile = read('server/routes/tenantProfile.js');
    const tenantAnalytics = read('server/routes/tenantAnalytics.js');
    const tenantQrCodes = read('server/routes/tenantQrCodes.js');
    const tenantConversions = read('server/routes/tenantConversions.js');
    const tenantFacebookMessaging = read('server/routes/tenantFacebookMessaging.js');
    const tenantMetaOnboarding = read('server/routes/tenantMetaOnboarding.js');
    const tenantBroadcasts = read('server/routes/tenantBroadcasts.js');
    const tenantTemplates = read('server/routes/tenantTemplates.js');
    const tenantMessengerSync = read('server/routes/tenantMessengerSync.js');
    const tenantUnifiedInbox = read('server/routes/tenantUnifiedInbox.js');
    const tenantWhatsAppMessaging = read('server/routes/tenantWhatsAppMessaging.js');
    const tenantWhatsAppMedia = read('server/routes/tenantWhatsAppMedia.js');

    assert.match(server, /app\.use\('\/portal\/messenger-bot', authMiddleware, tenantMiddleware, messengerBotRouter\)/);
    assert.match(server, /app\.use\('\/portal\/fb-content', authMiddleware, tenantMiddleware, fbContentRouter\)/);
    assert.match(server, /app\.use\('\/portal\/fb-insights', authMiddleware, tenantMiddleware, fbInsightsRouter\)/);
    assert.match(server, /app\.use\('\/portal', authMiddleware, tenantMiddleware, tenantPortalRouter\)/);
    assert.doesNotMatch(portal, /router\.use\(ensureTenant\)/);
    assert.doesNotMatch(portal, /router\.(get|post|put|delete)\('\/fb-content\//);
    assert.doesNotMatch(portal, /router\.(get|post|put|delete)\('\/fb-insights\//);
    assert.match(portal, /router\.use\('\/automation', tenantAutomationRouter\)/);
    assert.doesNotMatch(portal, /router\.(get|post|put|patch|delete)\('\/automation\//);
    assert.match(tenantAutomation, /router\.get\('\/rules'/);
    assert.match(tenantAutomation, /router\.post\('\/rules'/);
    assert.match(tenantAutomation, /router\.get\('\/summary'/);
    assert.match(portal, /router\.use\('\/contacts', tenantContactsRouter\)/);
    assert.doesNotMatch(portal, /router\.(get|post|put|delete)\('\/contacts/);
    assert.match(tenantContacts, /ON CONFLICT\(tenant_id, phone\) DO NOTHING/);
    assert.doesNotMatch(tenantContacts, /SELECT c\.\*/);
    assert.match(portal, /router\.use\('\/billing', tenantBillingRouter\)/);
    assert.doesNotMatch(portal, /router\.get\('\/billing\//);
    assert.match(tenantBilling, /defaultLimit:\s*10,[\s\S]*maxLimit:\s*100/);
    assert.match(tenantBilling, /includeInternal:\s*false/);
    assert.match(portal, /router\.use\('\/dashboard', tenantDashboardRouter\)/);
    assert.doesNotMatch(portal, /router\.get\('\/dashboard'/);
    assert.doesNotMatch(tenantDashboard, /SELECT \* FROM (tenants|activity_logs)/);
    assert.match(tenantDashboard, /ORDER BY created_at DESC, id DESC/);
    assert.match(portal, /router\.use\('\/', tenantProfileRouter\)/);
    assert.doesNotMatch(portal, /router\.(get|put)\('\/(business-)?profile'/);
    assert.match(tenantProfile, /SELECT id, name, phone, status, tier, credits, quality, created_at/);
    assert.match(tenantProfile, /requestMeta/);
    assert.match(portal, /router\.use\('\/analytics', tenantAnalyticsRouter\)/);
    assert.doesNotMatch(portal, /router\.get\('\/analytics\/summary'/);
    assert.match(tenantAnalytics, /SUM\(CASE WHEN direction = 'outgoing'/);
    assert.match(portal, /router\.use\('\/qr-codes', tenantQrCodesRouter\)/);
    assert.doesNotMatch(portal, /router\.(get|post|delete)\('\/qr-codes/);
    assert.match(tenantQrCodes, /encodeURIComponent\(qrCodeId\)/);
    assert.match(portal, /router\.use\('\/', tenantConversionsRouter\)/);
    assert.doesNotMatch(portal, /router\.(get|post|patch)\('\/(conversions|meta-settings)/);
    assert.match(tenantConversions, /router\.get\('\/conversions\/history'/);
    assert.match(tenantConversions, /router\.post\('\/conversions\/log-event'/);
    assert.match(tenantConversions, /SUM\(CASE WHEN status = 'sent'/);
    assert.match(portal, /router\.use\('\/', tenantFacebookMessagingRouter\)/);
    assert.doesNotMatch(portal, /router\.(get|post)\('\/(pages|fb-messenger)/);
    assert.match(tenantFacebookMessaging, /WHERE id = \? AND tenant_id = \? AND is_active = 1/);
    assert.match(tenantFacebookMessaging, /WHERE id = \? AND linked_page_id = \? AND tenant_id = \?/);
    assert.match(tenantFacebookMessaging, /Authorization: `Bearer \$\{accessToken\}`/);
    assert.doesNotMatch(tenantFacebookMessaging, /access_token=/);
    assert.match(portal, /router\.use\('\/', tenantMetaOnboardingRouter\)/);
    assert.doesNotMatch(portal, /router\.(get|post|delete)\('\/(meta|facebook|whatsapp)/);
    assert.doesNotMatch(tenantMetaOnboarding, /setInterval\(/);
    assert.match(tenantMetaOnboarding, /session\.tenantId !== tenantId \|\| session\.kind !== kind/);
    assert.match(tenantMetaOnboarding, /WHERE id = \? AND tenant_id = \?/);
    assert.match(tenantMetaOnboarding, /phone_numbers\?fields=id&limit=100/);
    assert.match(tenantMetaOnboarding, /authorizedPhoneIds\.has\(phoneNumberId\)/);
    assert.match(portal, /router\.use\('\/', tenantBroadcastsRouter\)/);
    assert.doesNotMatch(portal, /router\.(get|post)\('\/broadcast/);
    assert.match(tenantBroadcasts, /WHERE id = \? AND tenant_id = \?/);
    assert.match(tenantBroadcasts, /WHERE tenant_id = \? AND name = \?/);
    assert.match(tenantBroadcasts, /normalizeBroadcastRecipients/);
    assert.match(tenantBroadcasts, /createBroadcastProcessor\(/);
    assert.doesNotMatch(tenantBroadcasts, /SELECT \* FROM (tenants|templates|broadcast_jobs)/);
    assert.match(portal, /router\.use\('\/', tenantTemplatesRouter\)/);
    assert.doesNotMatch(portal, /router\.(get|post|put|delete)\('\/templates/);
    assert.match(tenantTemplates, /WHERE id = \? AND tenant_id = \?/);
    assert.match(tenantTemplates, /next\.origin === base\.origin/);
    assert.doesNotMatch(tenantTemplates, /SELECT \* FROM (tenants|templates)/);
    assert.match(portal, /router\.use\('\/', tenantMessengerSyncRouter\)/);
    assert.doesNotMatch(portal, /router\.post\('\/unified\/messenger\/sync'/);
    assert.match(tenantMessengerSync, /WHERE linked_page_id = \? AND user_psid = \? AND tenant_id = \?/);
    assert.match(tenantMessengerSync, /next\.origin === base\.origin/);
    assert.doesNotMatch(tenantMessengerSync, /access_token=/);
    assert.match(portal, /router\.use\('\/', tenantUnifiedInboxRouter\)/);
    assert.doesNotMatch(portal, /router\.(get|post)\('\/(mark-read|unified)/);
    assert.match(tenantUnifiedInbox, /WHERE id = \? AND tenant_id = \? AND user_psid = \?/);
    assert.match(tenantUnifiedInbox, /WHERE id = \? AND tenant_id = \? AND is_active = 1/);
    assert.match(tenantUnifiedInbox, /normalizeWhatsAppRecipient/);
    assert.match(tenantUnifiedInbox, /'last_message', database/);
    assert.doesNotMatch(tenantUnifiedInbox, /SELECT \* FROM (tenants|tenant_pages|fb_conversations)/);
    assert.match(portal, /router\.use\('\/', tenantWhatsAppMessagingRouter\)/);
    assert.doesNotMatch(portal, /router\.(get|post)\('\/(conversations|messages|media)/);
    assert.match(tenantWhatsAppMessaging, /normalizeRecipient/);
    assert.match(tenantWhatsAppMessaging, /'last_message', db/);
    assert.match(tenantWhatsAppMessaging, /router\.use\(createTenantWhatsAppMediaRouter\(\{/);
    assert.doesNotMatch(tenantWhatsAppMessaging, /router\.(get|post)\('\/(media|messages\/send-(?:document|image))/);
    assert.ok(tenantWhatsAppMessaging.split('\n').length < 650);
    assert.match(tenantWhatsAppMedia, /normalizeWhatsAppRecipient/);
    assert.match(tenantWhatsAppMedia, /getWhatsAppConversationWindow/);
    assert.match(tenantWhatsAppMedia, /isAllowedMetaMediaUrl/);
    assert.match(tenantWhatsAppMedia, /encodeURIComponent\(context\.phoneNumberId\)/);
    assert.doesNotMatch(tenantWhatsAppMedia, /console\.log\([^\n]*(payload|Sending)/);
    assert.doesNotMatch(tenantWhatsAppMessaging, /SELECT \* FROM (tenants|templates)/);
});

test('legacy unlinked UI routes redirect to their supported replacements', () => {
    const app = read('client/src/App.jsx');
    const landing = read('client/src/pages/Landing/LandingPage.jsx');
    assert.match(app, /path="\/chat"[\s\S]*?<Navigate to="\/inbox" replace \/>/);
    assert.match(app, /path="\/messenger"[\s\S]*?<Navigate to="\/inbox" replace \/>/);
    assert.match(app, /path="\/facebook-pages"[\s\S]*?<Navigate to="\/tenants" replace \/>/);
    assert.match(app, /path="\/portal\/chat"[\s\S]*?<Navigate to="\/portal\/inbox" replace \/>/);
    assert.match(landing, /href="\/api\/terms"/);
});

test('public pages expose semantic landmarks and a logical heading hierarchy', () => {
    const landing = read('client/src/pages/Landing/LandingPage.jsx');
    const login = read('client/src/pages/Login/Login.jsx');
    const privacy = read('client/src/pages/PrivacyPolicy/PrivacyPolicy.jsx');

    assert.match(landing, /component="main"/);
    assert.match(landing, /component="footer"/);
    assert.match(landing, /component="h1"/);
    assert.match(landing, /component="h2"/);
    assert.match(landing, /component="h3"/);
    assert.doesNotMatch(landing, /component="h1"[^>]*aria-hidden/);
    assert.match(login, /component="main"/);
    assert.match(login, /component="h1"/);
    assert.match(login, /autoComplete="username"/);
    assert.match(login, /autoComplete="current-password"/);
    assert.match(privacy, /component="main"/);
    assert.match(privacy, /component="header"/);
    assert.match(privacy, /component="footer"/);
    assert.match(privacy, /component="h1"/);
    assert.match(privacy, /component="h2"/);
    assert.match(privacy, /component="h3"/);
});

test('landing page bundles Arabic typography and keeps its mobile footer readable', () => {
    const landing = read('client/src/pages/Landing/LandingPage.jsx');
    const main = read('client/src/main.jsx');
    const theme = read('client/src/theme.js');
    const translations = read('client/src/i18n/translations.js');

    assert.match(main, /@fontsource-variable\/alexandria/);
    assert.match(theme, /Alexandria Variable/);
    assert.doesNotMatch(landing, /fonts\.googleapis\.com|Cairo, sans-serif/);
    assert.match(landing, /gridTemplateColumns:[\s\S]*xs: 'minmax\(0, 1fr\)'/);
    assert.doesNotMatch(landing, /size=\{\{[\s\S]*?xs: 2/);
    assert.match(landing, /whiteSpace: 'nowrap'[\s\S]*wordBreak: 'normal'/);
    assert.match(landing, /landing\.pricing\.creditNote/);
    assert.match(translations, /creditNote: 'الكريديت رصيد استخدام/);
});

test('authenticated pages preserve keyboard focus, page headings, and control names', () => {
    const globalStyles = read('client/src/index.css');
    const mainLayout = read('client/src/components/Layout/MainLayout.jsx');
    const sidebar = read('client/src/components/Layout/Sidebar.jsx');
    const dashboard = read('client/src/pages/Dashboard/Dashboard.jsx');
    const tenantDashboard = read('client/src/pages/TenantPortal/TenantDashboard.jsx');
    const tenantList = read('client/src/pages/Tenants/TenantList.jsx');
    const contactManager = read('client/src/pages/Contacts/ContactManager.jsx');
    const tenantContacts = read('client/src/pages/TenantPortal/TenantContacts.jsx');
    const contactPresentation = read('client/src/pages/Contacts/ContactPresentation.jsx');
    const domainPages = [
        contactManager,
        tenantContacts,
        read('client/src/pages/Templates/AdminTemplates.jsx'),
        read('client/src/pages/TenantPortal/TenantTemplates.jsx'),
        read('client/src/pages/Broadcast/BroadcastManager.jsx'),
        read('client/src/pages/TenantPortal/TenantBroadcast.jsx'),
        read('client/src/pages/Automation/AutomationManager.jsx'),
        read('client/src/pages/TenantPortal/TenantAutomation.jsx'),
        read('client/src/pages/Facebook/FacebookPageManager.jsx'),
        read('client/src/pages/TenantPortal/TenantContentManager.jsx'),
        tenantList,
    ];

    assert.match(globalStyles, /:focus-visible/);
    assert.match(globalStyles, /\.Mui-focusVisible/);
    assert.match(globalStyles, /outline:\s*3px solid #005fcc/);
    assert.match(mainLayout, /variant="subtitle1" component="div"/);
    assert.match(mainLayout, /slotProps=\{\{ paper: \{ 'aria-label': t\('layout\.mainNavigation'\) \} \}\}/);
    assert.match(sidebar, /variant="h6" component="div"/);
    assert.match(sidebar, /<Box component="nav" aria-label=\{t\('layout\.mainNavigation'\)\}/);
    assert.match(sidebar, /const sidebarId = useId\(\)/);
    assert.match(sidebar, /<List disablePadding aria-labelledby=\{`\$\{sidebarId\}-section-/);
    assert.match(sidebar, /component=\{RouterLink\}[\s\S]*to=\{item\.path\}/);
    assert.match(dashboard, /component="h1"/);
    assert.match(dashboard, /component="h2"/);
    assert.match(tenantDashboard, /component="h1"/);
    assert.match(tenantDashboard, /component="h2"/);
    for (const page of domainPages) {
        assert.match(page, /component="h1"/);
    }
    assert.match(contactManager, /aria-label=\{tx\("auto\.k_3fafc0e9d048"\)\}/);
    assert.match(tenantContacts, /aria-label=\{tx\("auto\.k_3fafc0e9d048"\)\}/);
    assert.match(contactManager, /inputProps=\{\{ 'aria-label': tx\("auto\.k_8adba91e1d87"\) \}\}/);
    assert.match(tenantContacts, /inputProps=\{\{ 'aria-label': tx\("auto\.k_7c75fec5c0f8"\) \}\}/);
    assert.match(contactPresentation, /aria-label=\{tx\('auto\.k_b4f76c3aa21e'\)\}/);
    assert.match(contactPresentation, /aria-label=\{tx\('auto\.k_3e5e6412e5dd'\)\}/);
    assert.match(contactPresentation, /aria-label=\{tx\('auto\.k_2d2bbdc2d694'\)\}/);
    assert.match(tenantList, /aria-label=\{tx\("auto\.k_302fd8913419"\)\}/);
    assert.match(tenantList, /inputProps=\{\{ 'aria-label': tx\("auto\.k_d6370401145d"\) \}\}/);
    assert.match(tenantList, /inputProps=\{\{ 'aria-label': tx\("auto\.k_6ffd81e2c547"\) \}\}/);
});

test('every lazy-loaded route exposes a semantic page title through shared primitives', () => {
    const app = read('client/src/App.jsx');
    const primitives = read('client/src/components/Layout/PageTitle.jsx');
    const theme = read('client/src/theme.js');
    const facebookCallback = read('client/src/pages/Auth/FacebookOAuthCallback.jsx');
    const metaReview = read('client/src/pages/TenantPortal/TenantMetaReview.jsx');
    const landingPage = read('client/src/pages/Landing/LandingPage.jsx');
    const routeImports = [...app.matchAll(/lazy\(\(\) => import\('(.+?)'\)\)/g)]
        .map((match) => `client/src/${match[1].replace(/^\.\//, '')}.jsx`);

    assert.ok(routeImports.length >= 35, 'expected all public, admin, and tenant lazy routes');
    assert.equal(new Set(routeImports).size, routeImports.length, 'lazy route page imports must be unique');
    for (const routePath of routeImports) {
        const page = read(routePath);
        assert.match(
            page,
            /(?:component="h1"|<h1\b|<PageTitle\b)/,
            `${routePath} must expose a semantic h1 page title`,
        );
    }

    assert.match(primitives, /export const PageTitle[\s\S]*component="h1"/);
    assert.match(primitives, /export const SectionTitle[\s\S]*component="h2"/);
    assert.match(primitives, /export const MetricValue[\s\S]*component="p"/);
    assert.match(primitives, /visuallyHiddenStyles/);
    assert.match(theme, /MuiCircularProgress:[\s\S]*['"]aria-label['"]:/);
    assert.match(theme, /MuiLinearProgress:[\s\S]*['"]aria-label['"]:/);
    assert.match(theme, /MuiFormHelperText:[\s\S]*&\.Mui-disabled/);
    assert.match(facebookCallback, /<Box component="main"/);
    assert.match(facebookCallback, /<CircularProgress aria-label=/);
    assert.match(metaReview, /<LinearProgress aria-label=/);
    assert.doesNotMatch(landingPage, /color:\s*`\$\{step\.color\}18`/);
});

test('every Material UI dialog and icon button has an explicit accessible name', () => {
    let dialogCount = 0;
    let iconButtonCount = 0;
    let fileUploadButtonCount = 0;
    for (const filePath of collectJsxFiles(path.join(rootDir, 'client/src'))) {
        const source = fs.readFileSync(filePath, 'utf8');
        for (const dialogTag of collectOpeningTags(source, 'Dialog')) {
            dialogCount += 1;
            assert.match(
                dialogTag,
                /(?:aria-labelledby=|['"]aria-label['"]\s*:)/,
                `${path.relative(rootDir, filePath)} contains an unnamed Dialog`,
            );
        }
        for (const iconButtonTag of collectOpeningTags(source, 'IconButton')) {
            iconButtonCount += 1;
            assert.match(
                iconButtonTag,
                /(?:aria-(?:label|labelledby)|title)=/,
                `${path.relative(rootDir, filePath)} contains an unnamed IconButton`,
            );
        }
        for (const buttonTag of collectOpeningTags(source, 'Button')) {
            if (!/component="label"/.test(buttonTag)) continue;
            fileUploadButtonCount += 1;
            assert.match(
                buttonTag,
                /role=\{undefined\}/,
                `${path.relative(rootDir, filePath)} assigns an invalid button role to a label`,
            );
        }
    }
    assert.ok(dialogCount >= 35, 'expected the existing dialog surface to be covered');
    assert.ok(iconButtonCount >= 90, 'expected the existing icon-button surface to be covered');
    assert.ok(fileUploadButtonCount >= 10, 'expected file-upload labels to be covered');
});

test('every Material UI select uses the accessible field primitive and exposes a name', () => {
    const accessibleSelectPath = path.join(
        rootDir,
        'client/src/components/Form/AccessibleSelect.jsx',
    );
    const accessibleSelect = fs.readFileSync(accessibleSelectPath, 'utf8');

    assert.match(accessibleSelect, /Select as MuiSelect/);
    assert.match(accessibleSelect, /typeof label === ['"]string['"]/);
    assert.match(accessibleSelect, /\{ 'aria-label': inferredLabel \}/);
    assert.match(accessibleSelect, /inputProps=\{resolvedInputProps\}/);
    const clientEntry = read('client/src/main.jsx');
    assert.match(clientEntry, /import\.meta\.env\.DEV/);
    assert.match(clientEntry, /get\(['"]axe['"]\) === ['"]1['"]/);
    assert.match(clientEntry, /import\(['"]\.\/accessibility\/axeDevAudit\.js['"]\)/);
    const axeDevAudit = read('client/src/accessibility/axeDevAudit.js');
    assert.match(axeDevAudit, /from ['"]axe-core['"]/);
    assert.match(axeDevAudit, /OUTPUT_ID = ['"]axe-audit-result['"]/);
    assert.match(axeDevAudit, /window\.__runAxeAudit = runAxeDevAudit/);

    let selectCount = 0;
    for (const filePath of collectJsxFiles(path.join(rootDir, 'client/src'))) {
        if (filePath === accessibleSelectPath) continue;
        const source = fs.readFileSync(filePath, 'utf8');
        const selectTags = collectOpeningTags(source, 'Select');
        const muiNamedImports = [...source.matchAll(
            /import\s*\{([\s\S]*?)\}\s*from ['"]@mui\/material['"]/g,
        )];

        for (const [, namedImports] of muiNamedImports) {
            assert.doesNotMatch(
                namedImports,
                /(?:^|,)\s*Select\s*(?:,|$)/,
                `${path.relative(rootDir, filePath)} imports the raw Material UI Select`,
            );
        }
        if (selectTags.length > 0) {
            assert.match(
                source,
                /import Select from ['"].*Form\/AccessibleSelect['"]/,
                `${path.relative(rootDir, filePath)} must use the accessible Select primitive`,
            );
        }
        for (const selectTag of selectTags) {
            selectCount += 1;
            assert.match(
                selectTag,
                /(?:label(?:Id)?=|inputProps=|aria-(?:label|labelledby)=)/,
                `${path.relative(rootDir, filePath)} contains an unnamed Select`,
            );
        }
    }
    assert.ok(selectCount >= 70, 'expected the existing select-field surface to be covered');
});

test('conversion history presents sanitized Meta failures only', () => {
    const tenantConversions = read('server/routes/tenantConversions.js');
    const conversionsPage = read('client/src/pages/TenantPortal/TenantConversions.jsx');

    assert.match(tenantConversions, /sanitizeStoredMetaResponse\(event\.meta_response/);
    assert.match(tenantConversions, /error_subcode:\s*lastFailedError\?\.subcode/);
    assert.doesNotMatch(conversionsPage, /error_data/);
    assert.doesNotMatch(conversionsPage, /error_user_msg/);
    assert.doesNotMatch(conversionsPage, /lastFailure\?\.fbtrace_id/);
});

test('all upload routes verify file bytes under a route-specific policy', () => {
    const uploadConfig = read('server/config/upload.js');
    const routes = [
        read('server/routes/api/v1.js'),
        read('server/routes/api/v1Messaging.js'),
        read('server/routes/billing.js'),
        read('server/routes/fbContent.js'),
        read('server/routes/messageMedia.js'),
        read('server/routes/messages.js'),
        read('server/routes/messengerBotProducts.js'),
        read('server/routes/tenantPortal.js'),
        read('server/routes/tenantWhatsAppMedia.js'),
        read('server/routes/tenantWhatsAppMessaging.js'),
    ].join('\n');

    assert.match(uploadConfig, /validateUploadContent\(buffer/);
    assert.match(uploadConfig, /crypto\.randomUUID\(\)/);
    assert.match(uploadConfig, /fs\.promises\.unlink\(info\.path\)/);
    assert.match(routes, /documentUpload/);
    assert.match(routes, /csvUpload as upload/);
    assert.match(routes, /imageUpload\.single\('source'\)/);
    assert.match(routes, /mediaUpload/);
    assert.doesNotMatch(routes, /generalUpload|simpleUpload/);
});

test('Prometheus metrics use a dedicated fail-closed bearer token', () => {
    const server = read('server/server.js');
    const metricsAuth = read('server/middleware/metricsAuth.js');
    const rules = read('ops/prometheus/whatsapp-platform.rules.yml');

    assert.match(server, /app\.use\('\/metrics', createMetricsAuth\(\), metricsRouter\)/);
    assert.match(server, /METRICS_TOKEN\.trim\(\)\.length < 32/);
    assert.match(metricsAuth, /crypto\.timingSafeEqual/);
    assert.match(metricsAuth, /res\.status\(404\)/);
    assert.match(rules, /WhatsAppPlatformHighHttp5xxRate/);
    assert.doesNotMatch(rules, /tenant_id/);
});

test('first-run administrator bootstrap never logs or hardcodes its password', () => {
    const server = read('server/server.js');
    const bootstrap = read('server/services/bootstrapAdmin.js');

    assert.match(server, /await ensureBootstrapAdmin\(db/);
    assert.match(server, /BOOTSTRAP_ADMIN_PASSWORD/);
    assert.doesNotMatch(server, /randomPassword|Password:|admin123/);
    assert.match(bootstrap, /bcrypt\.hash\(normalizedPassword, 12\)/);
    assert.doesNotMatch(bootstrap, /console\.(log|error)/);
});
