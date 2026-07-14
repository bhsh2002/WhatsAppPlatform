import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.join(testDirectory, '..', 'db', 'migrations');
const migration = name => fs.readFileSync(path.join(migrationsDirectory, name), 'utf8');

test('migration 018 preserves existing automation cooldowns with foreign keys enabled', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(migration('017_automation_rules.sql'));
    db.prepare(`
        INSERT INTO automation_rules (id, name, rule_type, channel, response_text)
        VALUES (7, 'existing rule', 'keyword', 'whatsapp', 'reply')
    `).run();
    db.prepare(`
        INSERT INTO automation_cooldowns (id, rule_id, contact_id, channel, last_triggered_at)
        VALUES (11, 7, 'contact-1', 'whatsapp', '2026-07-12 12:00:00')
    `).run();

    db.exec(migration('018_automation_post_scope.sql'));

    assert.deepEqual(
        db.prepare('SELECT id, rule_id, contact_id, channel, last_triggered_at FROM automation_cooldowns').get(),
        {
            id: 11,
            rule_id: 7,
            contact_id: 'contact-1',
            channel: 'whatsapp',
            last_triggered_at: '2026-07-12 12:00:00',
        }
    );
    assert.equal(db.pragma('foreign_key_check').length, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE name = 'automation_cooldowns_018_backup'").get().count, 0);
    db.close();
});
