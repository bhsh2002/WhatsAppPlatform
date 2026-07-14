import { tx } from '../../i18n/tx';

export const MEDIA_HEADER_TYPES = ['image', 'video', 'document', 'audio'];

export const MEDIA_ACCEPT = {
  image: 'image/jpeg,image/png,image/webp',
  video: 'video/mp4,video/3gpp',
  document: '.pdf,.doc,.docx,.xls,.xlsx,.txt',
  audio: 'audio/aac,audio/mp4,audio/mpeg,audio/amr,audio/ogg'
};

export const getBroadcastContactFields = () => [{
  value: 'profile_name',
  label: tx('auto.k_28fc609bc67b'),
  icon: '👤'
}, {
  value: 'phone',
  label: tx('auto.k_211cce4ca4ef'),
  icon: '📱'
}, {
  value: 'label',
  label: tx('auto.k_7c75fec5c0f8'),
  icon: '🏷️'
}, {
  value: 'notes',
  label: tx('auto.k_b172fc1d3b6d'),
  icon: '📝'
}];

export const getBroadcastMediaLabels = () => ({
  image: tx('auto.k_b941956874fe'),
  video: tx('auto.k_17daa024f2eb'),
  document: tx('auto.k_d9381107732e'),
  audio: tx('auto.k_06d9927a57ae')
});

export const extractNumberedVariables = (text) => {
  if (!text) return [];
  const matches = text.match(/\{\{(\d+)\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map((match) => parseInt(match.replace(/[{}]/g, ''), 10)))].sort((a, b) => a - b);
};

export const previewBroadcastBody = (bodyText, variableConfigs, keyPrefix = '') => {
  if (!bodyText) return '';
  return bodyText.replace(/\{\{(\d+)\}\}/g, (match, number) => {
    const key = keyPrefix ? `${keyPrefix}_${number}` : parseInt(number, 10);
    const config = variableConfigs[key];
    if (!config) return match;
    if (config.source === 'static') return config.value || match;
    if (config.source === 'contact') {
      const field = getBroadcastContactFields().find((item) => item.value === config.field);
      return `[${field?.label || config.field}]`;
    }
    return match;
  });
};

export const parseBroadcastRecipients = (value) => String(value || '')
  .split(/[\n,;]+/)
  .map((recipient) => recipient.replace(/[^0-9+]/g, '').trim())
  .filter((recipient) => recipient.length >= 8);

export const buildBroadcastRecipients = (contacts, selectedContactIds, manualValue) => {
  const manualRecipients = parseBroadcastRecipients(manualValue);
  const selectedRecipients = contacts
    .filter((contact) => selectedContactIds.has(contact.id))
    .map((contact) => contact.phone);
  return {
    manualRecipients,
    uniqueRecipients: [...new Set([...selectedRecipients, ...manualRecipients])]
  };
};

export const getBroadcastContactLabels = (contacts) => (
  [...new Set(contacts.map((contact) => contact.label).filter(Boolean))].sort()
);

export const filterBroadcastContacts = (contacts, search, label) => {
  const normalizedSearch = String(search || '').toLowerCase();
  return contacts.filter((contact) => {
    const matchesSearch = !normalizedSearch
      || String(contact.profile_name || '').toLowerCase().includes(normalizedSearch)
      || String(contact.phone || '').includes(search);
    return matchesSearch && (!label || contact.label === label);
  });
};
