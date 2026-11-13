import { useEffect, useState } from 'react';
import { AdminShell } from '../../components/AdminShell';
import { useAuth } from '../../context/AuthContext';

type StaffUser = {
  id: number;
  name: string;
  username: string;
  role: 'admin' | 'user';
  createdAt: string;
  lastLoginAt: string | null;
  disabled: boolean;
};

function when(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function UsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    fetch('/api/admin/users', { credentials: 'include' })
      .then(async r => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Could not load users');
        setUsers(data.users || []);
        setError('');
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const toggle = async (row: StaffUser) => {
    const next = !row.disabled;
    if (next && !window.confirm(`Disable ${row.name}? They will not be able to sign in.`)) return;
    setBusyId(row.id);
    setError('');
    try {
      const res = await fetch(`/api/admin/users/${row.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not update user');
      setUsers(list => list.map(u => u.id === row.id ? data.user : u));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AdminShell title="Users" subtitle="Staff accounts. Passwords are never shown.">
      {error && <div className="error-msg">{error}</div>}
      <div className="admin-card">
        {loading ? <p className="admin-empty">Loading users…</p> : users.length === 0 ? <p className="admin-empty">No users yet.</p> : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Created</th>
                <th>Last login</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map(row => {
                const self = row.id === user?.id;
                return (
                  <tr key={row.id}>
                    <td data-label="Name"><strong>{row.name}</strong></td>
                    <td data-label="Username">{row.username}</td>
                    <td data-label="Role"><span className={`pill ${row.role === 'admin' ? 'pill--admin' : 'pill--user'}`}>{row.role}</span></td>
                    <td data-label="Created">{when(row.createdAt)}</td>
                    <td data-label="Last login">{when(row.lastLoginAt)}</td>
                    <td data-label="Status"><span className={`pill ${row.disabled ? 'pill--off' : 'pill--ok'}`}>{row.disabled ? 'Disabled' : 'Active'}</span></td>
                    <td data-label="Access">
                      <button
                        type="button"
                        className={`btn btn--auto ${row.disabled ? 'btn--outline' : 'btn--danger'}`}
                        disabled={busyId === row.id || (self && !row.disabled)}
                        onClick={() => toggle(row)}
                      >
                        {self && !row.disabled ? 'Your account' : row.disabled ? 'Enable' : 'Disable'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </AdminShell>
  );
}
