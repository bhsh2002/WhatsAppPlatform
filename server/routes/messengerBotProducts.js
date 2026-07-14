import express from 'express';
import fs from 'fs';
import { botImageUpload, csvUpload as upload, cleanupFile } from '../config/upload.js';
import { META_WEBHOOK_CALLBACK_URL } from '../config/index.js';
import { parseListPagination } from '../services/pagination.js';
import {
    requireTenant,
    resolvePublicApiBase,
    toInt,
} from './messengerBotShared.js';

export function normalizeProductImages(images = [], fallbackImageUrl = null) {
    const rows = Array.isArray(images) ? images : [];
    const normalized = [];
    const seen = new Set();

    const addImage = (value, index = normalized.length) => {
        const image = typeof value === 'string' ? { image_url: value } : (value || {});
        const imageUrl = String(image.image_url || image.url || '').trim();
        if (!imageUrl || seen.has(imageUrl)) return;
        seen.add(imageUrl);
        normalized.push({
            image_url: imageUrl,
            alt_text: String(image.alt_text || image.alt || '').trim() || null,
            sort_order: toInt(image.sort_order, index) ?? index,
            is_primary: image.is_primary === true || image.is_primary === 1 || image.is_primary === '1' ? 1 : 0,
        });
    };

    rows.forEach(addImage);
    if (fallbackImageUrl) {
        addImage({ image_url: fallbackImageUrl, is_primary: normalized.length === 0 ? 1 : 0 }, normalized.length);
    }
    if (normalized.length > 0 && !normalized.some(image => image.is_primary)) normalized[0].is_primary = 1;
    return normalized.map((image, index) => ({ ...image, sort_order: index, is_primary: index === 0 ? 1 : 0 }));
}

export function normalizeProductPayload(body = {}) {
    const imageUrl = String(body.image_url || '').trim() || null;
    return {
        sku: String(body.sku || '').trim() || null,
        name: String(body.name || '').trim(),
        description: String(body.description || '').trim() || null,
        price: Number(body.price || 0) || 0,
        currency: String(body.currency || 'LYD').trim().toUpperCase() || 'LYD',
        image_url: imageUrl,
        product_url: String(body.product_url || '').trim() || null,
        category: String(body.category || '').trim() || null,
        availability: ['available', 'out_of_stock', 'hidden'].includes(body.availability) ? body.availability : 'available',
        is_active: body.is_active === false || body.is_active === 0 || body.is_active === '0' ? 0 : 1,
        images: normalizeProductImages(body.images, imageUrl),
    };
}

function parseCsvLine(line) {
    const cells = [];
    let current = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        const next = line[index + 1];
        if (char === '"' && quoted && next === '"') {
            current += '"';
            index += 1;
        } else if (char === '"') {
            quoted = !quoted;
        } else if (char === ',' && !quoted) {
            cells.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    cells.push(current.trim());
    return cells;
}

export function parseProductsCsv(text) {
    const lines = String(text || '').split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return [];
    const headers = parseCsvLine(lines[0]).map(header => header.trim().toLowerCase());
    return lines.slice(1).map(line => {
        const cells = parseCsvLine(line);
        const row = {};
        headers.forEach((header, index) => {
            row[header] = cells[index] || '';
        });
        return normalizeProductPayload(row);
    }).filter(product => product.name);
}

export function createMessengerBotProductsRouter({
    database,
    csvUploadMiddleware = upload.single('file'),
    imageUploadMiddleware = botImageUpload.single('file'),
    cleanupUploadedFile = cleanupFile,
    webhookCallbackUrl = META_WEBHOOK_CALLBACK_URL,
} = {}) {
    if (!database) throw new TypeError('database is required');
    const router = express.Router();

    const getProductImages = productId => database.prepare(`
        SELECT id, image_url, alt_text, sort_order, is_primary
        FROM bot_product_images
        WHERE product_id = ?
        ORDER BY is_primary DESC, sort_order ASC, id ASC
    `).all(productId);

    const attachProductImages = product => {
        if (!product) return product;
        const images = getProductImages(product.id);
        return {
            ...product,
            images,
            image_url: images[0]?.image_url || product.image_url || null,
        };
    };

    const attachProductsImages = products => {
        if (!products.length) return products;
        const placeholders = products.map(() => '?').join(', ');
        const images = database.prepare(`
            SELECT id, product_id, image_url, alt_text, sort_order, is_primary
            FROM bot_product_images
            WHERE product_id IN (${placeholders})
            ORDER BY is_primary DESC, sort_order ASC, id ASC
        `).all(...products.map(product => product.id));
        const byProduct = new Map();
        for (const image of images) {
            if (!byProduct.has(image.product_id)) byProduct.set(image.product_id, []);
            byProduct.get(image.product_id).push(image);
        }
        return products.map(product => {
            const productImages = byProduct.get(product.id) || [];
            return {
                ...product,
                images: productImages,
                image_url: productImages[0]?.image_url || product.image_url || null,
            };
        });
    };

    const replaceProductImages = (productId, tenantId, images = []) => {
        database.prepare('DELETE FROM bot_product_images WHERE product_id = ? AND tenant_id = ?').run(productId, tenantId);
        if (!images.length) return;
        const insert = database.prepare(`
            INSERT INTO bot_product_images (tenant_id, product_id, image_url, alt_text, sort_order, is_primary)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        images.forEach((image, index) => {
            insert.run(tenantId, productId, image.image_url, image.alt_text, index, index === 0 ? 1 : 0);
        });
    };

    router.get('/products', (req, res) => {
        try {
            const tenant = requireTenant(database, req, res);
            if (!tenant) return;
            const { search = '', category = '', active = '' } = req.query;
            const { limit, offset } = parseListPagination(req.query, {
                defaultLimit: 100,
                maxLimit: 200,
            });
            const clauses = ['tenant_id = ?'];
            const params = [tenant.id];
            if (search) {
                clauses.push('(name LIKE ? OR sku LIKE ? OR description LIKE ?)');
                const value = `%${search}%`;
                params.push(value, value, value);
            }
            if (category) {
                clauses.push('LOWER(category) = LOWER(?)');
                params.push(category);
            }
            if (active !== '') {
                clauses.push('is_active = ?');
                params.push(active === '1' || active === 'true' ? 1 : 0);
            }

            const products = database.prepare(`
                SELECT *
                FROM bot_products
                WHERE ${clauses.join(' AND ')}
                ORDER BY updated_at DESC, id DESC
                LIMIT ? OFFSET ?
            `).all(...params, limit, offset);
            res.json(attachProductsImages(products));
        } catch (error) {
            console.error('[MessengerBot] Products list error:', error);
            res.status(500).json({ error: 'فشل جلب المنتجات' });
        }
    });

    router.post('/products', (req, res) => {
        try {
            const tenant = requireTenant(database, req, res);
            if (!tenant) return;
            const product = normalizeProductPayload(req.body);
            if (!product.name) return res.status(400).json({ error: 'اسم المنتج مطلوب' });

            const tx = database.transaction(() => {
                const result = database.prepare(`
                    INSERT INTO bot_products (
                        tenant_id, sku, name, description, price, currency,
                        image_url, product_url, category, availability, is_active
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    tenant.id,
                    product.sku,
                    product.name,
                    product.description,
                    product.price,
                    product.currency,
                    product.images[0]?.image_url || product.image_url,
                    product.product_url,
                    product.category,
                    product.availability,
                    product.is_active,
                );
                replaceProductImages(result.lastInsertRowid, tenant.id, product.images);
                return attachProductImages(database.prepare('SELECT * FROM bot_products WHERE id = ?').get(result.lastInsertRowid));
            });

            res.status(201).json(tx());
        } catch (error) {
            console.error('[MessengerBot] Product create error:', error);
            res.status(500).json({ error: 'فشل إنشاء المنتج' });
        }
    });

    router.patch('/products/:id', (req, res) => {
        try {
            const tenant = requireTenant(database, req, res);
            if (!tenant) return;
            const existing = database.prepare('SELECT * FROM bot_products WHERE id = ? AND tenant_id = ?')
                .get(req.params.id, tenant.id);
            if (!existing) return res.status(404).json({ error: 'المنتج غير موجود' });

            const body = { ...existing, ...req.body };
            if (!Object.prototype.hasOwnProperty.call(req.body, 'images')) {
                body.images = getProductImages(existing.id);
            }
            const product = normalizeProductPayload(body);
            if (!product.name) return res.status(400).json({ error: 'اسم المنتج مطلوب' });

            const tx = database.transaction(() => {
                database.prepare(`
                    UPDATE bot_products
                    SET sku = ?, name = ?, description = ?, price = ?, currency = ?,
                        image_url = ?, product_url = ?, category = ?, availability = ?,
                        is_active = ?, updated_at = datetime('now', 'localtime')
                    WHERE id = ? AND tenant_id = ?
                `).run(
                    product.sku,
                    product.name,
                    product.description,
                    product.price,
                    product.currency,
                    product.images[0]?.image_url || product.image_url,
                    product.product_url,
                    product.category,
                    product.availability,
                    product.is_active,
                    req.params.id,
                    tenant.id,
                );
                replaceProductImages(req.params.id, tenant.id, product.images);
                return attachProductImages(database.prepare('SELECT * FROM bot_products WHERE id = ?').get(req.params.id));
            });

            res.json(tx());
        } catch (error) {
            console.error('[MessengerBot] Product update error:', error);
            res.status(500).json({ error: 'فشل تحديث المنتج' });
        }
    });

    router.delete('/products/:id', (req, res) => {
        try {
            const tenant = requireTenant(database, req, res);
            if (!tenant) return;
            const result = database.prepare('DELETE FROM bot_products WHERE id = ? AND tenant_id = ?')
                .run(req.params.id, tenant.id);
            if (result.changes === 0) return res.status(404).json({ error: 'المنتج غير موجود' });
            res.json({ success: true });
        } catch (error) {
            console.error('[MessengerBot] Product delete error:', error);
            res.status(500).json({ error: 'فشل حذف المنتج' });
        }
    });

    router.post('/products/import', csvUploadMiddleware, (req, res) => {
        try {
            const tenant = requireTenant(database, req, res);
            if (!tenant) return;
            if (!req.file) return res.status(400).json({ error: 'ملف CSV مطلوب' });

            const text = fs.readFileSync(req.file.path, 'utf8');
            const products = parseProductsCsv(text);
            let imported = 0;
            let skipped = 0;
            const insert = database.prepare(`
                INSERT INTO bot_products (
                    tenant_id, sku, name, description, price, currency,
                    image_url, product_url, category, availability, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(tenant_id, sku) WHERE sku IS NOT NULL AND sku != '' DO UPDATE SET
                    name = excluded.name,
                    description = excluded.description,
                    price = excluded.price,
                    currency = excluded.currency,
                    image_url = excluded.image_url,
                    product_url = excluded.product_url,
                    category = excluded.category,
                    availability = excluded.availability,
                    is_active = excluded.is_active,
                    updated_at = datetime('now', 'localtime')
            `);

            const tx = database.transaction(() => {
                for (const product of products) {
                    if (!product.name) {
                        skipped += 1;
                        continue;
                    }
                    insert.run(
                        tenant.id,
                        product.sku,
                        product.name,
                        product.description,
                        product.price,
                        product.currency,
                        product.image_url,
                        product.product_url,
                        product.category,
                        product.availability,
                        product.is_active,
                    );
                    imported += 1;
                }
            });
            tx();

            res.json({ success: true, imported, skipped });
        } catch (error) {
            console.error('[MessengerBot] Product import error:', error);
            res.status(500).json({ error: 'فشل استيراد المنتجات' });
        } finally {
            cleanupUploadedFile(req.file?.path);
        }
    });

    router.post('/assets/upload', imageUploadMiddleware, (req, res) => {
        try {
            const tenant = requireTenant(database, req, res);
            if (!tenant) {
                cleanupUploadedFile(req.file?.path);
                return;
            }
            if (!req.file) return res.status(400).json({ error: 'الصورة مطلوبة' });

            const url = `${resolvePublicApiBase(req, webhookCallbackUrl)}/bot-assets/${encodeURIComponent(req.file.filename)}`;
            res.status(201).json({
                url,
                filename: req.file.filename,
                original_name: req.file.originalname,
                mime_type: req.file.mimetype,
                size: req.file.size,
            });
        } catch (error) {
            cleanupUploadedFile(req.file?.path);
            console.error('[MessengerBot] Asset upload error:', error);
            res.status(500).json({ error: 'فشل رفع صورة البوت' });
        }
    });

    return router;
}
