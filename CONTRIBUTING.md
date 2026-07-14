# Contributing

## Before opening a pull request

Run the same checks enforced by CI:

```bash
cd server
npm ci
npm run test:coverage
npm audit --audit-level=low

cd ../client
npm ci
npm run lint
npm run build
npm audit --audit-level=low

cd ..
docker compose config --quiet
docker build --tag whatsapp-platform-server:local server
docker build --tag whatsapp-platform-client:local client
git diff --check
```

The Docker builds require a running daemon. CI always runs them even when a
local contributor can only validate the Compose configuration.

The server coverage command counts every JavaScript file under
`routes/services/middleware/db`, including files that tests do not load. The
current CI floors are 48% statements/lines, 65% branches, and 70% functions;
new tests should raise these floors over time rather than narrowing the include
surface.

Never commit `.env` files, SQLite databases, uploads, logs, access tokens,
private keys, or generated build output. CI scans the complete Git history with
a checksum-verified Gitleaks release. If a real secret is ever committed,
rotate it immediately; removing it in a later commit is not sufficient.

## Changes and migrations

- Keep changes scoped to one concern and preserve unrelated worktree changes.
- Add a forward-only SQL migration for schema changes; do not edit an already
  deployed migration unless the change explicitly repairs an unreleased state.
- Use temporary databases and test fixtures outside automatic test discovery
  for integration tests. Never point tests at `server/db/platform.db`.
- Add regression coverage for authentication, tenant ownership, billing,
  migrations, Meta error handling, or deletion behavior when those areas change.

## Commit messages

Use an imperative Conventional Commit subject:

```text
fix(auth): reject revoked browser sessions
feat(billing): add reconciliation pagination
test(meta): cover invalid upstream JSON
docs(deploy): document secure cookie topology
```

Prefer a small series of reviewable commits over a single mixed commit. A pull
request should explain risk, migration/rollback impact, and the verification
that was run. Do not bypass failing security, test, lint, build, or secret-scan
checks.
