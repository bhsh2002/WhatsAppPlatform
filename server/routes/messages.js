import express from 'express';

import { createMessageBroadcastsRouter } from './messageBroadcasts.js';
import { createMessageContactsRouter } from './messageContacts.js';
import { createMessageMediaRouter } from './messageMedia.js';
import { createMessageQueriesRouter } from './messageQueries.js';
import { createMessageReadReceiptsRouter } from './messageReadReceipts.js';
import { createMessageSendsRouter } from './messageSends.js';

const router = express.Router();

router.use(createMessageSendsRouter());
router.use(createMessageMediaRouter());
router.use(createMessageQueriesRouter());
router.use(createMessageBroadcastsRouter());
router.use(createMessageContactsRouter());
router.use(createMessageReadReceiptsRouter());

export default router;
