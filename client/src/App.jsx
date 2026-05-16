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
import FacebookOAuthCallback from './pages/Auth/FacebookOAuthCallback';

// Tenant Portal Pages
import TenantDashboard from './pages/TenantPortal/TenantDashboard';
import TenantChat from './pages/TenantPortal/TenantChat';
import TenantTemplates from './pages/TenantPortal/TenantTemplates';
import TenantApiSettings from './pages/TenantPortal/TenantApiSettings';
import TenantBusinessProfile from './pages/TenantPortal/TenantBusinessProfile';
import TenantAnalytics from './pages/TenantPortal/TenantAnalytics';
import TenantQRCodes from './pages/TenantPortal/TenantQRCodes';
import TenantConversions from './pages/TenantPortal/TenantConversions';
import TenantContacts from './pages/TenantPortal/TenantContacts';
import TenantBroadcast from './pages/TenantPortal/TenantBroadcast';
import TenantInbox from './pages/TenantPortal/TenantInbox';
import TenantFacebookPages from './pages/TenantPortal/TenantFacebookPages';
import TenantContentManager from './pages/TenantPortal/TenantContentManager';
import TenantAutomation from './pages/TenantPortal/TenantAutomation';
import TenantFbInsights from './pages/TenantPortal/TenantFbInsights';
import TenantMetaReview from './pages/TenantPortal/TenantMetaReview';

// Admin Feature Pages
import BusinessManager from './pages/Settings/BusinessManager';
import FacebookPages from './pages/Settings/FacebookPages';
import FacebookPageManager from './pages/Facebook/FacebookPageManager';
import MessengerInbox from './pages/Facebook/MessengerInbox';
import FacebookInsights from './pages/Facebook/FacebookInsights';
import PartnerSolutions from './pages/Settings/PartnerSolutions';
import PhoneNumbers from './pages/Settings/PhoneNumbers';
import WebhookSubscriptions from './pages/Settings/WebhookSubscriptions';
import ContactManager from './pages/Contacts/ContactManager';
import BroadcastManager from './pages/Broadcast/BroadcastManager';
import WebhookFailures from './pages/Admin/WebhookFailures';
import UnifiedInbox from './pages/Inbox/UnifiedInbox';
import AutomationManager from './pages/Automation/AutomationManager';

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
      <Route path="/auth/facebook/callback" element={<FacebookOAuthCallback />} />

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
        path="/contacts"
        element={
          <ProtectedRoute requireAdmin>
            <MainLayout><ContactManager /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/broadcast"
        element={
          <ProtectedRoute requireAdmin>
            <MainLayout><BroadcastManager /></MainLayout>
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
        path="/webhook-failures"
        element={
          <ProtectedRoute requireAdmin>
            <MainLayout><WebhookFailures /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/inbox"
        element={
          <ProtectedRoute requireAdmin>
            <MainLayout><UnifiedInbox /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/automation"
        element={
          <ProtectedRoute requireAdmin>
            <MainLayout><AutomationManager /></MainLayout>
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
        path="/fb-manager"
        element={
          <ProtectedRoute requireAdmin>
            <MainLayout><FacebookPageManager /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/messenger"
        element={
          <ProtectedRoute requireAdmin>
            <MainLayout><MessengerInbox /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/fb-insights"
        element={
          <ProtectedRoute requireAdmin>
            <MainLayout><FacebookInsights /></MainLayout>
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
      <Route
        path="/phone-numbers"
        element={
          <ProtectedRoute requireAdmin>
            <MainLayout><PhoneNumbers /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/webhook-subscriptions"
        element={
          <ProtectedRoute requireAdmin>
            <MainLayout><WebhookSubscriptions /></MainLayout>
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
        path="/portal/inbox"
        element={
          <ProtectedRoute requireTenant>
            <MainLayout><TenantInbox /></MainLayout>
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
      <Route
        path="/portal/contacts"
        element={
          <ProtectedRoute requireTenant>
            <MainLayout><TenantContacts /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/portal/broadcast"
        element={
          <ProtectedRoute requireTenant>
            <MainLayout><TenantBroadcast /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/portal/fb-pages"
        element={
          <ProtectedRoute requireTenant>
            <MainLayout><TenantFacebookPages /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/portal/meta-review"
        element={
          <ProtectedRoute requireTenant>
            <MainLayout><TenantMetaReview /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/portal/fb-content"
        element={
          <ProtectedRoute requireTenant>
            <MainLayout><TenantContentManager /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/portal/automation"
        element={
          <ProtectedRoute requireTenant>
            <MainLayout><TenantAutomation /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/portal/fb-insights"
        element={
          <ProtectedRoute requireTenant>
            <MainLayout><TenantFbInsights /></MainLayout>
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
