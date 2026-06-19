import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { clearOmegaToken, omegaLogin, omegaLogout, omegaMe, setOmegaToken, type OmegaUser } from './api';
import { OmegaLayout } from './components/OmegaLayout';
import { OmegaLogin } from './pages/OmegaLogin';
import { OmegaDashboard } from './pages/OmegaDashboard';
import { OmegaClients } from './pages/OmegaClients';
import { OmegaClientForm } from './pages/OmegaClientForm';
import { OmegaClientDetails } from './pages/OmegaClientDetails';
import { OmegaPlans } from './pages/OmegaPlans';
import { OmegaSessions } from './pages/OmegaSessions';
import { OmegaUsage } from './pages/OmegaUsage';
import { OmegaLimits } from './pages/OmegaLimits';
import { OmegaStaff } from './pages/OmegaStaff';
import { OmegaSettings } from './pages/OmegaSettings';
import './styles/omega.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

function OmegaRoutes() {
  const [user, setUser] = useState<OmegaUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    omegaMe()
      .then(currentUser => setUser(currentUser))
      .catch(() => clearOmegaToken())
      .finally(() => setLoading(false));
  }, []);

  const handleLogin = async (email: string, password: string) => {
    const result = await omegaLogin(email, password);
    setOmegaToken(result.token);
    setUser(result.user);
    void queryClient.invalidateQueries();
  };

  const handleLogout = async () => {
    try {
      await omegaLogout();
    } catch {
      // Ignore logout transport errors and still clear local state.
    }
    clearOmegaToken();
    setUser(null);
    queryClient.clear();
  };

  if (loading) {
    return <div className="omega-login-shell"><div className="omega-login-card">Loading Omega admin...</div></div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        {!user ? (
          <>
            <Route path="/omega/login" element={<OmegaLogin onLogin={handleLogin} />} />
            <Route path="*" element={<Navigate to="/omega/login" replace />} />
          </>
        ) : (
          <>
            <Route path="/omega" element={<OmegaLayout user={user} onLogout={handleLogout} />}>
              <Route index element={<OmegaDashboard />} />
              <Route path="clients" element={<OmegaClients />} />
              <Route path="clients/new" element={<OmegaClientForm />} />
              <Route path="clients/:id" element={<OmegaClientDetails />} />
              <Route path="clients/:id/edit" element={<OmegaClientForm />} />
              <Route path="plans" element={<OmegaPlans />} />
              <Route path="sessions" element={<OmegaSessions />} />
              <Route path="usage" element={<OmegaUsage />} />
              <Route path="limits" element={<OmegaLimits />} />
              <Route path="staff" element={<OmegaStaff />} />
              <Route path="settings" element={<OmegaSettings />} />
            </Route>
            <Route path="*" element={<Navigate to="/omega" replace />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}

export function OmegaApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <OmegaRoutes />
    </QueryClientProvider>
  );
}
