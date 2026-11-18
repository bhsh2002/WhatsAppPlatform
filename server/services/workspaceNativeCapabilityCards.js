import crypto from 'node:crypto';
import { SharedProductReadError } from './centralProductRead.js';
import { decodeWorkspaceContext } from './workspaceCoreResponses.js';

const invalid = () => { throw new SharedProductReadError('workspace_response_invalid', 502); };
const readyStates = new Set(['available', 'review_available']);
const coreBase = (value, policy) => {
    let parsed; try { parsed = new URL(value); } catch { invalid(); }
    if (parsed.username || parsed.password || parsed.search || parsed.hash
        || !(parsed.protocol === 'https:' || (policy.allowLoopback === true && parsed.protocol === 'http:'
            && parsed.hostname === '127.0.0.1' && parsed.port))) invalid();
    return parsed;
};

// Navigation projection only. The source's real owner form and current Core
// preview/review are used; a metadata row never creates a local parameter form
// or supplies execution authority. Revalidation keeps this boundary closed even
// if a future caller forgets the gateway's initial response decoder.
export const workspaceNativeCapabilityCards = ({ raw, identity, activityId, coreOrigin, urlPolicy = {} }) => {
    if (typeof activityId !== 'string' || !activityId) return [];
    const base = coreBase(coreOrigin, urlPolicy);
    const current = decodeWorkspaceContext(raw, identity, urlPolicy);
    if (!current.activities.some(row => row.activity_id === activityId)) invalid();
    const allowedOrigins = new Set([base.origin, ...(urlPolicy.allowedOrigins || []), ...current.owner_action_origins]);
    return (current.native_command_options || []).filter(row => row.activity_id === activityId).map(row => {
        const provider = current.providers.find(item => item.activity_id === activityId && item.provider_ref === row.provider_ref);
        if (!provider) invalid();
        const ready = readyStates.has(row.availability.state);
        let destination; try { destination = new URL(row.availability.next_action.href, base); } catch { invalid(); }
        if (!allowedOrigins.has(destination.origin) || destination.username || destination.password) invalid();
        if (ready && row.availability.next_action.href !== row.owner_action_url) invalid();
        const availability = { ...row.availability, next_action: { ...row.availability.next_action,
            href: ready ? row.owner_action_url : destination.href } };
        return {
            key: crypto.createHash('sha256').update(JSON.stringify(['native-command-option', identity.organizationId,
                row.activity_id, row.provider_ref, row.capability, row.action])).digest('hex'),
            label: row.label,
            description: provider.label,
            availability,
            // WorkspaceCapabilityCards already renders availability.next_action
            // once. Opening it is navigation, never a local execute button.
            actions: [],
        };
    });
};
