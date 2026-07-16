import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import MainLayout from './components/Layout/MainLayout';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TenantProvider } from './context/TenantContext';
import { useLanguage } from './context/LanguageContext';

// Admin Pages
const Login = lazy(() => import('./pages/Login/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard/Dashboard'));
const TenantList = lazy(() => import('./pages/Tenants/TenantList'));
const WhatsAppConsole = lazy(() => import('./pages/WhatsAppConsole/WhatsAppConsole'));
const Logs = lazy(() => import('./pages/Logs/Logs'));
const Settings = lazy(() => import('./pages/Settings/Settings'));
const AdminTemplates = lazy(() => import('./pages/Templates/AdminTemplates'));

// Public Pages
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy/PrivacyPolicy'));
const LandingPage = lazy(() => import('./pages/Landing/LandingPage'));
const FacebookOAuthCallback = lazy(() => import('./pages/Auth/FacebookOAuthCallback'));

// Tenant Portal Pages
const TenantDashboard = lazy(() => import('./pages/TenantPortal/TenantDashboard'));
const TenantTemplates = lazy(() => import('./pages/TenantPortal/TenantTemplates'));
const TenantApiSettings = lazy(() => import('./pages/TenantPortal/TenantApiSettings'));
const TenantBusinessProfile = lazy(() => import('./pages/TenantPortal/TenantBusinessProfile'));
const TenantAnalytics = lazy(() => import('./pages/TenantPortal/TenantAnalytics'));
const TenantQRCodes = lazy(() => import('./pages/TenantPortal/TenantQRCodes'));
const TenantConversions = lazy(() => import('./pages/TenantPortal/TenantConversions'));
const TenantContacts = lazy(() => import('./pages/TenantPortal/TenantContacts'));
const TenantBroadcast = lazy(() => import('./pages/TenantPortal/TenantBroadcast'));
const TenantInbox = lazy(() => import('./pages/TenantPortal/TenantInbox'));
const TenantFacebookPages = lazy(() => import('./pages/TenantPortal/TenantFacebookPages'));
const TenantWhatsAppConnect = lazy(() => import('./pages/TenantPortal/TenantWhatsAppConnect'));
const TenantContentManager = lazy(() => import('./pages/TenantPortal/FacebookContentStudioWorkspace'));
const TenantAutomation = lazy(() => import('./pages/TenantPortal/TenantAutomation'));
const TenantFbInsights = lazy(() => import('./pages/TenantPortal/TenantFbInsights'));
const TenantMetaReview = lazy(() => import('./pages/TenantPortal/TenantMetaReview'));
const TenantBilling = lazy(() => import('./pages/TenantPortal/TenantBilling'));

// Admin Feature Pages
const BusinessManager = lazy(() => import('./pages/Settings/BusinessManager'));
const FacebookPageManager = lazy(() => import('./pages/Facebook/FacebookPageManager'));
const FacebookInsights = lazy(() => import('./pages/Facebook/FacebookInsights'));
const PartnerSolutions = lazy(() => import('./pages/Settings/PartnerSolutions'));
const PhoneNumbers = lazy(() => import('./pages/Settings/PhoneNumbers'));
const WebhookSubscriptions = lazy(() => import('./pages/Settings/WebhookSubscriptions'));
const ContactManager = lazy(() => import('./pages/Contacts/ContactManager'));
const BroadcastManager = lazy(() => import('./pages/Broadcast/BroadcastManager'));
const WebhookFailures = lazy(() => import('./pages/Admin/WebhookFailures'));
const UnifiedInbox = lazy(() => import('./pages/Inbox/UnifiedInbox'));
const AutomationManager = lazy(() => import('./pages/Automation/AutomationManager'));
const BillingManager = lazy(() => import('./pages/Billing/BillingManager'));
const MessengerBotManager = lazy(() => import('./pages/MessengerBot/MessengerBotManager'));

// Protected Route wrapper
const ProtectedRoute = ({ children, requireAdmin = false, requireTenant = false }) => {
  const { isAuthenticated, loading, isTenant, isAdmin } = useAuth();
  const { t } = useLanguage();

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
          <p style={{ marginTop: '1rem', color: 'text.secondary' }}>{t('common.loading')}</p>
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
  const { t } = useLanguage();

  return (
    <Suspense fallback={<Box sx={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>}>
    <Routes>
      {/* Public routes */}
      <Route
        path="/"
        element={<LandingPage />}
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
            <Navigate to="/inbox" replace />
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
        path="/billing"
        element={
          <ProtectedRoute requireAdmin>
            <MainLayout><BillingManager /></MainLayout>
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
            <Navigate to="/tenants" replace />
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
            <Navigate to="/inbox" replace />
          </ProtectedRoute>
        }
      />
      <Route
        path="/messenger-bot"
        element={
          <ProtectedRoute requireAdmin>
            <MainLayout><MessengerBotManager /></MainLayout>
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
        path="/portal/billing"
        element={
          <ProtectedRoute requireTenant>
            <MainLayout><TenantBilling /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/portal/chat"
        element={
          <ProtectedRoute requireTenant>
            <Navigate to="/portal/inbox" replace />
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
        path="/portal/whatsapp-connect"
        element={
          <ProtectedRoute requireTenant>
            <MainLayout><TenantWhatsAppConnect /></MainLayout>
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
      <Route
        path="/portal/messenger-bot"
        element={
          <ProtectedRoute requireTenant>
            <MainLayout><MessengerBotManager tenantMode /></MainLayout>
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
                <h1>{t('common.notFound')}</h1>
              </div>
            </MainLayout>
          </ProtectedRoute>
        }
      />
    </Routes>
    </Suspense>
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
