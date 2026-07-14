# Wa Savana Web Client

React/Vite frontend for the WhatsApp Platform. Browser API calls use the
same-origin `/api` prefix. Vite removes that prefix and proxies to Express in
development; production Nginx uses the same contract.

Authentication is cookie-based for browsers. The server sets an HttpOnly
session cookie and the client sends it with `credentials: include`; no JWT is
persisted in browser storage. Keep the `/api` proxy and HTTPS enabled in
production so the cookie path and `Secure` policy remain valid.

## Development

Start the backend first, then run:

```bash
npm install
npm run dev
```

The client is served on Vite's displayed port (normally 5173). Requests such
as `/api/health` are proxied to `http://localhost:3031/health`.

### Development accessibility audit

Append `?axe=1` to a direct development route, for example
`http://127.0.0.1:5173/portal?axe=1`. After the page settles, the development-
only harness runs `axe-core` and writes a compact JSON report to the hidden
`#axe-audit-result` output element. The browser console can rerun the current
page with `window.__runAxeAudit()` after opening a dialog or loading richer
data. The harness and `axe-core` are excluded from production builds by the
`import.meta.env.DEV` gate.

## Verification

```bash
npm run lint
npm run build
npm audit --audit-level=low
```

Production output is written to `dist/` and served by the client Nginx image.
Routes are loaded lazily and Nginx falls back to `index.html` for SPA paths.
