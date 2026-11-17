import 'dotenv/config';
import './runtime/egressMaintenanceBootstrap.js';
import { verifyEgressResumeReady } from './runtime/egressMaintenance.js';

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

// The DB module performs the reviewed forward migrations under the network
// barrier. Verify idle before any application provider modules can resume.
const { default: database } = await import('./db/database.js');
verifyEgressResumeReady(database);
await import('./server.js');
