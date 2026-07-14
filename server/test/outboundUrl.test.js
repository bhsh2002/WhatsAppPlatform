import assert from 'node:assert/strict';
import test from 'node:test';
import {
    UnsafeOutboundUrlError,
    isPublicIpAddress,
    parseOutboundUrl,
    resolveSafeOutboundTarget,
    validateOutboundUrl,
} from '../security/outboundUrl.js';

test('outbound URL policy accepts only HTTPS without embedded credentials', () => {
    assert.equal(parseOutboundUrl('https://hooks.example.com/path').hostname, 'hooks.example.com');
    assert.throws(() => parseOutboundUrl('http://hooks.example.com'), UnsafeOutboundUrlError);
    assert.throws(() => parseOutboundUrl('https://user:pass@hooks.example.com'), UnsafeOutboundUrlError);
    assert.throws(() => parseOutboundUrl('https://hooks.example.com:8443'), UnsafeOutboundUrlError);
    assert.throws(() => parseOutboundUrl('https://service.internal/hook'), UnsafeOutboundUrlError);
});

test('private, loopback, link-local, documentation and mapped addresses are blocked', () => {
    for (const address of [
        '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254',
        '172.16.0.1', '192.168.1.1', '198.51.100.4', '203.0.113.8',
        '::1', 'fc00::1', 'fe80::1', '2001:db8::1', '::ffff:127.0.0.1',
    ]) assert.equal(isPublicIpAddress(address), false, address);

    assert.equal(isPublicIpAddress('8.8.8.8'), true);
    assert.equal(isPublicIpAddress('2606:4700:4700::1111'), true);
});

test('DNS validation rejects a hostname if any answer is non-public', async () => {
    const mixedLookup = async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
    ];
    await assert.rejects(
        resolveSafeOutboundTarget('https://hooks.example.com/callback', mixedLookup),
        UnsafeOutboundUrlError
    );
});

test('validated targets retain the public address selected for pinned connection', async () => {
    const lookup = async () => [{ address: '8.8.4.4', family: 4 }];
    const target = await resolveSafeOutboundTarget('https://hooks.example.com/callback', lookup);

    assert.equal(target.address, '8.8.4.4');
    assert.equal(target.family, 4);
    assert.equal(
        await validateOutboundUrl('https://hooks.example.com/callback', { lookup }),
        'https://hooks.example.com/callback'
    );
});
