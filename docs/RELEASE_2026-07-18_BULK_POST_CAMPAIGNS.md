# Release: bulk Facebook post campaigns (2026-07-18)

This release makes existing Facebook Page posts a first-class campaign source.
Products remain optional.

## Included

- Manual multi-selection of remote posts in the campaign editor.
- Select-all for the Page, following Meta cursor pagination.
- Start/end date filtering using the Page-post `since` and `until` query.
- Transaction-backed bulk imports in 50-post request batches that reuse active
  imports, remove duplicate source-post IDs, and stay within the server's 1 MB
  JSON request limit.
- Explicit campaign-item persistence and selected-item summaries on campaign
  responses, so an existing campaign can be edited accurately.
- Approval recording for selected copies when the campaign uses approved-only
  content.
- A visible 500-post safety limit per campaign.
- Arabic and English labels, empty/error/loading states, and mobile-safe layout.

## Compatibility

- No database migration is required. The existing
  `facebook_content_campaign_items` relation stores the selected set.
- No new environment variable or secret is required.
- Existing product-only, mixed, whole-library, single-post, scheduling,
  publication retry, billing, and history flows remain compatible.
- Saving a campaign never mutates the source Facebook posts.

## Production verification

1. Rebuild both server and client images and recreate both services.
2. Open Content Studio → Campaigns → New campaign.
3. Choose “Posts and library content” and an active Facebook Page.
4. Select three posts manually, save, reopen, and confirm all three remain.
5. Create a draft campaign with a short date range and verify only posts from
   that range are selected.
6. Test “Select all Page posts”; if the Page exceeds 500 posts, confirm the
   safety warning appears.
7. Run a harmless draft campaign once and verify the normal publication record,
   billing entry, and source post linkage.
8. Confirm the original remote posts were not edited or deleted.
