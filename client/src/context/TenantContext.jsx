import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api';
import { useAuth } from './AuthContext';

const TenantContext = createContext();

// eslint-disable-next-line react-refresh/only-export-components
export const useTenants = () => useContext(TenantContext);

export const TenantProvider = ({ children }) => {
    const { isAdmin, isAuthenticated } = useAuth();
    const [tenants, setTenants] = useState([]);
    const [stats, setStats] = useState({
        total: 0,
        active: 0,
        warning: 0,
        critical: 0,
        wa_today: 0, wa_week: 0, fb_today: 0, fb_week: 0,
        wa_sent_today: 0, wa_received_today: 0, fb_conversations: 0,
        linked_pages: 0, total_messages_today: 0, total_messages_week: 0,
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Fetch tenants from backend (admin-only)
    const fetchTenants = useCallback(async () => {
        if (!isAdmin) return;
        try {
            setLoading(true);
            setError(null);
            const data = await api.getTenants();
            setTenants(data);
        } catch (err) {
            setError(err.message);
            console.error('Failed to fetch tenants:', err);
        } finally {
            setLoading(false);
        }
    }, [isAdmin]);

    // Fetch stats from backend (admin-only)
    const fetchStats = useCallback(async () => {
        if (!isAdmin) return;
        try {
            const data = await api.getDashboardStats();
            setStats(data);
        } catch (err) {
            console.error('Failed to fetch stats:', err);
            // Calculate from local tenants as fallback
            setStats({
                total: tenants.length,
                active: tenants.filter(t => t.status === 'Active').length,
                warning: tenants.filter(t => t.quality === 'Medium' || t.status === 'Warning').length,
                critical: tenants.filter(t => t.quality === 'Low' || t.status === 'Suspended').length,
                wa_today: 0, wa_week: 0, fb_today: 0, fb_week: 0,
                wa_sent_today: 0, wa_received_today: 0, fb_conversations: 0,
                linked_pages: 0, total_messages_today: 0, total_messages_week: 0,
            });
        }
    }, [isAdmin, tenants]);

    // Create tenant
    const createTenant = useCallback(async (data) => {
        const newTenant = await api.createTenant(data);
        setTenants(prev => [newTenant, ...prev]);
        fetchStats();
        return newTenant;
    }, [fetchStats]);

    // Update tenant
    const updateTenant = useCallback(async (id, data) => {
        const updatedTenant = await api.updateTenant(id, data);
        setTenants(prev => prev.map(t => t.id === id ? updatedTenant : t));
        fetchStats();
        return updatedTenant;
    }, [fetchStats]);

    // Delete tenant
    const deleteTenant = useCallback(async (id) => {
        await api.deleteTenant(id);
        setTenants(prev => prev.filter(t => t.id !== id));
        fetchStats();
    }, [fetchStats]);

    // Initial load — only for admin users
    useEffect(() => {
        if (isAuthenticated && isAdmin) {
            fetchTenants();
        }
    }, [isAuthenticated, isAdmin, fetchTenants]);

    // Refresh stats on login and whenever the tenant snapshot changes.
    useEffect(() => {
        if (isAuthenticated && isAdmin) {
            fetchStats();
        }
    }, [isAuthenticated, isAdmin, fetchStats]);

    return (
        <TenantContext.Provider value={{
            tenants,
            setTenants,
            stats,
            loading,
            error,
            fetchTenants,
            fetchStats,
            createTenant,
            updateTenant,
            deleteTenant
        }}>
            {children}
        </TenantContext.Provider>
    );
};
