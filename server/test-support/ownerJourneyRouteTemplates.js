// Inspect only actual registered Express routes. These are metadata, not
// endpoints or authorization. Trace templates match the source trace mapper,
// which retains the top mounted prefix and the final registered route path.
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const join = (prefix, suffix) => `${prefix}${suffix}` || '/';
const staticMount = layer => {
    if (layer.regexp?.fast_slash) return '';
    if (layer.keys?.length) return null;
    const source = layer.regexp?.source;
    const ending = '\\/?(?=\\/|$)';
    if (typeof source !== 'string' || !source.startsWith('^') || !source.endsWith(ending)) return null;
    const value = source.slice(1, -ending.length).replaceAll('\\/', '/');
    return /^\/[A-Za-z0-9_/-]*$/.test(value) ? value : null;
};

export const ownerJourneyRouteTemplates = ({ router, publicPrefix, tracePrefix = publicPrefix }) => {
    const output = [];
    const visit = (stack, prefix) => {
        for (const layer of stack || []) {
            if (layer.route) {
                const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
                for (const path of paths) {
                    if (typeof path !== 'string' || !/^\/[A-Za-z0-9_:/{}.-]*$/.test(path)) continue;
                    const publicPaths = [path];
                    // Express compiles the router's strict setting into this
                    // route layer. Describe its accepted browser slash form,
                    // while keeping req.route.path as the canonical trace.
                    if (!path.endsWith('/') && layer.regexp instanceof RegExp
                        && new RegExp(layer.regexp.source, layer.regexp.flags).test(`${path}/`)) publicPaths.push(`${path}/`);
                    for (const [method, enabled] of Object.entries(layer.route.methods)) if (enabled && methods.has(method.toUpperCase())) {
                        for (const browser_service of ['wa_frontend', 'wa_savana']) for (const publicPath of publicPaths) {
                            output.push({ browser_service, method: method.toUpperCase(), public_path_template: join(prefix, publicPath),
                                trace_service: 'wa_savana', path_template: join(tracePrefix, path) });
                        }
                    }
                }
            } else if (layer.handle?.stack) {
                const child = staticMount(layer);
                if (child !== null) visit(layer.handle.stack, join(prefix, child));
            }
        }
    };
    visit(router?.stack, publicPrefix);
    return output;
};
