# Messenger webhook repair

The required Facebook Page subscription fields are defined in
`server/services/metaReadiness.js`: `feed`, `messages`, `messaging_postbacks`,
and `message_echoes`. Messenger setup requires both `messages` and
`message_echoes` on a recorded subscription with a usable Page token.

Existing pages may still have the earlier three fields saved. No migration or
startup task subscribes them automatically. The normal owner opens
`/portal/fb-pages` and uses **Repair webhook subscription** for the selected
Page. The existing authenticated action is
`POST /api/portal/pages/{id}/repair-webhook`; the server verifies Page ownership
and asks Meta for the complete required field list. It updates the recorded
subscription only after Meta confirms the request. An expired or invalid token
requires the existing Facebook reconnection flow first.

Collaborative Messenger configuration also requires actual `META_APP_ID` and
`META_APP_SECRET`, a recorded `tenant_pages.webhook_subscribed = 1`, and
`message_echoes` in `tenant_pages.subscribed_fields`. Root must preserve and
verify those operator-owned settings; this source change sets no values and
performs no provider request.

An echo supports reconciliation only with the verified event signature,
app/Page/recipient correlation and the stored operation fingerprint. Existing
unknown outcomes remain held until the actual correlated result is verified.
The separate legacy administrator subscribe route reuses its saved field list;
the normal owner repair action above requests and records the current list.
