import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import HomePage from './pages/HomePage';
import App from './App';
import InspectPage from './pages/InspectPage';
import LoginPage from './pages/LoginPage';
import ReportsPage from './pages/ReportsPage';
import ReportDetailPage from './pages/ReportDetailPage';
import UsersPage from './pages/admin/UsersPage';
import InvitesPage from './pages/admin/InvitesPage';
import OrdersPage from './pages/admin/OrdersPage';
import InviteAcceptPage from './pages/InviteAcceptPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import ChangePasswordPage from './pages/ChangePasswordPage';

// Staff-only pages: the rep inspection tool's APIs now require login.
function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? children : <Navigate to="/login" replace />;
}

function RequireAdmin({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/quote" element={<App />} />
      <Route path="/inspect" element={<RequireAuth><InspectPage /></RequireAuth>} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reports" element={<ReportsPage />} />
      <Route path="/reports/:id" element={<ReportDetailPage />} />
      <Route path="/invite/:token" element={<InviteAcceptPage />} />
      <Route path="/reset" element={<ResetPasswordPage />} />
      <Route path="/reset/:token" element={<ResetPasswordPage />} />
      <Route path="/account/password" element={<RequireAuth><ChangePasswordPage /></RequireAuth>} />
      <Route path="/admin/users" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
      <Route path="/admin/invites" element={<RequireAdmin><InvitesPage /></RequireAdmin>} />
      <Route path="/admin/orders" element={<RequireAdmin><OrdersPage /></RequireAdmin>} />
    </Routes>
  );
}
