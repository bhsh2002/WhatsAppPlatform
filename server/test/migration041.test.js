import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.join(testDirectory, '..', 'db', 'migrations');
const migrationFiles = fs.readdirSync(migrationsDirectory)
    .filter(file => file.endsWith('.sql'))
    .sort();
const migration = name => fs.readFileSync(
    path.join(migrationsDirectory, name),
    'utf8'
);

test('migration 041 preserves content history and adds post workflow state', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    for (const file of migrationFiles.filter(file => file < '041_facebook_post_workflows.sql')) {
        db.exec(migration(file));
    }

    db.prepare(`
        INSERT INTO tenants (id, name, phone)
        VALUES (1, 'Tenant', '218910000001')
    `).run();
    db.prepare(`
        INSERT INTO users (id, username, password_hash, name, role, tenant_id)
        VALUES (1, 'tenant', 'hash', 'Tenant user', 'tenant', 1)
    `).run();
    db.prepare(`
        INSERT INTO tenant_pages (id, tenant_id, page_id, page_name)
        VALUES (11, 1, 'page-11', 'Page 11')
    `).run();
    db.prepare(`
        INSERT INTO bot_products (id, tenant_id, sku, name, price)
        VALUES (21, 1, 'SKU-21', 'Existing product', 10)
    `).run();
    db.prepare(`
        INSERT INTO facebook_content_items (
            id, tenant_id, linked_page_id, kind, title, body, status, created_by
        ) VALUES (31, 1, 11, 'manual', 'Existing item', 'Existing body', 'draft', 1)
    `).run();
    db.prepare(`
        INSERT INTO facebook_content_ai_generations (
            id, tenant_id, linked_page_id, action, model, prompt_version,
            input_text, status, created_by
        ) VALUES (
            41, 1, 11, 'rewrite', 'existing-model', 'existing-prompt',
            'Existing input', 'completed', 1
        )
    `).run();

    db.exec(migration('041_facebook_post_workflows.sql'));

    assert.deepEqual(
        db.prepare(`
            SELECT approval_status, source_post_id
            FROM bot_products
            WHERE id = 21
        `).get(),
        { approval_status: 'approved', source_post_id: null }
    );
    assert.deepEqual(
        db.prepare(`
            SELECT action, model, input_text, source_post_id
            FROM facebook_content_ai_generations
            WHERE id = 41
        `).get(),
        {
            action: 'rewrite',
            model: 'existing-model',
            input_text: 'Existing input',
            source_post_id: null,
        }
    );
    db.prepare(`
        INSERT INTO facebook_content_ai_generations (
            tenant_id, linked_page_id, source_post_id, action, model,
            prompt_version, status
        ) VALUES (1, 11, 'post-1', 'improve_cta', 'model', 'prompt', 'completed')
    `).run();
    db.prepare(`
        INSERT INTO facebook_comment_reply_templates (
            tenant_id, linked_page_id, name, body, created_by
        ) VALUES (1, 11, 'سعر', 'سنرسل التفاصيل', 1)
    `).run();
    db.prepare(`
        INSERT INTO facebook_comment_followups (
            tenant_id, linked_page_id, post_id, comment_id, created_by
        ) VALUES (1, 11, 'post-1', 'comment-1', 1)
    `).run();

    assert.throws(
        () => db.prepare(`
            INSERT INTO facebook_content_ai_generations (
                tenant_id, action, model, prompt_version
            ) VALUES (1, 'unsupported', 'model', 'prompt')
        `).run(),
        /CHECK constraint failed/
    );
    assert.equal(db.pragma('foreign_key_check').length, 0);
    db.close();
});
