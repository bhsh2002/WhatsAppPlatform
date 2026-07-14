# Prometheus integration

The server exposes Prometheus text metrics at direct path `/metrics`. Through
the production Nginx `/api` proxy, use `/api/metrics`. Scraping is disabled and
returns 404 until `METRICS_TOKEN` is set to a dedicated random value of at least
32 characters.

Store the token in a mounted secret file and configure Prometheus without
putting it in the URL:

```yaml
scrape_configs:
  - job_name: whatsapp-platform
    scheme: https
    metrics_path: /api/metrics
    authorization:
      type: Bearer
      credentials_file: /run/secrets/whatsapp_metrics_token
    static_configs:
      - targets: [wa.example.com]
```

Load `whatsapp-platform.rules.yml` into Prometheus and route alerts through the
deployment's Alertmanager. The metrics contain aggregate counts only: no tenant
IDs, message payloads, access tokens, phone numbers, or dynamic resource labels.

The JSON endpoints `/api/settings/metrics` and `/api/settings/alerts` remain
available to authenticated administrators for interactive diagnosis.
