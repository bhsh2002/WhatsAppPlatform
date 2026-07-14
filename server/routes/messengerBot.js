import express from 'express';
import db from '../db/database.js';
import { createMessengerBotFlowsRouter } from './messengerBotFlows.js';
import { createMessengerBotProductsRouter } from './messengerBotProducts.js';
import { createMessengerBotSessionsRouter } from './messengerBotSessions.js';
import { createMessengerBotSummaryRouter } from './messengerBotSummary.js';

export function createMessengerBotRouter({
    database = db,
    products = {},
    flows = {},
} = {}) {
    const router = express.Router();
    router.use(createMessengerBotSummaryRouter({ database }));
    router.use(createMessengerBotProductsRouter({ database, ...products }));
    router.use(createMessengerBotFlowsRouter({ database, ...flows }));
    router.use(createMessengerBotSessionsRouter({ database }));
    return router;
}

export default createMessengerBotRouter();
