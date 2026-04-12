// ============================================
// Server-Sent Events (SSE) Event Bus
// ============================================
// In-memory event bus for real-time message push.
// Manages SSE client connections and broadcasts events.

import { EventEmitter } from 'events';

class SSEEventBus extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(1000); // Support many concurrent clients
        /** @type {Map<string, Set<import('http').ServerResponse>>} */
        this.clients = new Map(); // key: 'admin' or 'tenant:{id}' → Set of res objects
    }

    /**
     * Register an SSE client connection.
     * @param {string} channel - 'admin' or 'tenant:{tenantId}'
     * @param {import('http').ServerResponse} res
     */
    addClient(channel, res) {
        if (!this.clients.has(channel)) {
            this.clients.set(channel, new Set());
        }
        this.clients.get(channel).add(res);

        // Clean up on disconnect
        res.on('close', () => {
            this.clients.get(channel)?.delete(res);
            if (this.clients.get(channel)?.size === 0) {
                this.clients.delete(channel);
            }
        });
    }

    /**
     * Send an SSE event to all clients on a channel.
     * @param {string} channel
     * @param {string} event - event name (e.g., 'message:new')
     * @param {object} data
     */
    broadcast(channel, event, data) {
        const clients = this.clients.get(channel);
        if (!clients || clients.size === 0) return;

        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        for (const res of clients) {
            try {
                res.write(payload);
            } catch (e) {
                // Client disconnected, remove it
                clients.delete(res);
            }
        }
    }

    /**
     * Emit a new message event to the relevant channels.
     * @param {object} message - { tenant_id, direction, sender, recipient, ... }
     */
    emitNewMessage(message) {
        // Always notify admin
        this.broadcast('admin', 'message:new', message);

        // Notify the tenant channel if applicable
        if (message.tenant_id) {
            this.broadcast(`tenant:${message.tenant_id}`, 'message:new', message);
        }
    }

    /**
     * Emit a message status update.
     * @param {object} statusUpdate - { wamid, status, tenant_id }
     */
    emitStatusUpdate(statusUpdate) {
        this.broadcast('admin', 'message:status', statusUpdate);

        if (statusUpdate.tenant_id) {
            this.broadcast(`tenant:${statusUpdate.tenant_id}`, 'message:status', statusUpdate);
        }
    }

    /**
     * Emit a conversation list update (new message arrived → sidebar refresh).
     */
    emitConversationUpdate(tenantId) {
        this.broadcast('admin', 'conversation:update', { tenant_id: tenantId });

        if (tenantId) {
            this.broadcast(`tenant:${tenantId}`, 'conversation:update', { tenant_id: tenantId });
        }
    }

    /**
     * Get connected client count for monitoring.
     */
    getClientCount() {
        let total = 0;
        for (const clients of this.clients.values()) {
            total += clients.size;
        }
        return total;
    }
}

// Singleton instance
const eventBus = new SSEEventBus();
export default eventBus;
