import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api';
import { tx } from "../i18n/tx";
const AuthContext = createContext();
const AUTH_USER_KEY = 'auth_user';
const AUTH_TENANT_KEY = 'auth_tenant';
const readCachedSession = () => {
  try {
    const cachedUser = localStorage.getItem(AUTH_USER_KEY);
    const cachedTenant = localStorage.getItem(AUTH_TENANT_KEY);
    return {
      user: cachedUser ? JSON.parse(cachedUser) : null,
      tenant: cachedTenant ? JSON.parse(cachedTenant) : null
    };
  } catch {
    return {
      user: null,
      tenant: null
    };
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
  localStorage.removeItem(AUTH_USER_KEY);
  localStorage.removeItem(AUTH_TENANT_KEY);
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
export const AuthProvider = ({
  children
}) => {
  const [user, setUser] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const verifySession = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getCurrentUser();
      if (!data.authenticated || !data.user) {
        clearStoredSession();
        api.resetSessionCaches();
        setUser(null);
        setTenant(null);
        setError(null);
        return;
      }
      setUser(data.user);
      setTenant(data.tenant || null);
      writeCachedSession(data.user, data.tenant || null);
      setError(null);
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        clearStoredSession();
        api.resetSessionCaches();
        setUser(null);
        setTenant(null);
      } else {
        console.error('Session verification failed:', err);
        const cached = readCachedSession();
        if (cached.user) {
          setUser(cached.user);
          setTenant(cached.tenant || null);
          setError(tx("auto.k_3ad626e2effa"));
        } else {
          setUser(null);
          setTenant(null);
          setError(tx("auto.k_a31329a74b0b"));
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Check the HttpOnly session on mount. Rotate a legacy localStorage JWT
  // once, then remove it from JavaScript-accessible storage permanently.
  useEffect(() => {
    const initializeSession = async () => {
      const legacyToken = api.takeLegacyAuthToken();
      if (legacyToken) {
        try {
          await api.adoptLegacySession(legacyToken);
        } catch (err) {
          if (err.status !== 401 && err.status !== 403) {
            console.warn('Legacy session migration failed:', err);
          }
        }
      }
      await verifySession();
    };
    initializeSession();
  }, [verifySession]);
  const login = useCallback(async (username, password) => {
    try {
      setError(null);
      setLoading(true);
      const data = await api.login(username, password);
      setUser(data.user);
      setTenant(data.tenant || null);
      writeCachedSession(data.user, data.tenant || null);
      return {
        success: true
      };
    } catch (err) {
      setError(err.message);
      return {
        success: false,
        error: err.message
      };
    } finally {
      setLoading(false);
    }
  }, []);
  const register = useCallback(async userData => {
    try {
      setError(null);
      setLoading(true);
      const data = await api.register(userData);
      setUser(data.user);
      setTenant(data.tenant || null);
      writeCachedSession(data.user, data.tenant || null);
      return {
        success: true
      };
    } catch (err) {
      setError(err.message);
      return {
        success: false,
        error: err.message
      };
    } finally {
      setLoading(false);
    }
  }, []);
  const logout = useCallback(() => {
    const revokeRequest = api.logout().catch(err => {
      console.warn('Server-side logout failed:', err);
    });
    clearStoredSession();
    api.resetSessionCaches();
    setUser(null);
    setTenant(null);
    return revokeRequest;
  }, []);
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    try {
      await api.changePassword(currentPassword, newPassword);
      api.resetSessionCaches();
      return {
        success: true
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }, []);

  // Computed values
  const isAuthenticated = !!user;
  const isTenant = !!user?.tenant_id || !!tenant;
  const isAdmin = user?.role === 'admin' && !user?.tenant_id;
  return <AuthContext.Provider value={{
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
        </AuthContext.Provider>;
};
