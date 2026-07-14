import assert from 'node:assert/strict';
import test from 'node:test';
import { parseListPagination, parsePagePagination } from '../services/pagination.js';

test('list pagination has safe defaults and hard upper bounds', () => {
    assert.deepEqual(parseListPagination({}), { limit: 50, offset: 0 });
    assert.deepEqual(parseListPagination({ limit: '-5', offset: '-1' }), { limit: 1, offset: 0 });
    assert.deepEqual(parseListPagination({ limit: '99999', offset: '2000000' }), { limit: 200, offset: 1000000 });
    assert.deepEqual(parseListPagination({ limit: '80', offset: '20' }), { limit: 80, offset: 20 });
    assert.deepEqual(
        parseListPagination({ limit: '500', offset: '9000' }, { maxLimit: 100, maxOffset: 5000 }),
        { limit: 100, offset: 5000 }
    );
});

test('page pagination bounds page and derives a safe offset', () => {
    assert.deepEqual(parsePagePagination({ page: '3', limit: '25' }), {
        page: 3,
        limit: 25,
        offset: 50,
    });
    assert.deepEqual(parsePagePagination({ page: '-2', limit: '999' }, { maxLimit: 100 }), {
        page: 1,
        limit: 100,
        offset: 0,
    });
});
