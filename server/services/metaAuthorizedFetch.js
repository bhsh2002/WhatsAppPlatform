export const fetchMetaWithAccessToken = (
    url,
    accessToken,
    init = {},
    fetchImpl = fetch
) => fetchImpl(url, {
    ...init,
    headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${accessToken}`,
    },
});

