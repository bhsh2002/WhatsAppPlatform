import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import test from 'node:test';
import { workspaceNativeCapabilityCards } from '../services/workspaceNativeCapabilityCards.js';

const bytes = fs.readFileSync(new URL('../test-fixtures/peer-native-command-options-http-v1.json', import.meta.url));
const receipt = JSON.parse(bytes), examples = receipt.examples;
const source = examples.service_actual_nonempty_native_options;
const identity = raw => ({ actorId: raw.actor.account_id, organizationId: raw.organization.id });
const args = raw => ({ raw, identity: identity(raw), activityId: raw.activities[0].activity_id,
    coreOrigin: 'https://core.owned.example', urlPolicy: { allowLoopback: true, allowedOrigins: ['https://core.owned.example'] } });
const invalid = { code: 'workspace_response_invalid', status: 502 };

test('actual five published native options project exact current source destinations and blocked reasons without local forms or execution flags', () => {
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), 'bf8dd5d4cac00dd7ad22ed74966d07c7d42d0a8b90adf9e17f1d5049e5c08c82');
    let count = 0;
    for (const raw of Object.values(examples)) {
        const cards = workspaceNativeCapabilityCards(args(raw));
        assert.equal(cards.length, raw.native_command_options.length);
        cards.forEach((card, index) => {
            const option = raw.native_command_options[index];
            assert.equal(card.label, option.label);
            assert.equal(card.description, raw.providers.find(row => row.provider_ref === option.provider_ref).label);
            assert.equal(card.availability.state, option.availability.state);
            assert.equal(card.availability.reason_code, option.availability.reason_code);
            assert.equal(card.availability.message, option.availability.message);
            assert.equal(card.availability.next_action.label, option.availability.next_action.label);
            assert.deepEqual(card.actions, []);
            assert.deepEqual(Object.keys(card), ['key', 'label', 'description', 'availability', 'actions']);
            assert.match(card.key, /^[a-f0-9]{64}$/);
            if (['available', 'review_available'].includes(option.availability.state)) assert.equal(card.availability.next_action.href, option.owner_action_url);
            else assert.equal(card.availability.next_action.href, new URL(option.availability.next_action.href, 'https://core.owned.example').href);
            for (const privateKey of ['fields', 'resources', 'resource_refs', 'authorization_revision', 'source_installation_id', 'capability_grant_revision', 'validator_version', 'payload_schema', 'can_execute']) assert.equal(Object.hasOwn(card, privateKey), false);
            count += 1;
        });
    }
    assert.equal(count, 5);
});

test('permission withdrawal replaces a stable card with the actual repair action and no former named resources or owner form URL', () => {
    const before = workspaceNativeCapabilityCards(args(source))[0];
    const raw = examples.service_after_actual_permission_withdrawal;
    const after = workspaceNativeCapabilityCards(args(raw))[0];
    assert.equal(before.key, after.key);
    assert.equal(before.availability.state, 'review_available');
    assert.equal(after.availability.state, 'permission_required');
    assert.equal(new URL(after.availability.next_action.href).origin, 'https://core.owned.example');
    assert.equal(after.availability.next_action.code, 'manage_permissions');
    assert.equal(JSON.stringify(after).includes('قاعة الخدمات الأولى'), false);
    assert.equal(JSON.stringify(after).includes(source.native_command_options[0].owner_action_url), false);
    assert.deepEqual(raw.native_command_options[0].fields, []);
});

test('cards remain scoped to the exact selected activity and deterministic source/action tuple, not the first provider or role', () => {
    assert.deepEqual(workspaceNativeCapabilityCards({ ...args(source), activityId: null }), []);
    const raw = structuredClone(source), old = structuredClone(raw);
    raw.activities.push({ ...raw.activities[0], activity_id: 'second-activity', scope: { ...raw.activities[0].scope, activity_id: 'second-activity' }, capability_grants: [] });
    assert.deepEqual(workspaceNativeCapabilityCards({ ...args(raw), activityId: 'second-activity' }), []);
    assert.deepEqual(workspaceNativeCapabilityCards(args(raw)), workspaceNativeCapabilityCards(args(old)));
    assert.throws(() => workspaceNativeCapabilityCards({ ...args(raw), activityId: 'unlisted-activity' }), invalid);
    assert.throws(() => workspaceNativeCapabilityCards({ ...args(raw), identity: { ...identity(raw), actorId: 'other-owner', role: 'owner' } }), invalid);
});

test('malformed, stale source/grant or unsafe URL metadata cannot become a working navigation card', () => {
    for (const change of [
        raw => { raw.native_command_options[0].source_installation_id = 'foreign-source'; },
        raw => { raw.native_command_options[0].capability_grant_revision = 2; },
        raw => { raw.native_command_options[0].owner_action_url = 'https://unlisted.invalid/form'; raw.native_command_options[0].availability.next_action.href = 'https://unlisted.invalid/form'; },
        raw => { raw.owner_action_origins = ['javascript:alert(1)']; },
        raw => { raw.native_command_options[0].availability.next_action.href = 'https://user:password@core.owned.example/form'; },
        raw => { raw.native_command_options[0].payload_schema = { type: 'object' }; },
    ]) { const raw = structuredClone(source); change(raw); assert.throws(() => workspaceNativeCapabilityCards(args(raw)), invalid); }
    for (const coreOrigin of ['javascript:alert(1)', 'https://user:password@core.owned.example', 'http://outside.invalid', 'https://core.owned.example?token=value']) {
        assert.throws(() => workspaceNativeCapabilityCards({ ...args(source), coreOrigin }), invalid);
    }
});

test('legacy context without native options yields no fabricated source actions and projection never mutates raw evidence', () => {
    const raw = structuredClone(source); delete raw.native_command_options;
    const before = JSON.stringify(raw);
    assert.deepEqual(workspaceNativeCapabilityCards(args(raw)), []);
    assert.equal(JSON.stringify(raw), before);
    const options = structuredClone(source.native_command_options);
    const cards = workspaceNativeCapabilityCards(args(source));
    cards[0].availability.next_action.href = 'https://local-test.invalid';
    assert.deepEqual(source.native_command_options, options);
});

test('safe registered owner URL is preserved exactly rather than rewriting a source-approved Unicode path', () => {
    const raw = structuredClone(source), origin = 'https://catalog.owner.example';
    const destination = `${origin}/عمليات/طلب?purpose=review`;
    raw.owner_action_origins = [origin];
    raw.native_command_options[0].owner_action_url = destination;
    raw.native_command_options[0].availability.next_action.href = destination;
    raw.capabilities.find(row => row.code === 'services.reserve').availability.next_action.href = destination;
    assert.equal(workspaceNativeCapabilityCards(args(raw))[0].availability.next_action.href, destination);
});
