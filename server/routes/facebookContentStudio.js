import express from 'express';

import db from '../db/database.js';
import { createFacebookContentAiRouter } from './facebookContentAi.js';
import { createFacebookContentLibraryRouter } from './facebookContentLibrary.js';
import { createFacebookContentSettingsRouter } from './facebookContentSettings.js';

export function createFacebookContentStudioRouter({
    database = db,
    settings = {},
    library = {},
    ai = {},
} = {}) {
    const router = express.Router();
    router.use(createFacebookContentSettingsRouter({ database, ...settings }));
    router.use(createFacebookContentLibraryRouter({ database, ...library }));
    router.use(createFacebookContentAiRouter({ database, ...ai }));
    return router;
}

export default createFacebookContentStudioRouter();
