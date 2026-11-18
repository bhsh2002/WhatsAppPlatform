import { META_API_BASE } from '../config/index.js';
import { createNativeSmsMessageCommand } from './nativeSmsMessage.js';
import { createNativeWhatsAppMessageCommand, prepareNativeWhatsAppMessage } from './nativeWhatsAppMessage.js';
import { createNativeMessengerMessageCommand, prepareNativeMessengerMessage } from './nativeMessengerMessage.js';
import { publishNativeFacebookContent } from './nativeFacebookContentPublisher.js';
import { createBroadcastProcessor } from './broadcastProcessor.js';
import { readMetaResponse } from './metaHttp.js';
import {createNativeWhatsAppMediaTransport} from './nativeWhatsAppMediaTransport.js';

// The caller supplies the same actual DB, native credential readers, billing
// and transport used by its native routes. Nothing opens a default database.
export const createNativeCollaborativeDependencies = ({ database, encryption, smsService, billing,
    whatsappCredentials, contentCredentials, settleWhatsAppStatus = billing?.updateMetaChargeFromStatus,
    eventBus = null, callbackSender = null, fetchImpl = globalThis.fetch, metaApiBase = META_API_BASE,
    markMessengerHandoff = null, recordMessageCost = null, now = () => Date.now() }) => {
    if (!database || typeof encryption?.decrypt !== 'function' || !smsService || smsService.db !== database
        || !billing?.operations || !['quote','reserve','commit','release'].every(key => typeof billing[key] === 'function')
        || (billing.database !== undefined && billing.database !== database)
        || typeof whatsappCredentials !== 'function' || typeof contentCredentials !== 'function'
        || typeof fetchImpl !== 'function' || typeof metaApiBase !== 'string'
        || (callbackSender !== null && typeof callbackSender !== 'function')) {
        throw new TypeError('Native collaboration requires the actual DB-bound services and credential readers');
    }
    const origin = new URL(metaApiBase);
    if (!['http:','https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash) {
        throw new TypeError('Native Meta base must be a fixed server-owned HTTP(S) URL');
    }
    const base = metaApiBase.replace(/\/+$/, '');
    const callback = callbackSender || (() => undefined);
    const broadcast = typeof eventBus?.broadcast === 'function' ? eventBus.broadcast.bind(eventBus) : (() => undefined);
    const requestMeta = async (url, options) => readMetaResponse(await fetchImpl(url, options));
    const decryptToken = value => encryption.decrypt(value);
    return {
        billing, smsService, whatsappCredentials, contentCredentials, settleWhatsAppStatus,
        mediaTransport:createNativeWhatsAppMediaTransport({fetchImpl,apiBase:base}),
        smsCommand: createNativeSmsMessageCommand({ database, service: smsService, billing, callbackSender: callback }),
        prepareWhatsApp: input => prepareNativeWhatsAppMessage({ database, credentialResolver: whatsappCredentials, ...input, now }),
        whatsappCommand: createNativeWhatsAppMessageCommand({ database, credentialResolver: whatsappCredentials,
            billing, fetchImpl, parseMetaResponse: readMetaResponse, apiBase: base, callbackSender: callback, now }),
        prepareMessenger: input => prepareNativeMessengerMessage({ database, decryptToken, ...input }),
        messengerCommand: createNativeMessengerMessageCommand({ database, decryptToken, requestMeta, billing, apiBase: base,
            markHandoff: markMessengerHandoff || (() => undefined), broadcast }),
        publishContent: input => publishNativeFacebookContent({ ...input, database, billing,
            fetchImpl, credentialResolver: contentCredentials, metaApiBase: base }),
        processBroadcast: createBroadcastProcessor({ database, requestMeta, billing, broadcast,
            recordMessageCost: recordMessageCost || (() => undefined), includeGlobalContacts: false,
            channelForTenant: tenantId => `tenant:${tenantId}`, apiBase: base }),
    };
};
