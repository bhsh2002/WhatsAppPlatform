import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTenantDashboardCards, dashboardSafeCount } from './dashboardPresentation.js';

const baseInput = {
    stats: {
        unreadCount: 4,
        messagesToday: 12,
        sentToday: 7,
        receivedToday: 5,
        smsPendingToday: 0,
        smsFailedToday: 0,
        totalConversations: 9,
        templatesCount: 3,
    },
    credits: 42,
    formattedCycleEnd: '30/09/2026',
    cycleCaption: 'نشط',
    cycleColor: 'success',
};

test('dashboard exposes six ordered, actionable cards without duplicate daily totals', () => {
    const cards = buildTenantDashboardCards(baseInput);

    assert.deepEqual(cards.map(card => card.id), [
        'unread',
        'messages-today',
        'conversations',
        'templates',
        'credits',
        'subscription',
    ]);
    assert.equal(cards.length, 6);
    assert.ok(cards.every(card => card.to.startsWith('/portal/')));
    assert.equal(cards.find(card => card.id === 'messages-today').descriptionValues.sent, 7);
    assert.equal(cards.find(card => card.id === 'messages-today').descriptionValues.received, 5);
});

test('SMS activity replaces the irrelevant template shortcut only for SMS tenants', () => {
    const cards = buildTenantDashboardCards({
        ...baseInput,
        stats: {
            ...baseInput.stats,
            smsAccounts: 2,
            smsMessagesToday: 8,
            smsSentToday: 5,
            smsPendingToday: 0,
            smsReceivedToday: 2,
            smsFailedToday: 1,
        },
    });
    const sms = cards.find(card => card.id === 'sms-today');

    assert.equal(cards.length, 6);
    assert.equal(cards.some(card => card.id === 'templates'), false);
    assert.equal(sms.to, '/portal/inbox?channel=sms&period=today');
    assert.equal(sms.value, 8);
    assert.equal(sms.color, 'error');
    assert.deepEqual(sms.descriptionValues, { sent: 5, pending: 0, received: 2, failed: 1 });
    assert.deepEqual(cards.find(card => card.id === 'messages-today').descriptionValues, {
        sent: 7,
        received: 5,
        pending: 0,
        failed: 1,
    });
    assert.equal(cards.find(card => card.id === 'unread').to, '/portal/inbox?unread=1');
    assert.equal(cards.find(card => card.id === 'messages-today').to, '/portal/inbox?period=today');
});

test('dashboard count presentation rejects missing, negative, and non-numeric values', () => {
    assert.equal(dashboardSafeCount(undefined), 0);
    assert.equal(dashboardSafeCount(-3), 0);
    assert.equal(dashboardSafeCount('not-a-number'), 0);
    assert.equal(dashboardSafeCount('7'), 7);
});
