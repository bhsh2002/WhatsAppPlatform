// Loopback-only UI acceptance fixture. It never starts the application server
// or loads its Vite proxy/env configuration. APIs and network are blocked.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  envDir: false,
  plugins: [react(), {
    name: 'fixture-api-deny',
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/api')) {
          res.statusCode = 403;
          res.end('Synthetic fixture: backend requests are prohibited');
          return;
        }
        next();
      });
    },
  }],
  server: {
    host: '127.0.0.1', port: 0, strictPort: true, hmr: false,
    fs: { strict: true, allow: [root] },
    headers: {
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'",
    },
  },
});
await server.listen();
console.log(`Synthetic UI fixture: http://127.0.0.1:${server.httpServer.address().port}/browser-tests/integration-fixture.html`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  await server.close();
  process.exit(0);
});
