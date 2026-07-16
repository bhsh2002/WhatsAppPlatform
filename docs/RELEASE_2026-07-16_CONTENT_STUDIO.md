# Facebook Content Studio release

This release adds a complete Facebook content-planning and publication
workspace while preserving the existing live post/comment tools.

## User-visible changes

- Publishing calendar and retry/cancel actions.
- Manual and product-derived content library with approval and archive states.
- Shared use of Messenger Bot products without duplicated product records.
- Reviewable conversion of an existing Facebook post into a shared product,
  including extracted text, image, link, source linkage, and mandatory
  price/category/SKU approval checks.
- Import and copy actions for existing posts, plus independent draft campaigns,
  rescheduling, and source-linked publication history.
- Direct tools for rewrite, variants, call-to-action improvement, hashtags,
  shortening, and tone changes. Results are always new drafts and never modify
  the original post.
- A complete live composer with page selection, text/link/image modes, shared
  products, preview, local draft save, scheduling, and direct publishing.
- Comment reply templates, suggested replies, and durable follow-up markers,
  while preserving direct replies, hide/show, delete, and like actions.
- Sequential or random rotation campaigns for content, products, or both.
- Page-aware schedules, daily limits, no-repeat windows, and automatic pause
  after repeated failures.
- Optional writing assistant with generation, rewrite, variants, brand rules,
  page overrides, review-state creation, and credit billing.
- Server-side provider failover with Gemini and OpenAI adapters.
- Neutral tenant-facing assistant status and errors that never disclose
  provider names, model identifiers, quota messages, or upstream links.
- Responsive card layouts for long text and mobile screens.
- Existing Facebook post, comment, reply, reaction, and automation management
  remains available in the studio.

## Deployment impact

- Database migration count increases from 40 to 41.
- Rebuild both server and client images.
- `GEMINI_API_KEY` and `OPENAI_API_KEY` are optional individually. At least one
  key in the configured provider order is required for the writing assistant.
- The default provider order is Gemini first and OpenAI second. A missing key
  is skipped without affecting the rest of Content Studio.
- `AI_PRIMARY_PROVIDER`, `AI_FALLBACK_PROVIDER`, provider models/base URLs,
  `AI_PROVIDER_TIMEOUT_MS`, `CONTENT_SCHEDULER_INTERVAL_MS`, and
  `CONTENT_SCHEDULER_BATCH_SIZE` have safe defaults and can be overridden.
- Automatic publication is a background job and must not be disabled in
  production.
- A verified database backup is required before applying migration 041.

## Verification gate

- Full server test suite.
- Client lint and production build.
- Fresh and upgrade migration checks with zero pending migrations.
- Browser desktop/mobile checks for all studio tabs and dialogs.
- Direct and proxied health checks.
- One test-page scheduled publication with one matching billing ledger entry.
- One existing-post import, copy, draft campaign, writing-tool draft, converted
  product draft, and source-filtered publication-history check.
- One comment-template and follow-up lifecycle check.

The full operating and recovery contract is in
[FACEBOOK_CONTENT_STUDIO.md](FACEBOOK_CONTENT_STUDIO.md).
