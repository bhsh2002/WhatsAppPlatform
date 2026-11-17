import fs from 'node:fs';
import { createHash } from 'node:crypto';

const migrationNames = [
    '055_savana_request_review_evidence.sql',
    '056_savana_incomplete_product_pricing.sql',
    '057_savana_pricing_contract_guard.sql',
];
const migrationSql = name => fs.readFileSync(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8');

// Use the forward migration's exact assessment, rather than maintaining a
// second approximation of its affected-row predicate. Only SELECT is run.
const guard = migrationSql(migrationNames[2]);
const assessment = guard.slice(guard.indexOf('WITH assessed AS ('), guard.indexOf('\nUPDATE bot_products\n'));
if (!assessment.startsWith('WITH assessed AS (') || !assessment.endsWith(')')) {
    throw new Error('Pricing migration assessment is unavailable');
}

export function readSavanaPricingImpact(database) {
    const read = database.transaction(() => {
        const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
        for (const table of ['bot_products', 'savana_product_projection', 'savana_service_requests']) {
            if (!tables.has(table)) throw new Error('Expected WA integration schema is unavailable');
        }
        const trackedColumns = tables.has('_migrations')
            ? database.pragma('table_info(_migrations)').map(column => column.name) : [];
        const applied = tables.has('_migrations') ? new Map(database.prepare(
            `SELECT name${trackedColumns.includes('checksum') ? ', checksum' : ''} FROM _migrations`,
        ).all().map(row => [row.name, row.checksum])) : new Map();
        const migrations = migrationNames.map(name => ({
            name,
            applied: applied.has(name),
            checksum_matches: !applied.has(name) || !applied.get(name) ? null : applied.get(name) === createHash('sha256').update(migrationSql(name)).digest('hex'),
        }));
        const counts = database.prepare(`${assessment}
            SELECT COUNT(*) AS managed_copies,
                COALESCE(SUM(source_found = 0), 0) AS missing_projection,
                COALESCE(SUM(price_valid = 0), 0) AS invalid_or_missing_price,
                COALESCE(SUM(currency_valid = 0), 0) AS invalid_or_missing_currency,
                COALESCE(SUM(price_valid = 1 AND currency_valid = 1 AND copy_matches_source = 0), 0) AS stale_copy,
                COALESCE(SUM(price_valid = 0 OR currency_valid = 0 OR copy_matches_source = 0), 0) AS affected_by_057,
                COALESCE(SUM((price_valid = 0 OR currency_valid = 0 OR copy_matches_source = 0)
                    AND (is_active = 1 OR availability != 'hidden')), 0) AS potentially_newly_hidden,
                COALESCE(SUM(is_active = 0 AND availability = 'hidden'), 0) AS already_hidden,
                COALESCE(SUM(savana_projection_key NOT LIKE 'canonical:%'), 0) AS legacy_unqualified_identity
            FROM assessed`).get();
        const previous = migrationSql(migrationNames[1]);
        const previousWhere = previous.slice(previous.indexOf('\nWHERE savana_projection_key'));
        const previousCount = database.prepare(`SELECT COUNT(*) AS count FROM bot_products ${previousWhere}`).get().count;
        const requests = database.prepare('SELECT status, COUNT(*) AS count FROM savana_service_requests GROUP BY status').all();
        const reviewColumns = database.pragma('table_info(savana_service_requests)').map(column => column.name);
        return {
            document_kind: 'wa_savana_read_only_migration_impact',
            read_only: true,
            migration_tracking_present: tables.has('_migrations'),
            migrations,
            counts: { ...counts, matching_056_predicate: previousCount },
            review_evidence_columns_present: ['reviewed_payload_hash', 'reviewed_by', 'reviewed_at'].every(column => reviewColumns.includes(column)),
            request_status_counts: Object.fromEntries(requests.map(row => [row.status, row.count])),
            business_values_or_identifiers_included: false,
            installation_mapping_inferred: false,
            runtime_activation_authorized: false,
            notes: [
                'Counts are from one read transaction; they are not an approval or a migration execution.',
                '056/057 may hide copies; source projections, event payloads and entity identities are not rewritten.',
                'Legacy local/SKU/barcode keys need an explicit installation-qualified identity map; no automatic merge.',
                'A successful scan or shared schema validation does not enable WA execution or financial reservations.',
            ],
        };
    });
    return read();
}
