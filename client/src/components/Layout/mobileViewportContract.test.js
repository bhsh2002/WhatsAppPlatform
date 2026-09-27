import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = relativePath => readFileSync(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  'utf8',
);

test('mobile layout owns the header and dynamic viewport height calculation', () => {
  const layout = source('./MainLayout.jsx');

  assert.match(layout, /const mobileHeaderHeight = 48;/);
  assert.match(layout, /'--wa-mobile-header-height': `\$\{mobileHeaderHeight\}px`/);
  assert.match(layout, /height: \{ xs: '100dvh', md: 'auto' \}/);
  assert.match(layout, /overflowY: \{ xs: 'hidden', md: 'visible' \}/);
  assert.match(layout, /pt: \{ xs: 'var\(--wa-mobile-header-height\)', md: 0 \}/);
  assert.match(layout, /height: \{ xs: 'calc\(100dvh - var\(--wa-mobile-header-height\)\)', md: 'auto' \}/);
});

test('full-height conversation pages consume their parent height on mobile', () => {
  const conversationPages = [
    '../../pages/Inbox/UnifiedInbox.jsx',
    '../../pages/TenantPortal/TenantInbox.jsx',
    '../../pages/WhatsAppChat/WhatsAppChat.jsx',
    '../../pages/Facebook/MessengerInbox.jsx',
    '../../pages/TenantPortal/TenantChat.jsx',
  ];

  for (const page of conversationPages) {
    const contents = source(page);
    assert.match(contents, /height:\s*\{\s*xs: '100%',\s*md: '100dvh'\s*\}/, page);
    assert.doesNotMatch(contents, /calc\(100vh - (?:48|56)px\)/, page);
  }
});
