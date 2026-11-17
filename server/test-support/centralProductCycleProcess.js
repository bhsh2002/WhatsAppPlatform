// IPC for owner-published synthetic Python fixtures. Credentials stay in the
// process pipes and memory; neither stdout nor exceptions expose metadata.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';

export const FIXTURE_PREFIX = '@@WA_PRODUCT_CYCLE@@';

export async function startOwnedProductFixture({ python, controller, pythonPaths, input = {} }) {
    if (![python, controller, ...pythonPaths].every(value => path.isAbsolute(value))) {
        throw new Error('Synthetic fixture paths must be explicit and absolute');
    }
    if (!fs.existsSync(python) || !fs.existsSync(controller)) {
        throw new Error('Published synthetic fixture/runtime is unavailable; do not install tools');
    }
    const environment = {
        PATH: path.dirname(python),
        LANG: 'en_US.UTF-8',
        PYTHONPATH: pythonPaths.join(path.delimiter),
        PYTHONNOUSERSITE: '1',
        PYTHON_DOTENV_DISABLED: '1',
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONUNBUFFERED: '1',
    };
    const process = spawn(python, ['-B', controller], {
        cwd: path.dirname(controller), env: environment,
        stdio: ['pipe', 'pipe', 'pipe'], detached: true,
    });
    const queue = [];
    const readers = [];
    let ended = false;
    let exitCode;
    let stderrBytes = 0;
    let ownedDirectories = [];
    const cleanup = { child_exit_code: null, central_factory_cleaned: false, catalog_factory_cleaned: false,
        factory_contexts_closed_before_final_stop: false };
    const lines = createInterface({ input: process.stdout });
    const failReaders = () => {
        for (const pending of readers.splice(0)) pending.reject(new Error(`Owned synthetic fixture exited (${exitCode ?? 'signal'}; diagnostic bytes=${stderrBytes})`));
    };
    process.stderr.on('data', chunk => { stderrBytes += chunk.length; });
    process.stdin.on('error', () => { /* surfaced by child exit/read timeout */ });
    process.on('error', () => { ended = true; failReaders(); });
    const exit = new Promise(resolve => process.once('exit', code => {
        ended = true;
        exitCode = code;
        failReaders();
        resolve(code);
    }));
    lines.on('line', line => {
        if (!line.startsWith(FIXTURE_PREFIX)) return;
        let value;
        try { value = JSON.parse(line.slice(FIXTURE_PREFIX.length)); }
        catch { failReaders(); return; }
        const pending = readers.shift();
        if (pending) pending.resolve(value);
        else queue.push(value);
    });
    const read = (timeoutMs = 45000) => {
        if (queue.length) return Promise.resolve(queue.shift());
        if (ended) return Promise.reject(new Error('Owned synthetic fixture is no longer running'));
        return new Promise((resolve, reject) => {
            const pending = {
                resolve: value => { clearTimeout(timer); resolve(value); },
                reject: error => { clearTimeout(timer); reject(error); },
            };
            const timer = setTimeout(() => {
                const index = readers.indexOf(pending);
                if (index !== -1) readers.splice(index, 1);
                reject(new Error('Owned synthetic fixture response timed out'));
            }, timeoutMs);
            readers.push(pending);
        });
    };
    const command = async body => {
        if (ended) throw new Error('Owned synthetic fixture is no longer running');
        process.stdin.write(`${JSON.stringify(body)}\n`);
        const response = await read();
        if (response.event === 'error') {
            throw new Error(`Owned synthetic fixture failed in ${response.phase || 'unknown phase'} (${response.exception || 'error'})`);
        }
        if (body.command === 'stop_center_http' && response.event === 'center_stopped') {
            cleanup.factory_contexts_closed_before_final_stop = ownedDirectories.length === 2
                && ownedDirectories.every(directory => !fs.existsSync(directory));
            if (!cleanup.factory_contexts_closed_before_final_stop) {
                throw new Error('Owned factory contexts did not remove their temporary state');
            }
        }
        return response;
    };
    const stop = async ({ allowFailedStartup = false } = {}) => {
        if (!ended) {
            try {
                await command({ command: 'stop' });
                await waitForExit(12000);
            } catch {
                try { globalThis.process.kill(-process.pid, 'SIGTERM'); } catch { /* already stopped */ }
                try { await waitForExit(3000); } catch { /* force below */ }
                if (!ended) {
                    try { globalThis.process.kill(-process.pid, 'SIGKILL'); } catch { /* already stopped */ }
                    await exit;
                }
            }
        }
        lines.close();
        process.stdin.destroy();
        cleanup.child_exit_code = exitCode;
        if (!allowFailedStartup && exitCode !== 0) {
            throw new Error('Owned synthetic fixture did not exit cleanly');
        }
        if (ownedDirectories.some(directory => fs.existsSync(directory))) {
            throw new Error('Owned synthetic fixture state survived context cleanup');
        }
        cleanup.central_factory_cleaned = ownedDirectories.length === 2 && !fs.existsSync(ownedDirectories[0]);
        cleanup.catalog_factory_cleaned = ownedDirectories.length === 2 && !fs.existsSync(ownedDirectories[1]);
    };
    const waitForExit = timeoutMs => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Owned synthetic fixture stop timed out')), timeoutMs);
        exit.then(code => { clearTimeout(timer); resolve(code); });
    });
    try {
        process.stdin.write(`${JSON.stringify(input)}\n`);
        const metadata = await read();
        if (metadata.event !== 'ready') throw new Error(`Owned synthetic fixture did not confirm readiness (${metadata.phase || 'unknown phase'}; ${metadata.exception || 'error'})`);
        ownedDirectories = Array.isArray(metadata.owned_directories) ? metadata.owned_directories : [];
        return { metadata, command, stop, cleanup };
    } catch (error) {
        await stop({ allowFailedStartup: true });
        throw error;
    }
}
