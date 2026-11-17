import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider, CssBaseline, Button, Stack, Alert, Box } from '@mui/material';
import axe from 'axe-core';
import api from '../src/api/index';
import { LanguageProvider } from '../src/context/LanguageContext';
import { createAppTheme } from '../src/theme';
import TenantPosIntegration from '../src/pages/TenantPortal/TenantPosIntegration';
import TenantInbox from '../src/pages/TenantPortal/TenantInbox';
import IntegratedProductPicker from '../src/components/Inbox/IntegratedProductPicker';
import { createOwnerOperationFixture, ownerFixtureStatus } from './sharedReadOwnerFixture';

// Never import App/AuthProvider or contact a backend. No real identity, token,
// organization, product, recipient or account is loaded by this fixture.
const fixtureLanguage = new URLSearchParams(window.location.search).get('lang') === 'ar' ? 'ar' : 'en';
localStorage.setItem('wa_savana_language', fixtureLanguage);
const calls = [];
const blocked = [];
let sharedScenario = 'active';
let setupScenario = 'disabled';
let enrollmentScenario = 'unregistered';
let ownerScenario = 'disabled';
let ownerHeld = false;
let ownerOperationScenario = 'success';
let readerReady = false;
const ownerOperations = createOwnerOperationFixture();
const enrollmentDocument = () => ({ state: enrollmentScenario,
  enrollment: enrollmentScenario === 'completed' ? { enrollment_id: 'synthetic-public-enrollment', version: 1,
    unused_key_marker: 'NEVER_RENDER_SYNTHETIC_KEY_MATERIAL' } : null,
  requires_reconciliation: ['prepared', 'inflight', 'unknown'].includes(enrollmentScenario),
  reconciliation_available: false, grants_created: false });
const sharedContext = () => ({
  scope: { organization_id: 'synthetic-organization', activity_id: 'synthetic-activity' },
  consumer_platform: 'wa_savana', authorization_revision: 'a'.repeat(64),
  checked_at: new Date().toISOString(), valid_until: new Date(Date.now() + 300_000).toISOString(),
});
const sharedRecord = (state = 'active') => ({
  scope: { organization_id: 'synthetic-organization', activity_id: 'synthetic-activity' },
  entity_type: 'product', entity_id: 'synthetic-central-product-stable-identity', domain: 'product.core',
  source: { installation_id: 'synthetic-catalog-source-installation-0001', entity_type: 'product', local_entity_id: 'synthetic-native-product-1' },
  version: state === 'active' ? 3 : state === 'archived' ? 4 : 5,
  ownership_epoch: 1, expected_version: 2, source_revision: `catalog-${state}`,
  observed_at: new Date().toISOString(), received_at: new Date().toISOString(),
  state, freshness: 'current', field_visibility: 'explicit_grants_only',
  data: { name: state === 'tombstone' ? 'NEVER_RESTORE_TOMBSTONE_OLD_NAME' : 'Synthetic centrally permitted product', online_price: null, base_unit: null },
});
const sharedDocument = (changes = false) => {
  if (['disabled', 'denied', 'unavailable'].includes(sharedScenario)) {
    const error = new Error('Synthetic shared read unavailable');
    error.status = sharedScenario === 'denied' ? 403 : 503;
    error.data = { error: { code: sharedScenario === 'disabled' ? 'shared_product_reads_disabled' : 'synthetic_read_unverified' }, clear_previous: true };
    throw error;
  }
  const record = sharedRecord(['archived', 'tombstone'].includes(sharedScenario) ? sharedScenario : 'active');
  return {
    spec_version: '1.0', context: sharedContext(), enabled: true, read_only: true,
    execution_ready: false, pricing_use_allowed: false, has_more: false,
    ...(changes ? { changes: [{ cursor: record.version, record }], cursor: record.version } : { records: [record], next_cursor: null }),
  };
};
const request = {
  id: 1, platform_code: 'catalog', request_kind: 'notification_request',
  request_key: 'synthetic-review-1', status: 'pending_review',
  review_only: true, execution_ready: false,
  payload: { request_id: 'synthetic-review-1', recipient: { phone_e164: '+15550000001' }, message: 'Synthetic review draft. Do not send.', requires_review: true, consent_asserted: false },
};
const capability = (id, kind) => ({
  capability_id: id, request_kind: kind, visible: true,
  can_request_review: false, can_execute: false,
  review_blockers: [{ code: 'context_scope_unverified', message: 'Synthetic activity scope has not been verified.' }],
  execution_blockers: [
    { code: 'adapter_execution_not_implemented', message: 'Review only. Cross-platform execution awaits its contract and executor.' },
    { code: 'account_unverified', message: 'A verified sending account is required.' },
    { code: 'consent_unverified', message: 'A phone number does not prove consent.' },
  ],
});
const products = [
  { canonical_product_id: 'synthetic-valid', name: 'Synthetic valid product', price: '12.125', currency: 'USD', pricing_ready: true, is_active: true, can_prepare_product_message: true },
  { canonical_product_id: 'synthetic-incomplete', name: 'Synthetic missing currency', price: '7', currency: null, pricing_ready: false, is_active: false, can_prepare_product_message: false },
  { canonical_product_id: 'synthetic-archived', name: 'Synthetic archived product', price: '9', currency: 'USD', pricing_ready: true, is_active: false, can_prepare_product_message: false, preparation_blockers: [{ code: 'product_inactive', message: 'The authoritative product copy is inactive.' }] },
];
const platforms = ['pos', 'catalog', 'sawemly'].map(code => ({
  platform_code: code, available: code !== 'pos',
  connection_id: code === 'catalog' ? 'synthetic-catalog-link' : null,
  remote_external_tenant_id: code === 'catalog' ? 'synthetic-catalog-account' : null,
  status: code === 'catalog' ? 'active' : 'disconnected',
  subscription_entitled: code === 'catalog' ? true : false,
  scopes: code === 'catalog' ? ['catalog.products.projection'] : [], entitled: code === 'catalog',
  capabilities: [capability('wa_savana.notifications.send', 'notification_request'), capability('wa_savana.campaigns.send', 'campaign_request'), capability('wa_savana.content.publish', 'content_publication')],
}));
const capture = () => {
  const status = document.getElementById('fixture-network-status');
  if (status) status.textContent = `Mock API calls: ${calls.length}. Blocked mutations/network: ${blocked.length}. External effects: 0.`;
};
const deny = what => {
  blocked.push(what);
  capture();
  throw new Error(`Synthetic fixture blocked: ${what}`);
};
window.fetch = async () => deny('fetch');
window.XMLHttpRequest = class { open() { deny('XMLHttpRequest'); } };
window.EventSource = class { addEventListener() {} close() {} };
navigator.sendBeacon = () => { deny('sendBeacon'); };
api.getMediaToken = async () => null;
api.getSseUrl = async () => '/synthetic-no-network-events';
api.request = async (endpoint, options = {}) => {
  const path = endpoint.split('?')[0];
  const method = options.method || 'GET';
  calls.push({ path, method });
  capture();
  if (method !== 'GET') {
    if (path === '/api/portal/integrations/shared-read-setup/owner/operations' && method === 'POST'
      && options.headers?.['X-Savana-Owner-Intent'] === 'shared-read-setup-v1' && ownerScenario === 'connected' && !ownerHeld && !ownerOperations.held()) {
      return ownerOperations.dispatch(JSON.parse(options.body || '{}'), ownerOperationScenario);
    }
    if (path === '/api/portal/integrations/shared-read-setup/reader' && method === 'POST'
      && options.headers?.['X-Savana-Owner-Intent'] === 'shared-read-setup-v1' && setupScenario === 'connected' && enrollmentScenario === 'completed') {
      const result = ownerOperations.bind(JSON.parse(options.body || '{}'));
      readerReady = true;
      return result;
    }
    if (path === '/api/portal/integrations/shared-read-setup/owner/login' && method === 'POST'
      && options.headers?.['X-Savana-Owner-Intent'] === 'shared-read-setup-v1' && ownerScenario !== 'disabled' && !ownerHeld) {
      const valid = Boolean(JSON.parse(options.body || '{}').username && JSON.parse(options.body || '{}').password);
      if (!valid) throw Object.assign(new Error('Synthetic invalid sign in'), { status: 422 });
      await new Promise(resolve => window.setTimeout(resolve, 250));
      ownerScenario = 'connected';
      return ownerFixtureStatus(ownerScenario);
    }
    if (path === '/api/portal/integrations/shared-read-setup/owner/disconnect' && method === 'POST'
      && options.headers?.['X-Savana-Owner-Intent'] === 'shared-read-setup-v1' && !ownerHeld
      && Object.keys(JSON.parse(options.body || '{}')).length === 0) {
      ownerScenario = 'disconnected';
      return ownerFixtureStatus(ownerScenario);
    }
    if (path === '/api/portal/integrations/shared-read-setup/enrollment' && method === 'POST'
      && setupScenario === 'connected' && enrollmentScenario === 'unregistered'
      && options.headers?.['X-Savana-Owner-Intent'] === 'shared-read-setup-v1' && options.body === undefined) {
      enrollmentScenario = 'completed';
      return enrollmentDocument();
    }
    if (path === '/api/portal/integrations/shared-read-setup/disconnect' && method === 'POST'
      && options.headers?.['X-Savana-Owner-Intent'] === 'shared-read-setup-v1' && options.body === undefined) {
      setupScenario = 'disconnected';
      return { disconnected: true, central_read_grant_revoked: false, source_publisher_key_revoked: false,
        read_only: true, execution_ready: false, pricing_use_allowed: false };
    }
    if (path === '/api/portal/integrations/message-requests/1/accept' && method === 'POST') {
      request.status = 'approved';
      return { accepted: true, status_queued: true, status_published: false, request: { ...request } };
    }
    return deny(`${method} ${path}`);
  }
  if (path === '/api/portal/integrations/shared-read-setup/owner') return ownerFixtureStatus(ownerScenario, ownerHeld || ownerOperations.held());
  if (path === '/api/portal/integrations/shared-read-setup/owner/overview') {
    if (ownerScenario !== 'connected') throw Object.assign(new Error('Synthetic owner not connected'), { status: 403 });
    return ownerOperations.overview(ownerHeld || ownerOperations.held());
  }
  if (path.startsWith('/api/portal/integrations/shared-read-setup/owner/intents/by-key/')) return ownerOperations.lookup(decodeURIComponent(path.split('/intents/by-key/')[1]));
  if (path.startsWith('/api/portal/integrations/shared-read-setup/owner/intents/')) return ownerOperations.lookup(decodeURIComponent(path.split('/intents/')[1]));
  if (path === '/api/portal/integrations/binding') return { bound: true, binding: { organization_name: 'Synthetic organization' } };
  if (path === '/api/portal/integrations/incoming-connections') return { data: [] };
  if (path === '/api/portal/integrations/platforms') return { data: platforms };
  if (path.endsWith('/diagnostics')) return { counts: { pending_service_requests: 1 }, outbox: { counts: {} } };
  if (path.endsWith('/service-requests')) return { data: [
    { ...request }, { id: 2, request_kind: 'content_publication', request_key: 'synthetic-content', status: 'approved', payload: { text: 'Synthetic reviewed content', channels: ['facebook'] } },
  ] };
  if (path.endsWith('/candidates')) return { target_platform_code: path.split('/').at(-2), organizations: [] };
  if (path === '/api/portal/integrations/message-requests') return { data: [{ ...request }] };
  if (path === '/api/portal/integrations/products') return { data: products };
  if (path === '/api/portal/integrations/shared-read-setup') return {
    enabled: setupScenario !== 'disabled', read_ready: readerReady, read_only: true, execution_ready: false, pricing_use_allowed: false,
    session: { state: setupScenario === 'disabled' ? 'disconnected' : setupScenario },
    requests: [], options: {}, ...(setupScenario === 'disabled' ? {} : { enrollment: enrollmentDocument() }),
    actions: { authorize: setupScenario !== 'disabled' && setupScenario !== 'authorizing', disconnect: !['disabled', 'disconnected'].includes(setupScenario),
      enroll_consumer: setupScenario === 'connected' && enrollmentScenario === 'unregistered',
      bind_reader: setupScenario === 'connected' && enrollmentScenario === 'completed' },
  };
  if (path === '/api/portal/integrations/shared-products') return sharedDocument();
  if (path === '/api/portal/integrations/shared-product-changes') return sharedDocument(true);
  if (path === '/api/portal/unified/conversations') return [{ channel: 'whatsapp', contact_id: '15550000001', display_name: 'Synthetic contact', last_message: 'Synthetic conversation', unread_count: 0 }];
  if (path.endsWith('/messages')) return [];
  if (path === '/api/portal/templates') return [];
  if (path.includes('window-status') || path.includes('/window/')) return { is_open: true };
  return deny(`Unmapped GET ${path}`);
};

export const Fixture = () => {
  const [page, setPage] = useState('integrations');
  const [audit, setAudit] = useState('Not run');
  const [productOpen, setProductOpen] = useState(false);
  const [productDraft, setProductDraft] = useState('No product draft prepared');
  const [focus, setFocus] = useState('None');
  const [sharedMode, setSharedMode] = useState('active');
  const [setupMode, setSetupMode] = useState('disabled');
  const [enrollmentMode, setEnrollmentMode] = useState('unregistered');
  const [ownerMode, setOwnerMode] = useState('disabled');
  const [operationMode, setOperationMode] = useState('success');
  const runAudit = async () => {
    const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
    setAudit(JSON.stringify({ violations: result.violations.map(row => ({ id: row.id, impact: row.impact, help: row.help, targets: row.nodes.map(node => node.target) })), passes: result.passes.length, incomplete: result.incomplete.map(row => row.id) }));
  };
  return (
    <ThemeProvider theme={createAppTheme(fixtureLanguage === 'ar' ? 'rtl' : 'ltr')}>
      <CssBaseline />
      <LanguageProvider>
        <Box onFocusCapture={event => setFocus(event.target.getAttribute('aria-label') || event.target.textContent?.trim().slice(0, 100) || event.target.tagName)}>
          <Alert severity="info">Synthetic acceptance fixture. All external effects are blocked; no backend or real session is used.</Alert>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ m: 1 }}>
            <Button variant="contained" onClick={() => setPage('integrations')}>Show integration fixture</Button>
            <Button variant="contained" onClick={() => setPage('inbox')}>Show inbox fixture</Button>
            <Button variant="contained" onClick={runAudit}>Run accessibility audit</Button>
            <Button variant="contained" onClick={() => setProductOpen(true)}>Show product picker</Button>
          </Stack>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ m: 1 }} aria-label="Synthetic shared read scenarios">
            {['active', 'archived', 'tombstone', 'disabled', 'denied', 'unavailable'].map(value => <Button key={value} variant={sharedMode === value ? 'contained' : 'outlined'} sx={sharedMode === value ? {} : { color: 'primary.dark' }} onClick={() => { sharedScenario = value; setSharedMode(value); }}>Shared {value}</Button>)}
          </Stack>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ m: 1 }} aria-label="Synthetic setup session scenarios">
            {['disabled', 'disconnected', 'authorizing', 'connected', 'unknown', 'expired', 'revoked'].map(value => <Button key={value} variant={setupMode === value ? 'contained' : 'outlined'} sx={setupMode === value ? {} : { color: 'primary.dark' }} onClick={() => { setupScenario = value; setSetupMode(value); }}>Setup {value}</Button>)}
          </Stack>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ m: 1 }} aria-label="Synthetic enrollment scenarios">
            {['unregistered', 'prepared', 'inflight', 'unknown', 'completed', 'failed'].map(value => <Button key={value} variant={enrollmentMode === value ? 'contained' : 'outlined'} sx={enrollmentMode === value ? {} : { color: 'primary.dark' }} onClick={() => { enrollmentScenario = value; setEnrollmentMode(value); }}>Enrollment {value}</Button>)}
          </Stack>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ m: 1 }} aria-label="Synthetic owner session scenarios">
            {['disabled', 'disconnected', 'connected', 'unknown', 'held'].map(value => <Button key={value} variant={ownerMode === value ? 'contained' : 'outlined'} sx={ownerMode === value ? {} : { color: 'primary.dark' }} onClick={() => { ownerScenario = value === 'held' ? 'connected' : value; ownerHeld = value === 'held'; setOwnerMode(value); }}>Owner {value}</Button>)}
          </Stack>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ m: 1 }} aria-label="Synthetic owner operation scenarios">
            {['success', 'unknown', 'not-found', 'stale-review'].map(value => <Button key={value} variant={operationMode === value ? 'contained' : 'outlined'} sx={operationMode === value ? {} : { color: 'primary.dark' }} onClick={() => { ownerOperationScenario = value; setOperationMode(value); }}>Owner operation {value}</Button>)}
          </Stack>
          <Box component="main">
            <MemoryRouter>{page === 'integrations' ? <TenantPosIntegration /> : <TenantInbox />}</MemoryRouter>
          </Box>
          <IntegratedProductPicker open={productOpen} onClose={() => setProductOpen(false)} products={products} onSelect={message => setProductDraft(message)} />
          <Box component="aside" aria-label="Fixture diagnostics" sx={{ p: 2 }}>
            <p id="fixture-network-status">Mock API calls: 0. Blocked mutations/network: 0. External effects: 0.</p>
            <p>Focused control: {focus}</p>
            <p>Product draft: {productDraft}</p>
            <output aria-label="Accessibility audit result">{audit}</output>
          </Box>
        </Box>
      </LanguageProvider>
    </ThemeProvider>
  );
};
createRoot(document.getElementById('root')).render(<Fixture />);
