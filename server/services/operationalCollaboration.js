import { OperationalWorkspaceService } from './operationalWorkspace.js';
import { NativeServiceEnrollment } from './nativeServiceEnrollment.js';
import { createCollaborativeRuntime } from './collaborativeRuntime.js';

// Shared production/factory assembly. All native dependencies use the same
// explicit owned database and real native commands; this creates no grants.
export const createOperationalCollaboration = ({ database, encryption, readServices, integrationService,
    nativeDependencies, config, verifySourceEvidence = null, fetchImpl = globalThis.fetch, now = () => Date.now() }) => {
    const { setupService, readService, nativeOwnerProofs } = readServices;
    const workspace = new OperationalWorkspaceService({ database, encryption, setupService, readService,
        nativeOwnerProofs, fetchImpl, now });
    if (setupService.config.enabled !== true || !nativeOwnerProofs || !config.callbackToken || !nativeDependencies) {
        return { workspace, native: null };
    }
    const nativeEnrollmentService = new NativeServiceEnrollment({ database, encryption,
        config: { centerOrigin: setupService.config.centerOrigin, platformToken: setupService.config.platformToken,
            allowLoopback: setupService.config.allowLoopback === true },
        verifyOwnerAuthority: input => nativeOwnerProofs.authority(input), fetchImpl, now });
    workspace.setNativeEnrollmentService(nativeEnrollmentService);
    const ownerActions = Object.fromEntries(['messaging.send', 'campaigns.execute', 'content.publish', 'messaging.review', 'campaigns.review', 'content.review',
        'customers.manage', 'measurement.read', 'measurement.export', 'owner.operations', 'media.manage'].map(code => [code,
        { registered: true, contractVersion: '1.0', path: `/portal/integrations?workspace=shared&action=${encodeURIComponent(code)}` }]));
    const native = createCollaborativeRuntime({ database, encryption,
        config: { ...config, appOrigin: setupService.appOrigin, centerOrigin: setupService.config.centerOrigin,
            platformToken: setupService.config.platformToken, allowLoopback: setupService.config.allowLoopback === true },
        nativeOwnerProofs, integrationService, nativeEnrollmentService, nativeDependencies,
        verifyOwnerContext: input => workspace.verifyOwnerContext(input), verifySourceEvidence, ownerActions,
        resolveNativeNamespace: input => workspace.resolveNativeNamespace(input), fetchImpl, now });
    workspace.setNativeOwnerService(native.ownerService);
    workspace.setNativeBusinessOwnerService(native.businessOwnerService);
    return { workspace, native, nativeEnrollmentService };
};
