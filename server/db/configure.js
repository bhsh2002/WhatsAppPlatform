export const configureDatabaseConnection = (db, {
    busyTimeoutMs = 5000,
    enableWal = true,
} = {}) => {
    db.pragma('foreign_keys = ON');
    if (enableWal) db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma(`busy_timeout = ${Math.max(1000, Math.min(30000, Number(busyTimeoutMs) || 5000))}`);
    db.pragma('wal_autocheckpoint = 1000');
    db.pragma('journal_size_limit = 67108864');

    return {
        foreignKeys: db.pragma('foreign_keys', { simple: true }),
        journalMode: db.pragma('journal_mode', { simple: true }),
        synchronous: db.pragma('synchronous', { simple: true }),
        busyTimeoutMs: db.pragma('busy_timeout', { simple: true }),
    };
};
