export const notificationMethods = {
    async getNotificationConfig() {
        return this.request('/api/notifications/config', {
            suppressErrorStatuses: [404, 503],
        });
    },

    async savePushSubscription(subscription) {
        return this.request('/api/notifications/subscription', {
            method: 'PUT',
            body: JSON.stringify({ subscription }),
        });
    },

    async deletePushSubscription(endpoint, { keepalive = false } = {}) {
        return this.request('/api/notifications/subscription', {
            method: 'DELETE',
            body: JSON.stringify({ endpoint }),
            keepalive,
        });
    },

    async getNotificationPreferences() {
        return this.request('/api/notifications/preferences');
    },

    async updateNotificationPreferences(preferences) {
        return this.request('/api/notifications/preferences', {
            method: 'PATCH',
            body: JSON.stringify(preferences),
        });
    },
};
