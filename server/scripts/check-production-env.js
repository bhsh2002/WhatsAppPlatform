import 'dotenv/config';

import { validateProductionEnv } from '../config/productionEnv.js';
import {
    integrationConfigFromEnv,
    validateIntegrationConfig,
} from '../services/savanaIntegration.js';

try {
    const environment = { ...process.env, NODE_ENV: 'production' };
    validateProductionEnv(environment);
    validateIntegrationConfig(integrationConfigFromEnv(environment), environment);
    console.log('Production environment validation passed.');
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
