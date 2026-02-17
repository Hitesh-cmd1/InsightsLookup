import React from 'react';
import '@/App.css';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
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

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <AnalyticsTracker />
          <GlobalAuthModal />
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/company-details" element={<CompanyDetails />} />
            <Route path="/profile" element={<ProfilePage />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
      <Toaster position="top-center" richColors />
    </div>
  );
}

export default App;