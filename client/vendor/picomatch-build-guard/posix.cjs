'use strict';
const root = require('./index.cjs');
const facade = root.buildGuard.posix();
Object.defineProperty(facade, 'buildGuard', { value: root.buildGuard });
module.exports = facade;
