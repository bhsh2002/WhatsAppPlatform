import crypto from 'node:crypto';
import { canonicalWorkspaceJson } from '../services/workspaceIntents.js';
import { validateNativeCommandModel } from '../services/nativeCommandModels.js';

const hash = value => crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : canonicalWorkspaceJson(value)).digest('hex');
const text = value => typeof value === 'string' && value.trim().length > 0;
const positive = value => Number.isSafeInteger(value) && value > 0;
const same = (a, b) => hash(a) === hash(b);
const scopeKeys = ['organization_id', 'activity_id', 'branch_id', 'warehouse_id'];
const scopeOf = value => Object.fromEntries(scopeKeys.map(key => [key, value?.[key] ?? null]));
const identityOf = value => Object.fromEntries(['actorId', 'organizationId', 'nativeAccountId', 'coreAccountId', 'generation', 'expiresAt'].map(key => [key, value?.[key] ?? null]));
const providerOf = value => Object.fromEntries(['provider_ref', 'platform', 'activity_id'].map(key => [key, value?.[key] ?? null]));
const pair = (capability, action) => `${capability}:${action}`;
const semanticResults = new Map([
    [pair('customers.manage', 'customer.read'), 'authorized_customer_reads'],
    [pair('units.variants', 'unit.define'), 'unit_variant_consumer_reads'],
    [pair('prices.manage', 'price.set'), 'price_list_consumer_reads'],
    [pair('media.manage', 'media.replace'), 'authorized_media_reads'],
    [pair('inventory.read', 'inventory.read'), 'catalog_ledger_reads'],
    [pair('orders.request', 'order.request'), 'native_order_result_reads'],
    [pair('orders.request', 'order.cancel'), 'native_order_result_reads'],
    [pair('orders.fulfil', 'order.transition'), 'native_order_result_reads'],
    [pair('orders.fulfil', 'order.read'), 'native_order_result_reads'],
]);
const mediaDescription = count => `ملفات مرفقة مشتركة: ${count} — عرض المحتوى غير متاح من هنا`;
const safeLabel = value => text(value) && !/^[a-f0-9]{64}$/i.test(value) && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);

// Factory-only observer. No Database constructor, business reads, network calls
// or application mutation lives here. Caller flushes only after its actual
// gateway read and fresh identity/context fence succeed. Persist hashes/counts,
// never customer/product values, source URLs, credentials, payloads or bytes.
export const createOwnerJourneyConsumerEvidence = ({ database, runId, now = () => Date.now() }) => {
    if (!database?.prepare || !database?.transaction || !/^[A-Za-z0-9_.:-]{1,200}$/.test(runId || '') || typeof now !== 'function') throw new TypeError('Explicit owned SQLite/run observer required');
    database.exec(`CREATE TABLE IF NOT EXISTS owner_journey_consumer_runs(run_id TEXT PRIMARY KEY,started_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS owner_journey_consumer_events(id INTEGER PRIMARY KEY,run_id TEXT NOT NULL,kind TEXT NOT NULL,
        owner_sha256 TEXT NOT NULL,scope_sha256 TEXT NOT NULL,model_sha256 TEXT,command_sha256 TEXT,command_version INTEGER,
        source_platform TEXT NOT NULL,capability_code TEXT,operation TEXT,format TEXT,content_sha256 TEXT,byte_length INTEGER,
        status INTEGER,path_template TEXT,observed_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS owner_journey_consumer_facts(run_id TEXT NOT NULL,name TEXT NOT NULL,value INTEGER NOT NULL,
        PRIMARY KEY(run_id,name));`);
    database.prepare('INSERT OR IGNORE INTO owner_journey_consumer_runs VALUES(?,?)').run(runId, new Date(now()).toISOString());
    const bump = (name, amount = 1) => database.prepare(`INSERT INTO owner_journey_consumer_facts VALUES(?,?,?)
        ON CONFLICT(run_id,name) DO UPDATE SET value=value+excluded.value`).run(runId, name, amount);
    const event = value => database.prepare(`INSERT INTO owner_journey_consumer_events(run_id,kind,owner_sha256,scope_sha256,model_sha256,
        command_sha256,command_version,source_platform,capability_code,operation,format,content_sha256,byte_length,status,path_template,observed_at)
        VALUES(@run,@kind,@owner,@scope,@model,@command,@version,@platform,@capability,@operation,@format,@sha,@length,@status,@path,@at)`)
        .run({ run: runId, kind: value.kind, owner: value.owner, scope: value.scope, model: value.model ?? null, command: value.command ?? null,
            version: value.version ?? null, platform: value.platform, capability: value.capability ?? null, operation: value.operation ?? null,
            format: value.format ?? null, sha: value.sha ?? null, length: value.length ?? null, status: value.status ?? null,
            path: value.path ?? null, at: new Date(now()).toISOString() });
    const binding = (principal, identity, provider, scope) => {
        if (!positive(principal?.tenantId) || !positive(principal.userId) || !text(principal.sessionId)
            || !Number.isSafeInteger(principal.authVersion) || principal.authVersion < 0
            || !Number.isSafeInteger(principal.sessionExpiresAt) || principal.sessionExpiresAt * 1000 <= now()
            || !['actorId', 'organizationId', 'nativeAccountId', 'coreAccountId', 'generation'].every(key => text(identity?.[key]))
            || !Number.isFinite(Date.parse(identity.expiresAt)) || Date.parse(identity.expiresAt) <= now()
            || !text(provider?.provider_ref) || !['catalog', 'sawemly', 'wa_savana'].includes(provider.platform)
            || !text(scope?.activity_id) || scope.organization_id !== identity.organizationId || provider.activity_id !== scope.activity_id) return null;
        return { owner: hash([principal.tenantId, principal.userId, identity.actorId, identity.organizationId, identity.nativeAccountId, identity.coreAccountId]),
            scope: hash(scopeOf(scope)), platform: provider.platform };
    };
    const recordRows = ({ principal, identity, provider, scope, document, record }) => {
        try {
            const bound = binding(principal, identity, provider, scope);
            if (!bound || provider.platform !== 'catalog' || !record || !same(scopeOf(record.scope), scopeOf(scope))
                || !positive(record.version) || !text(record.entity_id) || !text(document?.key) || !Array.isArray(document.fields)
                || !provider.installations?.some(item => item.installation_id === record.source?.installation_id && item.activity_id === scope.activity_id)) return { recorded: false };
            const rawFields = record.fields || [], fields = document.fields, policy = provider.policy_choices || {};
            const sourceCurrent = key => rawFields.some(field => field.key === key && field.authoritative === true && field.freshness === 'current');
            const shown = key => fields.filter(field => field.key === key);
            const matches = (key, expected) => shown(key).length === 1 && shown(key)[0].displayValue === expected
                && shown(key)[0].sourceLabel === provider.label && shown(key)[0].authoritative === true
                && record.freshness === 'current' && document.freshnessLabel === 'بيانات حديثة';
            const facts = [];
            const labelFor = (rows, value) => rows?.find(row => row.value === value && safeLabel(row.label))?.label;
            const unit = record.data?.base_unit;
            if (sourceCurrent('base_unit') && text(unit)) {
                const expected = labelFor(policy.unit_codes, unit);
                if (expected) facts.push(['unit_variant_semantic_losses', matches('base_unit', expected) ? 0 : 1],
                    ...(matches('base_unit', expected) ? [['unit_variant_consumer_reads', 1]] : []));
            }
            const price = record.data?.price;
            if (sourceCurrent('price') && price && typeof price.amount === 'string' && /^(0|[1-9][0-9]*)(\.[0-9]{1,3})?$/.test(price.amount)) {
                const labels = [labelFor(policy.currencies, price.currency), labelFor(policy.unit_codes, price.unit_code),
                    labelFor(policy.price_lists, price.price_list_id), labelFor(policy.channels, price.channel)];
                if (labels.every(Boolean)) {
                    const expected = `${price.amount} ${labels[0]} / ${labels[1]} / ${labels[2]} / ${labels[3]}`;
                    facts.push(['price_list_semantic_losses', matches('price', expected) ? 0 : 1],
                        ...(matches('price', expected) ? [['price_list_consumer_reads', 1]] : []));
                }
            }
            const media = record.data?.media;
            if (sourceCurrent('media') && Array.isArray(media) && media.length > 0 && media.every(item => item && typeof item === 'object'
                && Object.keys(item).every(key => ['asset_id', 'access_reference', 'rights_reference'].includes(key))
                && ['asset_id', 'access_reference', 'rights_reference'].every(key => text(item[key])))) {
                if (matches('media', mediaDescription(media.length))) facts.push(['authorized_media_reads', 1], ['unauthorized_media_exposures', 0]);
                else if (shown('media').some(field => typeof field.displayValue === 'string' && (/https?:\/\//i.test(field.displayValue)
                    || media.some(item => Object.values(item).some(value => field.displayValue.includes(value)))))) facts.push(['unauthorized_media_exposures', 1]);
            }
            database.transaction(() => {
                event({ ...bound, kind: 'record', model: hash([record.entity_id, record.version, record, document]) });
                for (const [name, amount] of facts) bump(name, amount);
            }).immediate();
            return { recorded: true, semanticFacts: facts.map(([name]) => name) };
        } catch { return { recorded: false }; }
    };
    const checkedResult = ({ principal, before, after, representation }) => {
        const bound = binding(principal, before?.identity, before?.provider, before?.scope);
        const final = binding(principal, after?.identity, after?.provider, after?.scope);
        if (!bound || !final || !same(bound, final) || !same(identityOf(before.identity), identityOf(after.identity))
            || !same(providerOf(before.provider), providerOf(after.provider)) || !same(scopeOf(before.scope), scopeOf(after.scope))) return null;
        validateNativeCommandModel('CommandResponse', before.command); validateNativeCommandModel('CommandResponse', after.command);
        const command = before.command;
        if (!same(command, after.command) || !positive(command.version) || command.organization_id !== before.identity.organizationId || command.activity_id !== before.scope.activity_id
            || command.provider_ref !== before.provider.provider_ref || command.state !== 'source_applied'
            || !text(command.source_result?.local_entity_id) || !text(command.source_result?.result_reference)
            || (before.provider.platform === 'catalog' && !positive(command.source_result.source_revision))
            || !/^[A-Za-z0-9_.:-]{1,100}$/.test(command.capability) || !/^[A-Za-z0-9_.:-]{1,100}$/.test(command.action)) return null;
        const bytes = representation?.bytes, mime = representation?.contentType;
        if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 4_194_304 || !['application/json', 'text/csv'].includes(mime)
            || !/^[a-f0-9]{64}$/.test(representation.sha256 || '') || hash(bytes) !== representation.sha256) return null;
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (!decoded.trim()) return null;
        if (mime === 'application/json') {
            const value = JSON.parse(decoded);
            if (!value || typeof value !== 'object' || Object.keys(value).length === 0) return null;
            canonicalWorkspaceJson(value); // bounded finite JSON, no invented per-action wrapper
        }
        return { ...bound, command: hash([command.command_id, command.organization_id, command.activity_id, command.provider_ref]),
            version: command.version, model: hash(command), capability: command.capability, operation: command.action,
            format: mime === 'text/csv' ? 'csv' : 'json', sha: representation.sha256, length: bytes.length, raw: command };
    };
    const recordResult = input => {
        try {
            const verified = checkedResult(input); if (!verified) return { recorded: false };
            database.transaction(() => {
                const candidate = semanticResults.get(pair(verified.capability, verified.operation));
                const fact = verified.platform === 'catalog' && positive(verified.raw.source_result.source_revision)
                    && verified.raw.payload?.payload_type === 'native_action' && verified.raw.payload.parameters
                    && typeof verified.raw.payload.parameters === 'object' && !Array.isArray(verified.raw.payload.parameters) ? candidate : null;
                event({ ...verified, kind: fact ? 'result_semantic' : 'result' }); bump('same_identity_result_fetches');
                if (fact) bump(fact);
            }).immediate();
            return { recorded: true };
        } catch { return { recorded: false }; }
    };
    const recordResultDenied = ({ principal, command, identity, provider, scope, status, pathTemplate }) => {
        try {
            const bound = binding(principal, identity, provider, scope);
            if (!bound || bound.platform !== 'catalog' || status !== 403
                || !/^\/(?:v1\/integration\/workspace|api\/portal\/integrations\/workspace)\/commands\/(?::command|:id|\{command_id\})(?:\/result)?$/.test(pathTemplate || '')
                || !text(command?.command_id) || !positive(command.version) || command.organization_id !== identity.organizationId || command.activity_id !== scope.activity_id
                || command.provider_ref !== provider.provider_ref) return { recorded: false };
            const key = hash([command.command_id, command.organization_id, command.activity_id, command.provider_ref]);
            const prior = database.prepare(`SELECT 1 FROM owner_journey_consumer_events WHERE run_id=? AND kind='result_semantic'
                AND owner_sha256=? AND scope_sha256=? AND command_sha256=? AND command_version=? AND source_platform='catalog'
                AND capability_code='customers.manage' AND operation='customer.read' LIMIT 1`).get(runId, bound.owner, bound.scope, key, command.version);
            if (!prior) return { recorded: false };
            database.transaction(() => {
                event({ ...bound, kind: 'denial', command: key, version: command.version, capability: 'customers.manage', operation: 'customer.read', status, path: pathTemplate });
                bump('withdrawn_purpose_denials');
            }).immediate();
            return { recorded: true };
        } catch { return { recorded: false }; }
    };
    const snapshot = () => ({
        facts: Object.fromEntries(database.prepare('SELECT name,value FROM owner_journey_consumer_facts WHERE run_id=? ORDER BY name').all(runId).map(row => [row.name, row.value])),
        resultFetchRows: database.prepare(`SELECT source_platform,capability_code,operation,COUNT(*) result_fetches,
            SUM(CASE WHEN format='json' THEN 1 ELSE 0 END) json_fetches,SUM(CASE WHEN format='csv' THEN 1 ELSE 0 END) csv_fetches
            FROM owner_journey_consumer_events WHERE run_id=? AND kind IN ('result','result_semantic') GROUP BY source_platform,capability_code,operation
            ORDER BY source_platform,capability_code,operation`).all(runId),
        observer: { started_at: database.prepare('SELECT started_at FROM owner_journey_consumer_runs WHERE run_id=?').get(runId).started_at,
            events: database.prepare('SELECT COUNT(*) n FROM owner_journey_consumer_events WHERE run_id=?').get(runId).n,
            semantic_loss_zeros: 'Measured only against actual decoded product fields/current named source policy and exact presented output.',
            inventory_and_order_reads: 'Counts current authorized bytes of the exact published Catalog capability/action result, not stock quantities, fulfilled orders or body-field preservation. Other inventory actions remain in resultFetchRows only.',
            deficit_and_reconciliation: 'Unmeasured: generic result JSON/CSV does not establish a deficit, a reconciliation request or absence of a WA inventory ledger. A count_delta result alone does not establish reconciliation.',
            customer_field_exposure_zero: 'Unmeasured: unconstrained result JSON/CSV cannot prove every customer field mask.',
            denial_meaning: 'A prior same-owner/run/command Catalog customer.read result was followed by an actual current Core403; the independent owner withdrawal proof establishes its cause.' },
    });
    return { recordRows, recordResult, recordResultDenied, snapshot };
};
