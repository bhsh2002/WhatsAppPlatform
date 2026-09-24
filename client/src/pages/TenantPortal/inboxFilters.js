const INBOX_CHANNELS = new Set(['whatsapp', 'messenger', 'sms']);

export const readInboxFilters = searchParams => {
  const channelValue = searchParams?.get?.('channel');
  return {
    channel: INBOX_CHANNELS.has(channelValue) ? channelValue : '',
    unreadOnly: searchParams?.get?.('unread') === '1',
    period: searchParams?.get?.('period') === 'today' ? 'today' : '',
  };
};

export const updateInboxSearchFilter = (searchParams, key, value) => {
  const next = new URLSearchParams(searchParams);
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
};
