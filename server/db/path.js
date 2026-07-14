import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const resolveDatabasePath = ({
    configuredPath = process.env.DATABASE_PATH,
    nodeEnv = process.env.NODE_ENV,
    processId = process.pid,
    temporaryDirectory = tmpdir(),
    databaseDirectory,
} = {}) => {
    if (configuredPath) return resolve(configuredPath);

    if (nodeEnv === 'test') {
        return join(temporaryDirectory, `whatsapp-platform-test-${processId}.db`);
    }

    return join(databaseDirectory, 'platform.db');
};
