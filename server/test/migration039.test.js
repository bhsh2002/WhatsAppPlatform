import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const migration = name => fs.readFileSync(
    path.join(testDirectory, '..', 'db', 'migrations', name),
    'utf8'
);

test('migration 039 adds ownership FKs, preserves cooldowns and disables orphan rules', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE tenants (id INTEGER PRIMARY KEY)');
    db.exec('CREATE TABLE tenant_pages (id INTEGER PRIMARY KEY, tenant_id INTEGER)');
    db.exec(migration('017_automation_rules.sql'));
    db.exec(migration('018_automation_post_scope.sql'));
    db.prepare('INSERT INTO tenants (id) VALUES (1)').run();
    db.prepare('INSERT INTO tenant_pages (id, tenant_id) VALUES (5, 1)').run();
    db.prepare(`
        INSERT INTO automation_rules (id, tenant_id, name, rule_type, channel, target_page_id)
        VALUES (10, 1, 'valid', 'comment_reply', 'facebook', 5)
    `).run();
    db.prepare(`
        INSERT INTO automation_rules (id, tenant_id, name, rule_type, channel)
        VALUES (11, NULL, 'global', 'keyword', 'all')
    `).run();
    db.prepare(`
        INSERT INTO automation_rules (id, tenant_id, name, rule_type, channel)
        VALUES (12, 999, 'orphan', 'keyword', 'all')
    `).run();
    db.prepare(`
        INSERT INTO automation_cooldowns (id, rule_id, contact_id, channel)
        VALUES (20, 10, 'contact', 'facebook')
    `).run();

    db.exec(migration('039_automation_rule_constraints.sql'));

    assert.deepEqual(
        db.prepare('SELECT tenant_id, is_active FROM automation_rules WHERE id = 12').get(),
        { tenant_id: null, is_active: 0 }
    );
    assert.equal(db.prepare('SELECT COUNT(*) count FROM automation_cooldowns WHERE id = 20').get().count, 1);
    assert.deepEqual(
        db.pragma('foreign_key_list(automation_rules)').map(row => row.table).sort(),
        ['tenant_pages', 'tenants']
    );
    assert.equal(db.pragma('foreign_key_check').length, 0);

    db.prepare('DELETE FROM tenants WHERE id = 1').run();
    assert.equal(db.prepare('SELECT COUNT(*) count FROM automation_rules WHERE id = 10').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM automation_cooldowns WHERE id = 20').get().count, 0);
    db.close();
});
