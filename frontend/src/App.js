import React from 'react';
import '@/App.css';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './components/LandingPage';
import Dashboard from './components/Dashboard';
import CompanyDetails from './components/CompanyDetails';
import ProfilePage from './components/ProfilePage';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from './context/AuthContext';
import AuthModal from './components/AuthModal';
import { AnalyticsTracker } from './analytics/AnalyticsTracker';

function GlobalAuthModal() {
  const { isAuthModalOpen, closeLogin, authModalCallback } = useAuth();
  return (
    <AuthModal
      isOpen={isAuthModalOpen}
      onClose={closeLogin}
      onSuccess={authModalCallback}
    />
  );
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/" replace />;
  return children;
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <AnalyticsTracker />
          <GlobalAuthModal />
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
            <Route path="/company-details" element={<RequireAuth><CompanyDetails /></RequireAuth>} />
            <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
      <Toaster position="top-center" richColors />
    </div>
  );
}

export default App;
