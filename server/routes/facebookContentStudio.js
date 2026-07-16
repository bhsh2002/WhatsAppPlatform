import express from 'express';

import db from '../db/database.js';
import { createFacebookContentAiRouter } from './facebookContentAi.js';
import { createFacebookContentCampaignsRouter } from './facebookContentCampaigns.js';
import { createFacebookContentEngagementRouter } from './facebookContentEngagement.js';
import { createFacebookContentLibraryRouter } from './facebookContentLibrary.js';
import { createFacebookContentPublicationsRouter } from './facebookContentPublications.js';
import { createFacebookContentSettingsRouter } from './facebookContentSettings.js';

export function createFacebookContentStudioRouter({
    database = db,
    settings = {},
    library = {},
    ai = {},
    campaigns = {},
    engagement = {},
    publications = {},
} = {}) {
    const router = express.Router();
    router.use(createFacebookContentSettingsRouter({ database, ...settings }));
    router.use(createFacebookContentLibraryRouter({ database, ...library }));
    router.use(createFacebookContentAiRouter({ database, ...ai }));
    router.use(createFacebookContentCampaignsRouter({ database, ...campaigns }));
    router.use(createFacebookContentPublicationsRouter({ database, ...publications }));
    router.use(createFacebookContentEngagementRouter({ database, ...engagement }));
    return router;
}

export default createFacebookContentStudioRouter();
