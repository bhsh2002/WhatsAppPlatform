import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readInboxFilters,
  updateInboxSearchFilter,
} from './inboxFilters.js';

test('inbox query filters accept only the supported public values', () => {
  assert.deepEqual(readInboxFilters(new URLSearchParams('channel=sms&unread=1&period=today')), {
    channel: 'sms',
    unreadOnly: true,
    period: 'today',
  });
  assert.deepEqual(readInboxFilters(new URLSearchParams('channel=email&unread=true&period=week')), {
    channel: '',
    unreadOnly: false,
    period: '',
  });
});

test('changing a channel query preserves dashboard filters and all can be removed', () => {
  const initial = new URLSearchParams('channel=sms&unread=1&period=today');
  const whatsapp = updateInboxSearchFilter(initial, 'channel', 'whatsapp');
  assert.equal(whatsapp.toString(), 'channel=whatsapp&unread=1&period=today');

  const allChannels = updateInboxSearchFilter(whatsapp, 'channel', '');
  assert.equal(allChannels.toString(), 'unread=1&period=today');
  assert.equal(updateInboxSearchFilter(allChannels, 'unread', '').toString(), 'period=today');
});
