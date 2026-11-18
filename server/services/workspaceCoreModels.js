import fs from 'node:fs';
import crypto from 'node:crypto';
import { validateSchemaModel } from './nativeCommandModels.js';
import { SharedProductReadError } from './centralProductRead.js';

export const WORKSPACE_MODELS_SHA256 = 'aa90d5c5e827352f1fe846fdeda9852c0a4d2fa4e193b46a1f95922214c1e66e';
const bytes = fs.readFileSync(new URL('../config/peer-owner-workspace-models-v4.json', import.meta.url));
if (crypto.createHash('sha256').update(bytes).digest('hex') !== WORKSPACE_MODELS_SHA256) throw new TypeError('Unreviewed delegated workspace schema');
const models = JSON.parse(bytes).models;

export const validateWorkspaceCoreModel = (name, value) => {
    try { return validateSchemaModel(models, name, value); }
    catch { throw new SharedProductReadError('workspace_request_invalid', 422); }
};
