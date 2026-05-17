export const getDistanceFromBottom = (container) => {
    if (!container) return 0;
    return Math.max(0, container.scrollHeight - container.scrollTop - container.clientHeight);
};

export const isNearBottom = (container, threshold = 300) => (
    !container || getDistanceFromBottom(container) <= threshold
);

export const scrollElementToBottom = (container, behavior = 'auto') => {
    if (!container) return;

    if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top: container.scrollHeight, behavior });
        return;
    }

    container.scrollTop = container.scrollHeight;
};
