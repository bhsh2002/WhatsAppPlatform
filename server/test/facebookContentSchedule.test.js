import assert from 'node:assert/strict';
import test from 'node:test';

import {
    isValidTimeZone,
    isWithinPostingWindow,
    nextCampaignRun,
    normalizeScheduleDays,
    normalizeScheduleTimes,
    normalizeTimeZone,
    parseStoredList,
    zonedMinuteParts,
} from '../services/facebookContentSchedule.js';

test('content schedule normalization rejects invalid days, times and timezones', () => {
    assert.deepEqual(normalizeScheduleDays([6, 1, 1, 9, '2']), [1, 2, 6]);
    assert.deepEqual(normalizeScheduleDays([]), [0, 1, 2, 3, 4, 5, 6]);
    assert.deepEqual(normalizeScheduleTimes(['18:30', '09:00', '9:00', '18:30']), ['09:00', '18:30']);
    assert.deepEqual(normalizeScheduleTimes([]), ['09:00']);
    assert.equal(isValidTimeZone('Africa/Tripoli'), true);
    assert.equal(isValidTimeZone('Mars/Colony'), false);
    assert.equal(normalizeTimeZone('Mars/Colony'), 'Africa/Tripoli');
    assert.deepEqual(parseStoredList('["one","two"]'), ['one', 'two']);
    assert.deepEqual(parseStoredList('{bad', ['fallback']), ['fallback']);
});

test('next content run follows the campaign timezone, days and minute slots', () => {
    const next = nextCampaignRun({
        from: new Date('2026-07-16T07:58:20.000Z'),
        timeZone: 'Africa/Tripoli',
        days: [4],
        times: ['10:00', '18:00'],
    });
    assert.equal(next.toISOString(), '2026-07-16T08:00:00.000Z');
    assert.deepEqual(zonedMinuteParts(next, 'Africa/Tripoli'), { day: 4, time: '10:00' });

    const followingWeek = nextCampaignRun({
        from: new Date('2026-07-16T16:01:00.000Z'),
        timeZone: 'Africa/Tripoli',
        days: [4],
        times: ['18:00'],
    });
    assert.equal(followingWeek.toISOString(), '2026-07-23T16:00:00.000Z');
});

test('posting windows support ordinary and overnight ranges', () => {
    assert.equal(isWithinPostingWindow({
        date: new Date('2026-07-16T10:00:00.000Z'),
        timeZone: 'Africa/Tripoli',
        days: [4],
        startTime: '08:00',
        endTime: '22:00',
    }), true);
    assert.equal(isWithinPostingWindow({
        date: new Date('2026-07-16T21:30:00.000Z'),
        timeZone: 'Africa/Tripoli',
        days: [4],
        startTime: '22:00',
        endTime: '03:00',
    }), true);
    assert.equal(isWithinPostingWindow({
        date: new Date('2026-07-16T12:00:00.000Z'),
        timeZone: 'Africa/Tripoli',
        days: [5],
        startTime: '08:00',
        endTime: '22:00',
    }), false);
});
