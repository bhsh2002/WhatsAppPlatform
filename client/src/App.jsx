import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Layout/Sidebar';
import Dashboard from './pages/Dashboard/Dashboard';
import TenantList from './pages/Tenants/TenantList';
import WhatsAppConsole from './pages/WhatsAppConsole/WhatsAppConsole';
import Settings from './pages/Settings/Settings';
import Logs from './pages/Logs/Logs';
import Login from './pages/Login/Login';
import { TenantProvider } from './context/TenantContext';
import { AuthProvider, useAuth } from './context/AuthContext';

// Protected Route wrapper
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'hsl(var(--color-background))'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '48px',
            height: '48px',
            border: '3px solid hsl(var(--color-secondary))',
            borderTop: '3px solid hsl(var(--color-accent))',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 1rem'
          }} />
          <p style={{ color: 'hsl(var(--color-muted-foreground))' }}>جاري التحميل...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

// Main layout with sidebar
const MainLayout = ({ children }) => (
  <div className="layout-wrapper">
    <Sidebar />
    <main className="main-content">
      {children}
    </main>
  </div>
);

function AppRoutes() {
  const { isAuthenticated } = useAuth();

  return (
    <Routes>
      {/* Public route */}
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <Login />}
      />

      {/* Protected routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <MainLayout><Dashboard /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/tenants"
        element={
          <ProtectedRoute>
            <MainLayout><TenantList /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/whatsapp"
        element={
          <ProtectedRoute>
            <MainLayout><WhatsAppConsole /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/logs"
        element={
          <ProtectedRoute>
            <MainLayout><Logs /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <MainLayout><Settings /></MainLayout>
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
