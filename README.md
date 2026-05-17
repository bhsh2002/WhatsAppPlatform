# WhatsApp Platform Operations Notes

## Required server environment

The server fails fast when required secrets are missing or unsafe. Before running
`server/server.js`, configure `server/.env` from `server/.env.example` and make
sure these values are set:

- `JWT_SECRET`: a non-placeholder secret with at least 32 characters.
- `CRYPTO_KEY`: exactly 64 hex characters, generated from 32 random bytes.

Generate safe local values with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use one generated value for `JWT_SECRET` and another for `CRYPTO_KEY`.

## Database tracking

SQLite database files are local runtime state and should not be committed.
Schema changes belong in SQL migrations under `server/db/migrations`.
