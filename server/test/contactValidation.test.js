import assert from 'node:assert/strict';
import test from 'node:test';
import {
    CONTACT_LIMITS,
    InvalidContactError,
    normalizeContactCreate,
    normalizeContactFilters,
    normalizeContactPhone,
    normalizeContactUpdate,
    parseContactId,
} from '../services/contactValidation.js';

test('contact phone normalization enforces an E.164-sized digit range', () => {
    assert.equal(normalizeContactPhone('+218 91-234-5678'), '218912345678');
    assert.throws(() => normalizeContactPhone('123456'), InvalidContactError);
    assert.throws(() => normalizeContactPhone('1'.repeat(CONTACT_LIMITS.phoneMax + 1)), InvalidContactError);
    assert.throws(() => normalizeContactPhone(218912345678), InvalidContactError);
});

test('contact create and update inputs are trimmed, bounded and explicitly clearable', () => {
    assert.deepEqual(normalizeContactCreate({
        phone: '+218 91 234 5678',
        profile_name: '  Customer  ',
        label: ' VIP ',
        notes: '  Notes  ',
    }), {
        phone: '218912345678',
        profileName: 'Customer',
        label: 'VIP',
        notes: 'Notes',
    });
    assert.deepEqual(normalizeContactUpdate({ label: null, notes: '  ' }), {
        label: null,
        notes: null,
    });
    assert.throws(() => normalizeContactUpdate({}), InvalidContactError);
    assert.throws(
        () => normalizeContactCreate({ phone: '218912345678', notes: 'x'.repeat(CONTACT_LIMITS.notes + 1) }),
        InvalidContactError,
    );
});

test('contact filters and identifiers reject malformed or oversized values', () => {
    assert.deepEqual(normalizeContactFilters({ search: '  Ali  ', label: ' VIP ' }), {
        search: 'Ali',
        label: 'VIP',
    });
    assert.equal(parseContactId('42'), 42);
    assert.throws(() => parseContactId('0'), InvalidContactError);
    assert.throws(() => parseContactId('abc'), InvalidContactError);
    assert.throws(
        () => normalizeContactFilters({ search: 'x'.repeat(CONTACT_LIMITS.search + 1) }),
        InvalidContactError,
    );
});
