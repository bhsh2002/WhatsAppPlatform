import express from 'express';
import db from '../db/database.js';
import { META_APP_ID, META_APP_SECRET, FACEBOOK_REDIRECT_URI, WA_EMBEDDED_SIGNUP_CONFIG_ID, META_API_VERSION } from '../config/index.js';
import eventBus from '../services/eventBus.js';
import { decryptIfEncrypted, encrypt } from '../services/encryption.js';
import { getAccessToken } from '../services/credentials.js';
import { requestMetaJson } from '../services/metaHttp.js';
import {
    FACEBOOK_OAUTH_SCOPES as FACEBOOK_REVIEW_SCOPES,
    FACEBOOK_WEBHOOK_FIELDS,
    buildMetaReviewReadiness,
    listMetaReviewSnapshots,
    saveMetaReviewSnapshot,
} from '../services/metaReadiness.js';
import {
    BILLING_OPERATIONS,
    commit as commitBilling,
    deferBroadcastReservationUntilStatuses,
    handleBillingError,
    recordMetaMessageCost,
    release as releaseBilling,
    resolveLocalBillableQuantity,
    reserve as reserveBilling,
    summarizeMetaRecipientCountries,
} from '../services/billing.js';
import { markBotHandoffForConversation } from '../services/messengerBot.js';
import { SmsGatewayService } from '../services/smsGateway.js';
import tenantApiSettingsRouter from './tenantApiSettings.js';
import { createTenantAnalyticsRouter } from './tenantAnalytics.js';
import tenantAutomationRouter from './tenantAutomation.js';
import tenantBillingRouter from './tenantBilling.js';
import { createTenantBroadcastsRouter } from './tenantBroadcasts.js';
import tenantContactsRouter from './tenantContacts.js';
import { createTenantConversionsRouter } from './tenantConversions.js';
import tenantDashboardRouter from './tenantDashboard.js';
import { createTenantFacebookMessagingRouter } from './tenantFacebookMessaging.js';
import { createTenantMetaOnboardingRouter } from './tenantMetaOnboarding.js';
import { createTenantMessengerSyncRouter } from './tenantMessengerSync.js';
import { createTenantProfileRouter } from './tenantProfile.js';
import { createTenantQrCodesRouter } from './tenantQrCodes.js';
import { createTenantTemplatesRouter } from './tenantTemplates.js';
import { createTenantUnifiedInboxRouter } from './tenantUnifiedInbox.js';
import { createTenantWhatsAppMessagingRouter } from './tenantWhatsAppMessaging.js';
import { createTenantSmsGatewayRouter } from './tenantSmsGateway.js';

const router = express.Router();
const smsGatewayService = new SmsGatewayService({ database: db });
const tenantSmsGatewayRouter = createTenantSmsGatewayRouter({
    service: smsGatewayService,
    billing: {
        operations: BILLING_OPERATIONS,
        reserve: reserveBilling,
        commit: commitBilling,
        release: releaseBilling,
        handleError: handleBillingError,
    },
});
const tenantAnalyticsRouter = createTenantAnalyticsRouter({ database: db });
const tenantProfileRouter = createTenantProfileRouter({
    database: db,
    accessTokenForTenant: getAccessToken,
    requestMeta: requestMetaJson,
});
const tenantQrCodesRouter = createTenantQrCodesRouter({
    database: db,
    accessTokenForTenant: getAccessToken,
    requestMeta: requestMetaJson,
});
const tenantConversionsRouter = createTenantConversionsRouter({
    database: db,
    accessTokenForTenant: getAccessToken,
    requestMeta: requestMetaJson,
    billing: {
        operations: BILLING_OPERATIONS,
        reserve: reserveBilling,
        commit: commitBilling,
        release: releaseBilling,
        handleError: handleBillingError,
    },
});
const tenantFacebookMessagingRouter = createTenantFacebookMessagingRouter({
    database: db,
    decryptToken: decryptIfEncrypted,
    requestMeta: requestMetaJson,
    billing: {
        operations: BILLING_OPERATIONS,
        reserve: reserveBilling,
        commit: commitBilling,
        release: releaseBilling,
        handleError: handleBillingError,
    },
    markHandoff: markBotHandoffForConversation,
    broadcast: (channel, event, data) => eventBus.broadcast(channel, event, data),
});
const tenantMetaOnboardingRouter = createTenantMetaOnboardingRouter({
    database: db,
    encryptToken: encrypt,
    decryptToken: decryptIfEncrypted,
    requestMeta: requestMetaJson,
    buildReadiness: buildMetaReviewReadiness,
    listSnapshots: listMetaReviewSnapshots,
    saveSnapshot: saveMetaReviewSnapshot,
    config: {
        appId: META_APP_ID,
        appSecret: META_APP_SECRET,
        redirectUri: FACEBOOK_REDIRECT_URI,
        whatsappConfigId: WA_EMBEDDED_SIGNUP_CONFIG_ID,
        apiVersion: META_API_VERSION,
        reviewScopes: FACEBOOK_REVIEW_SCOPES,
        webhookFields: FACEBOOK_WEBHOOK_FIELDS,
    },
});
const tenantBroadcastsRouter = createTenantBroadcastsRouter({
    database: db,
    accessTokenForTenant: getAccessToken,
    requestMeta: requestMetaJson,
    billing: {
        operations: BILLING_OPERATIONS,
        reserve: reserveBilling,
        commit: commitBilling,
        release: releaseBilling,
        handleError: handleBillingError,
        resolveLocalQuantity: resolveLocalBillableQuantity,
        summarizeCountries: summarizeMetaRecipientCountries,
        deferUntilStatuses: deferBroadcastReservationUntilStatuses,
    },
    recordMessageCost: recordMetaMessageCost,
    broadcast: (channel, event, data) => eventBus.broadcast(channel, event, data),
});
const tenantTemplatesRouter = createTenantTemplatesRouter({
    database: db,
    accessTokenForTenant: getAccessToken,
    requestMeta: requestMetaJson,
});
const tenantMessengerSyncRouter = createTenantMessengerSyncRouter({
    database: db,
    decryptToken: decryptIfEncrypted,
    requestMeta: requestMetaJson,
});
const tenantUnifiedInboxRouter = createTenantUnifiedInboxRouter({
    database: db,
    accessTokenForTenant: getAccessToken,
    decryptToken: decryptIfEncrypted,
    requestMeta: requestMetaJson,
    billing: {
        operations: BILLING_OPERATIONS,
        reserve: reserveBilling,
        commit: commitBilling,
        release: releaseBilling,
        handleError: handleBillingError,
    },
    smsGateway: smsGatewayService,
    emitNewMessage: message => eventBus.emitNewMessage(message),
    emitConversationUpdate: tenantId => eventBus.emitConversationUpdate(tenantId),
    broadcast: (channel, event, data) => eventBus.broadcast(channel, event, data),
    markHandoff: markBotHandoffForConversation,
});
const tenantWhatsAppMessagingRouter = createTenantWhatsAppMessagingRouter({
    database: db,
    accessTokenForTenant: getAccessToken,
    billing: {
        operations: BILLING_OPERATIONS,
        reserve: reserveBilling,
        commit: commitBilling,
        release: releaseBilling,
        handleError: handleBillingError,
    },
    emitNewMessage: message => eventBus.emitNewMessage(message),
    emitConversationUpdate: tenantId => eventBus.emitConversationUpdate(tenantId),
});

// Tenant dashboard aggregates are isolated under the existing /portal/dashboard contract.
router.use('/dashboard', tenantDashboardRouter);

// Tenant billing reads are isolated under the existing /portal/billing contract.
router.use('/billing', tenantBillingRouter);

// Tenant contact CRUD is isolated under the existing /portal/contacts contract.
router.use('/contacts', tenantContactsRouter);

// ============================================
// Tenant WhatsApp conversations, messages and media preserve their portal paths.
router.use('/', tenantWhatsAppMessagingRouter);

// Tenant broadcasts and job tracking preserve their existing portal paths.
router.use('/', tenantBroadcastsRouter);

// Tenant local and Meta template lifecycle preserve their existing portal paths.
router.use('/', tenantTemplatesRouter);

// Tenant API credentials and callback policy are isolated under the existing contract.
router.use('/settings/api', tenantApiSettingsRouter);

// Tenant-isolated Android SMS gateway credentials and health checks.
router.use('/sms-gateway', tenantSmsGatewayRouter);

// Tenant account and WhatsApp business profile retain the existing /portal paths.
router.use('/', tenantProfileRouter);

// Tenant message analytics preserve the existing /portal/analytics contract.
router.use('/analytics', tenantAnalyticsRouter);

// Tenant QR lifecycle preserves the existing /portal/qr-codes contract.
router.use('/qr-codes', tenantQrCodesRouter);

// Tenant conversion settings, history and event delivery preserve the existing portal paths.
router.use('/', tenantConversionsRouter);

// ============================================
// Tenant unified inbox reads, read receipts and sends preserve their portal paths.
router.use('/', tenantUnifiedInboxRouter);

// Tenant Messenger synchronization preserves its unified inbox path.
router.use('/', tenantMessengerSyncRouter);

// Tenant Facebook pages and utility messages preserve their existing portal paths.
router.use('/', tenantFacebookMessagingRouter);

// Tenant automation is isolated behind the same /portal/automation contract.
router.use('/automation', tenantAutomationRouter);

// Tenant Meta OAuth, review diagnostics and WhatsApp onboarding keep their portal paths.
router.use('/', tenantMetaOnboardingRouter);

export default router;
