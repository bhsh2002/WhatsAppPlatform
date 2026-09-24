import assert from 'node:assert/strict';
import test from 'node:test';

import {
    availableSmsAccounts,
    buildNewMessageDraft,
    findMatchingConversation,
    normalizeMessageRecipient,
    resolveSmsAccountId,
    validateNewMessageDraft,
} from './newMessageDraft.js';

const accounts = [
    { id: 7, name: 'الحساب الرئيسي', enabled: true, status: 'active', is_default: true },
    { id: 8, name: 'حساب متوقف', enabled: true, status: 'error' },
    { id: 9, name: 'حساب معطل', enabled: false, status: 'active' },
];

test('recipient normalization accepts Arabic digits and common visual separators', () => {
    assert.equal(normalizeMessageRecipient('+٢١٨ (٩١) ٢٣٤-٥٦٧٨'), '218912345678');
    assert.equal(normalizeMessageRecipient('+۲۱۸ ۹۲ ۱۲۳ ۴۵۶۷'), '218921234567');
});

test('only active tenant SMS accounts can be selected for a new conversation', () => {
    assert.deepEqual(availableSmsAccounts(accounts).map(account => account.id), [7]);
    assert.equal(validateNewMessageDraft({
        channel: 'sms',
        recipient: '218912345678',
        smsAccountId: 8,
    }, accounts).valid, false);
});

test('SMS account selection uses only an active default or the sole active account', () => {
    assert.equal(resolveSmsAccountId(accounts), '7');
    assert.equal(resolveSmsAccountId([
        { id: 10, enabled: true, status: 'active', is_default: false },
    ]), '10');
    assert.equal(resolveSmsAccountId([
        { id: 10, enabled: true, status: 'active', is_default: false },
        { id: 11, enabled: true, status: 'active', is_default: false },
    ]), '');
    assert.equal(resolveSmsAccountId([
        { id: 10, enabled: true, status: 'active', is_default: false },
        { id: 11, enabled: true, status: 'active', is_default: false },
    ], 11), '11');
});

test('SMS drafts require an explicit account id even when the tenant has a default', () => {
    const result = buildNewMessageDraft({
        channel: 'sms',
        recipient: '218912345678',
        message: 'مرحبا',
    }, accounts);

    assert.equal(result.valid, false);
    assert.equal(result.errors.smsAccountId, 'invalid_sms_account');
    assert.equal(result.conversation, null);
});

test('WhatsApp draft opens a conversation without sending the draft', () => {
    const result = buildNewMessageDraft({
        channel: 'whatsapp',
        recipient: '+218 91 234 5678',
        message: 'مسودة قابلة للمراجعة',
    }, accounts);

    assert.equal(result.valid, true);
    assert.deepEqual(result.conversation, {
        channel: 'whatsapp',
        contact_id: '218912345678',
        display_name: '218912345678',
        avatar_url: null,
    });
    assert.equal(result.message, 'مسودة قابلة للمراجعة');
});

test('SMS draft is bound to the explicitly selected account', () => {
    const result = buildNewMessageDraft({
        channel: 'sms',
        recipient: '218912345678',
        message: 'مرحبا',
        smsAccountId: '7',
    }, accounts);

    assert.equal(result.valid, true);
    assert.equal(result.conversation.sms_account_id, 7);
    assert.equal(result.conversation.sms_account_name, 'الحساب الرئيسي');
});

test('compose reuses matching conversations without crossing SMS accounts', () => {
    const whatsapp = {
        channel: 'whatsapp',
        tenant_id: 3,
        contact_id: '218912345678',
        display_name: 'عميل واتساب',
    };
    const smsAccount7 = {
        channel: 'sms',
        tenant_id: 3,
        sms_account_id: 7,
        contact_id: '218912345678',
        display_name: 'عميل SMS',
    };
    const smsAccount12 = {
        ...smsAccount7,
        sms_account_id: 12,
    };
    const conversations = [whatsapp, smsAccount7, smsAccount12];

    assert.equal(findMatchingConversation(conversations, {
        channel: 'whatsapp',
        contact_id: '+218 91 234 5678',
    }), whatsapp);
    assert.equal(findMatchingConversation(conversations, {
        channel: 'sms',
        contact_id: '218912345678',
        sms_account_id: 12,
    }), smsAccount12);
    assert.equal(findMatchingConversation(conversations, {
        channel: 'sms',
        contact_id: '218912345678',
        sms_account_id: 99,
    }), null);
});
