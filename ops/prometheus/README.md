# Prometheus integration

The server exposes Prometheus text metrics at direct path `/metrics`. Through
the containerized frontend `/api` proxy, use `/api/metrics`. A dedicated random
`METRICS_TOKEN` of at least 32 characters is mandatory in production.

Store the token in a mounted secret file and configure Prometheus without
putting it in the URL:

```yaml
scrape_configs:
  - job_name: whatsapp-platform
    scheme: http
    metrics_path: /api/metrics
    authorization:
      type: Bearer
      credentials_file: /run/secrets/whatsapp_metrics_token
    static_configs:
      - targets: [127.0.0.1:3133]
```

The public Caddy site returns 404 for this path. Scrape the loopback endpoint on
the production host or through the monitoring SSH tunnel; never send the token
through the public edge.

Load `whatsapp-platform.rules.yml` into Prometheus and route alerts through the
deployment's Alertmanager. The metrics contain aggregate counts only: no tenant
IDs, message payloads, access tokens, phone numbers, or dynamic resource labels.

The JSON endpoints `/api/settings/metrics` and `/api/settings/alerts` remain
available to authenticated administrators for interactive diagnosis.
