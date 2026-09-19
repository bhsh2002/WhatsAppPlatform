import 'dotenv/config';

import { validateProductionEnv } from './config/productionEnv.js';
import {
    integrationConfigFromEnv,
    validateIntegrationConfig,
} from './services/savanaIntegration.js';

try {
    validateProductionEnv(process.env);
    validateIntegrationConfig(integrationConfigFromEnv(process.env), process.env);
} catch (error) {
    console.error(`❌ FATAL: ${error.message}`);
    process.exit(1);
}

await import('./server.js');
