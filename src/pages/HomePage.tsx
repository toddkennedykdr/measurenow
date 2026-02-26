import { useAuth } from '../context/AuthContext';
import App from '../App';
import DashboardPage from './DashboardPage';

export default function HomePage() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <DashboardPage /> : <App />;
}
