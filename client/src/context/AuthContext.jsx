import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api';

const AuthContext = createContext();

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [tenant, setTenant] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Check if user is logged in on mount
    useEffect(() => {
        const token = localStorage.getItem('auth_token');
        if (token) {
            verifyToken(token);
        } else {
            setLoading(false);
        }
    }, []);

    const verifyToken = async (token) => {
        try {
            setLoading(true);
            const data = await api.getCurrentUser(token);
            setUser(data.user);
            setTenant(data.tenant || null);
            api.setAuthToken(token);
        } catch (err) {
            console.error('Token verification failed:', err);
            localStorage.removeItem('auth_token');
            setUser(null);
            setTenant(null);
        } finally {
            setLoading(false);
        }
    };

    const login = useCallback(async (username, password) => {
        try {
            setError(null);
            setLoading(true);
            const data = await api.login(username, password);

            localStorage.setItem('auth_token', data.token);
            api.setAuthToken(data.token);
            setUser(data.user);
            setTenant(data.tenant || null);

            return { success: true };
        } catch (err) {
            setError(err.message);
            return { success: false, error: err.message };
        } finally {
            setLoading(false);
        }
    }, []);

    const register = useCallback(async (userData) => {
        try {
            setError(null);
            setLoading(true);
            const data = await api.register(userData);

            localStorage.setItem('auth_token', data.token);
            api.setAuthToken(data.token);
            setUser(data.user);
            setTenant(data.tenant || null);

            return { success: true };
        } catch (err) {
            setError(err.message);
            return { success: false, error: err.message };
        } finally {
            setLoading(false);
        }
    }, []);

    const logout = useCallback(() => {
        localStorage.removeItem('auth_token');
        api.setAuthToken(null);
        setUser(null);
        setTenant(null);
    }, []);

    const changePassword = useCallback(async (currentPassword, newPassword) => {
        try {
            await api.changePassword(currentPassword, newPassword);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }, []);

    // Computed values
    const isAuthenticated = !!user;
    const isTenant = !!user?.tenant_id || !!tenant;
    const isAdmin = user?.role === 'admin' && !user?.tenant_id;

    return (
        <AuthContext.Provider value={{
            user,
            tenant,
            loading,
            error,
            isAuthenticated,
            isTenant,
            isAdmin,
            login,
            register,
            logout,
            changePassword
        }}>
            {children}
        </AuthContext.Provider>
    );
};

