Isolated WA integration UI fixture

Use the project's pinned Node22.23.5, without starting the application backend:
/Users/savana/Dev/.tools/whatsapp/node-v22.23.5-darwin-arm64/bin/node client/scripts/serve-integration-fixture.mjs

Open only the printed 127.0.0.1 URL in a new browser tab. The fixture mounts
actual integration, inbox and product-picker components with synthetic data.
It does not mount AuthProvider or load a real session or backend.
The Vite config/environment/proxy are not used. The server binds loopback only,
rejects /api requests, and sends a CSP with connect-src none. API methods are
mocked; unknown methods, sends, uploads, fetch/XHR and beacon are blocked.
EventSource is inert. No real message, publication, campaign or invitation is
sent. The local output shows counters; a send guard test should not increase
the blocked API counter because the guard must stop before reaching an API.

Manual acceptance procedure:
1. Focus the unavailable POS card and press Return. POS must remain selectable.
2. Open Why? with Return. Inspect simultaneous blockers and executor limitation.
   Tab through controls, Escape/Close, and verify focus returns to the opener.
3. Inspect Catalog's reviewed content: its status must say Reviewed; not executed.
4. Run the fixture accessibility audit. Results list violations and incomplete
   rules separately. A zero-violation audit is not full screen-reader acceptance.
5. Show inbox, Review in conversation, then Send message and an interactive
   message. Both must show review-only warnings without reaching a send API.
6. Close review; the composer must clear. No channel fallback should occur.
7. Show product picker. Missing-currency and archived rows stay visible and
   explain why they cannot prepare a draft. Their activation must leave the
   fixture's Product draft unchanged. A ready row preserves its explicit USD.
8. Stop the fixture with Ctrl+C. It does not publish/build/deploy the app.

Captured acceptance on 17 November 2026 is in the external WA-Savana handoff
folder. File/image/template send modes, real central acceptance, mobile viewport
and actual screen-reader speech were not tested by that browser run.
