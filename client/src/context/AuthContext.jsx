import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api';

const AuthContext = createContext();

const AUTH_TOKEN_KEY = 'auth_token';
const AUTH_USER_KEY = 'auth_user';
const AUTH_TENANT_KEY = 'auth_tenant';

const readCachedSession = () => {
    try {
        const cachedUser = localStorage.getItem(AUTH_USER_KEY);
        const cachedTenant = localStorage.getItem(AUTH_TENANT_KEY);
        return {
            user: cachedUser ? JSON.parse(cachedUser) : null,
            tenant: cachedTenant ? JSON.parse(cachedTenant) : null,
        };
    } catch {
        return { user: null, tenant: null };
    }
};

const writeCachedSession = (user, tenant) => {
    if (user) {
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    }
    if (tenant) {
        localStorage.setItem(AUTH_TENANT_KEY, JSON.stringify(tenant));
    } else {
        localStorage.removeItem(AUTH_TENANT_KEY);
    }
};

const clearStoredSession = () => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    localStorage.removeItem(AUTH_TENANT_KEY);
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [tenant, setTenant] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Check if user is logged in on mount
    useEffect(() => {
        const token = localStorage.getItem(AUTH_TOKEN_KEY);
        if (token) {
            api.setAuthToken(token);
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
            writeCachedSession(data.user, data.tenant || null);
        } catch (err) {
            console.error('Token verification failed:', err);
            if (err.status === 401 || err.status === 403) {
                clearStoredSession();
                api.setAuthToken(null);
                setUser(null);
                setTenant(null);
            } else {
                const cached = readCachedSession();
                if (cached.user) {
                    setUser(cached.user);
                    setTenant(cached.tenant || null);
                    api.setAuthToken(token);
                    setError('تعذر التحقق من الجلسة حالياً. سيتم استخدام آخر جلسة محفوظة حتى يستجيب الخادم.');
                } else {
                    setUser(null);
                    setTenant(null);
                    setError('تعذر التحقق من الجلسة حالياً. أعد تحميل الصفحة عند توفر الخادم.');
                }
            }
        } finally {
            setLoading(false);
        }
    };

    const login = useCallback(async (username, password) => {
        try {
            setError(null);
            setLoading(true);
            const data = await api.login(username, password);

            localStorage.setItem(AUTH_TOKEN_KEY, data.token);
            api.setAuthToken(data.token);
            setUser(data.user);
            setTenant(data.tenant || null);
            writeCachedSession(data.user, data.tenant || null);

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

            localStorage.setItem(AUTH_TOKEN_KEY, data.token);
            api.setAuthToken(data.token);
            setUser(data.user);
            setTenant(data.tenant || null);
            writeCachedSession(data.user, data.tenant || null);

            return { success: true };
        } catch (err) {
            setError(err.message);
            return { success: false, error: err.message };
        } finally {
            setLoading(false);
        }
    }, []);

    const logout = useCallback(() => {
        clearStoredSession();
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
