import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import MainLayout from './components/Layout/MainLayout';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TenantProvider } from './context/TenantContext';

// Admin Pages
import Login from './pages/Login/Login';
import Dashboard from './pages/Dashboard/Dashboard';
import TenantList from './pages/Tenants/TenantList';
import WhatsAppConsole from './pages/WhatsAppConsole/WhatsAppConsole';
import WhatsAppChat from './pages/WhatsAppChat/WhatsAppChat';
import Logs from './pages/Logs/Logs';
import Settings from './pages/Settings/Settings';
import AdminTemplates from './pages/Templates/AdminTemplates';

// Public Pages
import PrivacyPolicy from './pages/PrivacyPolicy/PrivacyPolicy';
import LandingPage from './pages/Landing/LandingPage';

// Tenant Portal Pages
import TenantDashboard from './pages/TenantPortal/TenantDashboard';
import TenantChat from './pages/TenantPortal/TenantChat';
import TenantTemplates from './pages/TenantPortal/TenantTemplates';
import TenantApiSettings from './pages/TenantPortal/TenantApiSettings';
import TenantBusinessProfile from './pages/TenantPortal/TenantBusinessProfile';
import TenantAnalytics from './pages/TenantPortal/TenantAnalytics';
import TenantQRCodes from './pages/TenantPortal/TenantQRCodes';
import TenantConversions from './pages/TenantPortal/TenantConversions';

// Admin Feature Pages
import BusinessManager from './pages/Settings/BusinessManager';
import FacebookPages from './pages/Settings/FacebookPages';
import PartnerSolutions from './pages/Settings/PartnerSolutions';

// Protected Route wrapper
const ProtectedRoute = ({ children, requireAdmin = false, requireTenant = false }) => {
  const { isAuthenticated, loading, isTenant, isAdmin } = useAuth();

  if (loading) {
    return (
      <Box sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default'
      }}>
        <Box sx={{ textAlign: 'center' }}>
          <CircularProgress size={40} thickness={4} />
          <p style={{ marginTop: '1rem', color: 'text.secondary' }}>جاري التحميل...</p>
        </Box>
      </Box>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Role-based access control
  if (requireAdmin && !isAdmin) {
    return <Navigate to="/portal" replace />;
  }

  if (requireTenant && !isTenant) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

function AppRoutes() {
  const { isAuthenticated, isTenant } = useAuth();

  return (
    <Routes>
      {/* Public routes */}
      <Route
        path="/"
        element={
          isAuthenticated
            ? <Navigate to={isTenant ? '/portal' : '/dashboard'} replace />
            : <LandingPage />
        }
      />
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to={isTenant ? '/portal' : '/dashboard'} replace /> : <Login />}
      />
      <Route path="/privacy-policy" element={<PrivacyPolicy />} />

      {/* ============================================ */}
      {/* Admin Routes */}
      {/* ============================================ */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute requireAdmin>
            <MainLayout><Dashboard /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/tenants"
        element={
          <ProtectedRoute requireAdmin>
            <MainLayout><TenantList /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/whatsapp"
        element={
          <ProtectedRoute requireAdmin>
            <MainLayout><WhatsAppConsole /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/chat"
        element={
          <ProtectedRoute requireAdmin>
            <MainLayout><WhatsAppChat /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/logs"
        element={
          <ProtectedRoute requireAdmin>
            <MainLayout><Logs /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute requireAdmin>
            <MainLayout><Settings /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/templates"
        element={
          <ProtectedRoute requireAdmin>
            <MainLayout><AdminTemplates /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/business-manager"
        element={
          <ProtectedRoute requireAdmin>
            <MainLayout><BusinessManager /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/facebook-pages"
        element={
          <ProtectedRoute requireAdmin>
            <MainLayout><FacebookPages /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/partner-solutions"
        element={
          <ProtectedRoute requireAdmin>
            <MainLayout><PartnerSolutions /></MainLayout>
          </ProtectedRoute>
        }
      />

      {/* ============================================ */}
      {/* Tenant Portal Routes */}
      {/* ============================================ */}
      <Route
        path="/portal"
        element={
          <ProtectedRoute requireTenant>
            <MainLayout><TenantDashboard /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/portal/chat"
        element={
          <ProtectedRoute requireTenant>
            <MainLayout><TenantChat /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/portal/templates"
        element={
          <ProtectedRoute requireTenant>
            <MainLayout><TenantTemplates /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/portal/api-settings"
        element={
          <ProtectedRoute requireTenant>
            <MainLayout><TenantApiSettings /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/portal/business-profile"
        element={
          <ProtectedRoute requireTenant>
            <MainLayout><TenantBusinessProfile /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/portal/analytics"
        element={
          <ProtectedRoute requireTenant>
            <MainLayout><TenantAnalytics /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/portal/qr-codes"
        element={
          <ProtectedRoute requireTenant>
            <MainLayout><TenantQRCodes /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/portal/conversions"
        element={
          <ProtectedRoute requireTenant>
            <MainLayout><TenantConversions /></MainLayout>
          </ProtectedRoute>
        }
      />

      {/* 404 */}
      <Route
        path="*"
        element={
          <ProtectedRoute>
            <MainLayout>
              <div style={{ textAlign: 'center', marginTop: '5rem' }}>
                <h1>404 | صفحة غير موجودة</h1>
              </div>
            </MainLayout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TenantProvider>
          <AppRoutes />
        </TenantProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;

