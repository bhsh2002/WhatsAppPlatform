import assert from 'node:assert/strict';
import test from 'node:test';
import {
    MAX_AUTOMATION_PATTERN_LENGTH,
    matchesAutomationPattern,
    validateAutomationPattern,
} from '../services/automationPatterns.js';

test('tenant-controlled regular expressions are rejected', () => {
    assert.match(validateAutomationPattern({
        ruleType: 'keyword',
        matchType: 'regex',
        matchPattern: '(a+)+$',
    }), /regex/);

    assert.equal(matchesAutomationPattern({
        match_type: 'regex',
        match_pattern: '(a+)+$',
    }, `${'a'.repeat(100_000)}!`), false);
});

test('exact and comma-separated contains matching remain supported', () => {
    assert.equal(matchesAutomationPattern({
        match_type: 'exact',
        match_pattern: 'Hello',
        match_case_sensitive: 0,
    }, ' hello '), true);
    assert.equal(matchesAutomationPattern({
        match_type: 'contains',
        match_pattern: 'price, cost',
        match_case_sensitive: 0,
    }, 'What is the COST?'), true);
});

test('automation patterns have explicit size and term limits', () => {
    assert.match(validateAutomationPattern({
        ruleType: 'keyword',
        matchType: 'exact',
        matchPattern: 'x'.repeat(MAX_AUTOMATION_PATTERN_LENGTH + 1),
    }), /512/);
    assert.match(validateAutomationPattern({
        ruleType: 'keyword',
        matchType: 'contains',
        matchPattern: Array.from({ length: 26 }, (_, index) => `term${index}`).join(','),
    }), /25/);
});
