import { tx } from '../../i18n/tx';

export const getRULE_TYPES = () => [{
  value: 'keyword',
  label: tx('auto.k_4215bd1e60c8')
}, {
  value: 'welcome',
  label: tx('auto.k_790223748ff8')
}, {
  value: 'away',
  label: tx('auto.k_dcf93a00e17c')
}, {
  value: 'comment_reply',
  label: tx('auto.k_11cca7ed085b')
}];

export const getCHANNELS = () => [{
  value: 'all',
  label: tx('auto.k_67dc2a700f92')
}, {
  value: 'whatsapp',
  label: tx('auto.k_7b5629bcb45d')
}, {
  value: 'messenger',
  label: tx('auto.k_3cab5678293b')
}, {
  value: 'facebook',
  label: tx('auto.k_ac86ec8e2a63')
}];

export const getMATCH_TYPES = () => [{
  value: 'exact',
  label: tx('auto.k_84dd2663c455')
}, {
  value: 'contains',
  label: tx('auto.k_e7ad54b85f8d')
}];

export const getDAY_OPTIONS = () => [{
  value: 'sun',
  label: tx('auto.k_29c2a914d745')
}, {
  value: 'mon',
  label: tx('auto.k_a46d7f58ba2c')
}, {
  value: 'tue',
  label: tx('auto.k_81a8732d2ed7')
}, {
  value: 'wed',
  label: tx('auto.k_67e1e0bf90b1')
}, {
  value: 'thu',
  label: tx('auto.k_af0a56c556f2')
}, {
  value: 'fri',
  label: tx('auto.k_5a03133f974d')
}, {
  value: 'sat',
  label: tx('auto.k_a478daf22935')
}];

export const getRESPONSE_ACTIONS = () => [{
  value: 'comment',
  label: tx('auto.k_ee6a9ce3ccdc')
}, {
  value: 'dm',
  label: tx('auto.k_b7c0b6e4c278')
}, {
  value: 'both',
  label: tx('auto.k_9dfe542dcb55')
}];

export const getTRIGGER_ON_OPTIONS = () => [{
  value: 'comment',
  label: tx('auto.k_700405ffd3ef')
}, {
  value: 'reaction',
  label: tx('auto.k_fc077bcf6e2e')
}, {
  value: 'both',
  label: tx('auto.k_d9ec30e8e1ab')
}];

export const createAutomationRuleDraft = ({ includeAdminFields = false } = {}) => ({
  name: '',
  rule_type: 'keyword',
  channel: 'all',
  priority: 100,
  is_active: true,
  match_type: 'contains',
  match_pattern: '',
  match_case_sensitive: false,
  schedule_days: ['sun', 'mon', 'tue', 'wed', 'thu'],
  schedule_start_time: '20:00',
  schedule_end_time: '08:00',
  schedule_timezone: 'Africa/Tripoli',
  response_type: 'text',
  response_text: '',
  cooldown_seconds: 300,
  target_post_id: '',
  target_page_id: '',
  response_action: 'comment',
  dm_text: '',
  trigger_on: 'comment',
  auto_like: false,
  auto_like_type: 'like',
  ...(includeAdminFields ? {
    tenant_id: '',
    response_template_name: '',
    response_template_language: 'ar'
  } : {})
});

export const formatAutomationCooldown = (seconds) => {
  if (seconds < 60) return tx('auto.k_1f60a68a8aa8', { value1: seconds });
  if (seconds < 3600) return tx('auto.k_4d9316595110', { value1: Math.floor(seconds / 60) });
  return tx('auto.k_3d8290991a34', { value1: Math.floor(seconds / 3600) });
};
