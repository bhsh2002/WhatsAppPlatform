export const parseBoundedInteger = (value, {
    fallback,
    min = 0,
    max = Number.MAX_SAFE_INTEGER,
} = {}) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
};

export const parseListPagination = (query = {}, {
    defaultLimit = 50,
    maxLimit = 200,
    maxOffset = 1_000_000,
} = {}) => ({
    limit: parseBoundedInteger(query.limit, { fallback: defaultLimit, min: 1, max: maxLimit }),
    offset: parseBoundedInteger(query.offset, { fallback: 0, min: 0, max: maxOffset }),
});

export const parsePagePagination = (query = {}, options = {}) => {
    const { limit } = parseListPagination(query, options);
    const page = parseBoundedInteger(query.page, {
        fallback: 1,
        min: 1,
        max: options.maxPage || 100_000,
    });
    return { page, limit, offset: (page - 1) * limit };
};
