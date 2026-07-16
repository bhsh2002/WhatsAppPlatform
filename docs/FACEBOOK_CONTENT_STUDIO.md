# Facebook Content Studio

Facebook Content Studio is the tenant workspace for planning, reviewing,
rotating, scheduling, and publishing Facebook Page content. It extends the
existing live post/comment manager without replacing it.

## What it includes

- A reviewable content library with manual, product-derived, and AI-generated
  items.
- One shared product catalog: the existing Messenger Bot products are reused
  directly. A second Facebook-only product table is not created.
- Existing Facebook posts can be reviewed and converted into products in that
  shared catalog.
- Existing posts can be imported into the content library, copied, used as the
  only source of an independent draft campaign, scheduled again, and inspected
  through their local publication history.
- Direct post writing tools create linked drafts for rewriting, variants,
  call-to-action improvement, hashtag suggestions, shortening, and tone
  changes. They never edit the remote post.
- A publication calendar with pending, processing, published, failed,
  cancelled, and skipped states.
- Direct scheduling from an approved library item or an available product.
- Durable campaigns that rotate library items, products, or both.
- Sequential or random rotation, configurable days/times, page time zones,
  daily caps, and no-repeat windows.
- A server-side writing assistant for generation, rewriting, and variants.
- Tenant-wide brand defaults with optional page-level overrides.
- Review controls, publication history, retry state, billing references, and
  automatic campaign pause after repeated failures.
- The existing live Facebook posts, comments, replies, reactions, and comment
  automation under the “Posts & comments” studio tab, extended with reply
  templates, suggested replies, and follow-up markers.

## Data and migration

Migration `040_facebook_content_studio.sql` adds:

- `facebook_content_settings`
- `facebook_content_items`
- `facebook_content_campaigns`
- `facebook_content_campaign_items`
- `facebook_content_publications`
- `facebook_content_ai_generations`

It also registers the `facebook.ai_generation` billing operation. The default
platform price is 5 credits per generation request. Administrators can change
the operation price through the existing billing price catalog; the UI does not
hard-code a price.

Migration `041_facebook_post_workflows.sql` extends that foundation with:

- approval and source-post fields on shared products;
- source-post fields on library items and writing-assistant history;
- the direct post writing actions;
- page-scoped and tenant-scoped comment reply templates;
- durable open/resolved comment follow-up markers.

The existing `bot_products` and `bot_product_images` tables remain the source of
truth for products and images.

## Converting a post into a product

The live “Posts & comments” tab exposes a product action on each post. Opening
it prepares a review form from the post data:

- attachment title or the first meaningful post line becomes the proposed
  product name;
- the post message becomes the description;
- the post image becomes the proposed product image;
- an attachment URL, or otherwise the Facebook permalink, becomes the proposed
  product URL.

The first save creates an inactive product draft linked to the source page,
post ID, and permalink. The user can then review the name, description,
currency, availability, URL, and image. Price, category, and SKU are mandatory
before the converted product can be approved and activated. Saving uses the
existing Messenger Bot product API, so the result appears in both Messenger and
Facebook Content Studio without creating a second Facebook-only product table.
No post is edited. A tenant cannot create two shared products from the same
source post.

Facebook CDN image URLs may be temporary. The review form therefore keeps the
image editable so it can be replaced with a permanent asset URL before saving.

## Existing-post workflows

Every remote post exposes the following actions to both administrators and the
owning tenant:

- add to the content library;
- create a separate library copy;
- convert to a linked shared-product draft;
- create an independent draft campaign from a linked library item;
- schedule the post content again through the durable publication queue;
- inspect local publication records derived from that source post;
- open one of the direct writing tools.

Importing a post creates a local draft containing the extracted text, image,
link, source post ID, and source permalink. Repeating “add to library” reuses
the existing active import, while “create copy” always creates a new draft.
Neither operation mutates the remote post.

A campaign created from a post uses `source_mode=library`, contains only the
imported library item, requires approval, and starts in `draft`. It has no
dependency on the shared product catalog.

Scheduling again approves the imported library item explicitly and creates a
normal durable publication. Publication billing, idempotency, retries, and
history therefore remain governed by the existing publication lifecycle.

## Direct writing tools

The post tools support:

- rewrite;
- create variants;
- improve the call to action;
- suggest hashtags;
- shorten;
- change tone.

The source post text, page profile, effective writing settings, optional task
instruction, and source identifiers are passed to the configured server-side
writing assistant. Every returned result is stored as a new `draft` library
item linked to the source post. Automatic approval settings do not bypass this
rule, and the original Facebook post is never edited automatically.

Suggested comment replies use the same provider failover, neutral error
handling, and `facebook.ai_generation` billing operation, but do not create a
content-library item.

## Post composer

The live post composer supports:

- choosing the target linked page;
- text, link, or image posts;
- selecting an active product from the shared catalog and prefilling its
  product facts;
- an on-screen preview;
- saving a local library draft;
- scheduling through the durable Content Studio publication queue, including
  the selected image, link, or product snapshot;
- immediate publication.

Uploaded draft images use the existing validated bot-asset upload path. Live
file publication continues to use the validated Facebook image-upload path.

## Comment operations

Existing direct reply, hide/show, delete, like, and reply-list operations remain
available. The extension adds:

- reusable tenant-wide or page-specific reply templates;
- a writing-assistant reply suggestion that only fills the reply editor until
  the user explicitly sends it;
- open/resolved follow-up markers scoped to the owning tenant and page.

The follow-up table stores post and comment identifiers plus an optional note;
it does not copy commenter names or comment bodies.

## Environment

The non-AI studio features require no new secret. Automatic scheduling uses
the same active Facebook Page access tokens already stored by the platform.

Writing-assistant provider order:

```dotenv
AI_PRIMARY_PROVIDER=gemini
AI_FALLBACK_PROVIDER=openai

GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-luna
OPENAI_BASE_URL=https://api.openai.com/v1

AI_PROVIDER_TIMEOUT_MS=30000
```

Scheduler controls:

```dotenv
CONTENT_SCHEDULER_INTERVAL_MS=60000
CONTENT_SCHEDULER_BATCH_SIZE=10
```

All provider keys stay on the server and are never exposed to the browser. The
primary provider is tried first when its key is configured. A missing primary
key is skipped. Provider transport, capacity, authentication, timeout, or
invalid-output failures can move the same request to the configured fallback.
Safety refusals and platform writing-policy violations do not trigger fallback.

Readiness exposes only whether the writing assistant is configured. Tenant
responses and generation history omit provider and model identities. Upstream
error messages, documentation links, quota text, and provider names are
replaced with neutral writing-assistant errors before reaching a tenant.

If neither configured provider has a key, readiness reports the assistant as
unavailable while the library, campaigns, calendar, product rotation, and
manual content remain operational.

When the assistant is used, the selected product facts, the user’s brief or
source text, and the effective brand-writing settings are sent to the configured
provider. Do not place secrets or unrelated personal data in those fields.
Gemini free-tier requests may be used by Google to improve its products; use a
paid provider tier or a provider approved by the company’s privacy policy for
customer-sensitive content.

## Settings inheritance

Each tenant has effective defaults for:

- time zone and content language;
- tone, brand voice, audience, and default call to action;
- required terms, banned terms, hashtags, and emoji level;
- manual, approved-only, or automatic approval policy;
- allowed days, publishing window, daily limit, and no-repeat period;
- assistant enablement and the failure count that auto-pauses a campaign.

A page can inherit those defaults or store a complete override. Removing the
override immediately returns the page to tenant defaults.

## Publication lifecycle

1. A direct schedule or due campaign creates a durable `pending` publication
   with a unique idempotency key.
2. The scheduler claims the record in an immediate SQLite transaction and moves
   it to `processing`.
3. Billing is reserved with an idempotency key tied to the publication.
4. The server publishes through the page token.
5. A successful Meta response records the remote post ID and commits billing.
6. A transient transport or Meta failure releases billing, returns the record
   to `pending`, and applies exponential backoff.
7. A permanent failure or exhausted retry limit moves the record to `failed`.
8. Repeated campaign failures pause that campaign automatically.

If Meta succeeds but the local billing commit fails, the remote post is marked
published with a reconciliation warning. The server never repeats the remote
mutation merely to repair billing, preventing duplicate Facebook posts.

Processing claims older than 15 minutes are recovered. Claims with a saved
remote post ID are finalized as published; claims without one return to the
pending queue.

## Campaign selection rules

- Library campaigns select items visible to the target page. When approval is
  required, only `approved` items are eligible.
- Product campaigns select active, available shared products, optionally
  restricted to one category.
- Mixed campaigns alternate the preferred source and fall back to the other
  source when necessary.
- Published items and products are excluded during the configured no-repeat
  window.
- A campaign advances its cursor only after materializing a publication.
- The page/day count is evaluated in the campaign time zone.
- A manually requested “Run now” creates a queued publication; the scheduler
  still owns the external mutation.

## Product templates

Product campaigns and direct product scheduling can use:

```text
{name}
{description}
{price} {currency}
{category}
{sku}
{url}
```

Unknown variables are not evaluated. Product facts are read from the shared
catalog at materialization time.

## Operations

The scheduler starts with the normal server background jobs. Set
`DISABLE_BACKGROUND_JOBS=true` only for isolated tests or a local environment
where automatic publication must not run.

Useful health and log checks:

```bash
curl -fsS http://127.0.0.1:3031/health
docker compose logs --since=15m --tail=300 server
```

The normal `/health` response must report 41 applied migrations and zero
pending migrations.

Before an upgrade:

```bash
docker compose run --rm --no-deps \
  -e BACKUP_DIR=/app/data/backups \
  server npm run backup
```

After rebuilding and starting the application, verify the studio through the
tenant portal:

1. Open Facebook Content Studio.
2. Confirm the linked-page, product, library, campaign, and failure counters.
3. Create and approve a harmless draft.
4. Schedule it for a test page.
5. Confirm the publication moves from scheduled to published and has a remote
   post ID.
6. Confirm the billing ledger contains exactly one matching operation.
7. From “Posts & comments”, convert a harmless test post into a product and
   confirm it appears as an inactive draft in both Messenger Bot and the studio
   product list.
8. Confirm the converted product cannot be approved until price, category, and
   SKU are complete.
9. Import the post into the library, create a draft campaign from it, run one
   writing tool, and confirm each result is a new local draft linked to the
   source post.
10. Add a reply template, request a suggested reply, and mark a harmless
    comment for follow-up. Confirm tenant/page isolation with a second page when
    available.

## Recovery

- Failed publication: use “Retry” after correcting the page token, permissions,
  media URL, or content.
- Wrong future time: cancel the pending publication and create a new one.
- Repeated campaign failures: correct the root cause, then reactivate the
  automatically paused campaign.
- Writing assistant unavailable: inspect the internal provider-failure log,
  then confirm the selected provider order, keys, base URLs, model access,
  quotas, and server outbound connectivity. Tenant-facing errors intentionally
  do not identify which provider failed. Non-AI workflows require no rollback.
- Migration/startup failure: keep the server stopped, restore the verified
  pre-deployment backup, and deploy the previous application revision.

## Scaling boundary

SQLite immediate transactions and publication claims protect against duplicate
materialization and duplicate worker claims on the shared database. The current
deployment remains designed around one SQLite database volume. Moving to
multiple hosts requires a shared transactional database and coordinated job
ownership; copying the SQLite file to separate hosts is not supported.
