# Wa Savana production runbook (Caddy)

This path is for the production host only. It does not use the company-server
Nginx Proxy Manager network or copy any database, upload, environment file, or
secret from the company or monitoring hosts.

## Release gate

1. Require a green GitHub Actions run for the exact full commit SHA.
2. Record the digests produced from that same SHA for
   `ghcr.io/bhsh2002/savana-wa-server` and
   `ghcr.io/bhsh2002/savana-wa-client`.
3. Confirm GitHub reports both packages as `private`, and confirm an anonymous
   manifest request is denied. The one-time bootstrap also requires both
   packages to be unlinked so the public source repository cannot supply their
   visibility.
4. Verify the images' OCI revision labels match the SHA. Never deploy `latest`
   or another mutable tag.
5. Keep `SAVANA_INTEGRATIONS_ENABLED=false` for the first smoke test. Enable it
   only after Connect and Subscriptions are healthy on
   `savana-control-plane-network` and all four integration secrets have been
   registered on both sides.

Before merging the one-time package-bootstrap release, install
`GHCR_BOOTSTRAP_PAT` as a repository Actions secret. It must be a short-lived
personal access token (classic) owned by `bhsh2002` with only
`write:packages`; GitHub must not add `repo` or `delete:packages`. The secret
must exist before the merge-triggered `main` CI completes, because the release
workflow starts automatically from that successful run. After both packages
pass the private/unlinked and anonymous-access gates, add
`bhsh2002/WhatsAppPlatform` with role `Write` under **Manage Actions access**
for each package. Do not select **Inherit access from repository**. Revoke the
bootstrap token and remove the secret immediately; a follow-up release change
must use `GITHUB_TOKEN` before any later commit reaches `main`.

## One-time host preparation

Grant the deployment operator Docker access without making the socket public,
then close and reopen the SSH session before continuing:

```bash
sudo usermod -aG docker bahaa
exit
```

In the new session, require both commands to succeed before creating data paths:

```bash
id -nG | tr ' ' '\n' | grep -x docker
docker info >/dev/null
sudo install -d -m 0755 /srv/wa-savana/releases
sudo install -d -m 0700 -o bahaa -g bahaa /srv/wa-savana/shared
sudo install -d -m 2770 -o 1000 -g bahaa \
  /srv/wa-savana/shared/data \
  /srv/wa-savana/shared/data/backups \
  /srv/wa-savana/shared/uploads
docker network inspect savana-control-plane-network
```

Copy `ops/production-compose.env.example` and
`ops/production-runtime.env.example` to the paths documented in those files.
Generate every secret independently on the production host, set both files to
mode `0600`, and leave `BOOTSTRAP_ADMIN_PASSWORD` present only for the first
boot. The environment validator rejects missing, short, reused, insecure, or
misrouted production values without printing their contents.
The two private bind mounts use an SELinux `Z` relabel. Their setgid mode keeps
new backup files in the deployment operator's group while UID 1000 remains the
owner required by the non-root server process on enforcing AlmaLinux hosts.

Create a release checkout for the approved commit. From that checkout run:

```bash
WA_COMPOSE_ENV_FILE=/srv/wa-savana/shared/production-compose.env \
  ./tools/deploy_production.sh
```

The deploy command validates immutable image digests, the external Control
Plane network, the runtime environment inside the release image, resource and
security settings, loopback health, and authenticated metrics. Only the
frontend is published, at `127.0.0.1:3133`; the API and Control Plane remain on
private Docker networks.

After the first login, rotate the administrator password, remove
`BOOTSTRAP_ADMIN_PASSWORD` from the runtime file, and rerun the deploy command.

## Caddy activation

The production Caddy service must be healthy before WA is added. Resolve any
existing reload error first and confirm its journal is writable. The supplied
site logs to stdout/journald and therefore does not add a file-log ownership or
rotation dependency.

Install `ops/caddy/wa.savana.ly.caddy` in the host's imported Caddy directory,
then validate the complete configuration before a reload:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
sudo systemctl is-active --quiet caddy
curl --fail --silent --show-error https://wa.savana.ly/api/health
```

Keep a copy of the previous full Caddy configuration. If validation or reload
fails, restore that copy and reload; do not leave a partially edited file. The
public edge deliberately returns 404 for `/api/metrics`. Prometheus must scrape
`http://127.0.0.1:3133/api/metrics` through the host/tunnel with the bearer token.

## Functional checks before traffic

- `/api/health` reports no pending migrations.
- Anonymous `/api/auth/session` behaves as expected, login succeeds, and the
  secure session cookie is returned only over HTTPS.
- Meta verifies `https://wa.savana.ly/api/webhook`, a signed webhook is
  accepted, and an invalid signature is rejected.
- Facebook OAuth returns to `https://wa.savana.ly/auth/facebook/callback`.
- SMS callbacks use
  `https://wa.savana.ly/api/integrations/sms-gateway/events`.
- Metrics require the dedicated bearer token and contain no tenant/message
  labels or secret values.
- After Control Plane activation, binding, entitlement refresh, callback
  authentication, and outbox delivery all pass over the private network.

## Rollback

Before every later deployment the script creates a SQLite online backup when a
database and running container already exist. To roll back code that applied no
migration, restore the previous two image digests and release SHA in the
Compose environment file and deploy again. To roll back a schema-changing
release, stop WA, verify the selected backup checksum, restore its database to
a separate file, then atomically replace `platform.db` while the container is
stopped before deploying the previous images.

Never run `docker compose down -v`, delete `/srv/wa-savana/shared`, or reuse the
monitoring server's WA database. The monitoring copy and its data remain
separate and untouched.
