import { commit, release, reserve } from './billing.js';
import { publishNativeFacebookContent } from './nativeFacebookContentPublisher.js';
export { resolveFacebookPageCredentials } from './nativeFacebookContentPublisher.js';

// Ordinary native callers and collaborative dispatch share exactly one publisher.
export const publishFacebookContent = (options = {}) => publishNativeFacebookContent({
    ...options, billing: options.billing || { commit, release, reserve },
});
