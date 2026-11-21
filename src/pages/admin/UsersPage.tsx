import { useEffect, useState } from 'react';
import { AdminShell } from '../../components/AdminShell';
import { useAuth } from '../../context/AuthContext';

type StaffUser = {
  id: number;
  name: string;
  username: string;
  role: 'admin' | 'user';
  email: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  disabled: boolean;
};

type ResetOffer = {
  reason: string;
  link: string;
};

function when(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function UsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [emails, setEmails] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmRow, setConfirmRow] = useState<StaffUser | null>(null);
  const [resetOffer, setResetOffer] = useState<ResetOffer | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () => {
    setLoading(true);
    fetch('/api/admin/users', { credentials: 'include' })
      .then(async r => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Could not load users');
        const rows: StaffUser[] = data.users || [];
        setUsers(rows);
        setEmails(Object.fromEntries(rows.map(row => [row.id, row.email || ''])));
        setError('');
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const toggle = async (row: StaffUser) => {
    const next = !row.disabled;
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
      setToast(`${data.user.name} (${data.user.username}) ${next ? 'disabled' : 'enabled'}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const saveEmail = async (row: StaffUser) => {
    setBusyId(row.id);
    setError('');
    try {
      const res = await fetch(`/api/admin/users/${row.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emails[row.id] ?? '' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not update email');
      setUsers(list => list.map(u => u.id === row.id ? data.user : u));
      setEmails(current => ({ ...current, [row.id]: data.user.email || '' }));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const sendReset = async (row: StaffUser) => {
    setBusyId(row.id);
    setError('');
    setCopied(false);
    try {
      const res = await fetch(`/api/admin/users/${row.id}/reset-link`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not create a reset link');
      if (data.sent) {
        setResetOffer(null);
        setToast(`Reset link emailed for ${row.username}. It expires in 1 hour.`);
        return;
      }
      setResetOffer({ reason: data.reason || 'Email not configured', link: data.link || '' });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const copyLink = async () => {
    if (!resetOffer?.link) return;
    try {
      await navigator.clipboard.writeText(resetOffer.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <AdminShell title="Users" subtitle="Staff accounts. Passwords are never shown.">
      {error && <div className="error-msg">{error}</div>}
      {toast && <div className="admin-toast" role="status">{toast}</div>}
      <div className="admin-card">
        {loading ? <p className="admin-empty">Loading users…</p> : users.length === 0 ? <p className="admin-empty">No users yet.</p> : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Email</th>
                <th>Role</th>
                <th>Created</th>
                <th>Last login</th>
                <th>Status</th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map(row => {
                const self = row.id === user?.id;
                return (
                  <tr key={row.id}>
                    <td data-label="Name"><strong>{row.name}</strong></td>
                    <td data-label="Username"><span className="admin-username">{row.username}</span></td>
                    <td data-label="Email">
                      <form className="admin-email" onSubmit={e => { e.preventDefault(); saveEmail(row); }}>
                        <input
                          className="input"
                          type="email"
                          aria-label={`Email for ${row.username}`}
                          value={emails[row.id] ?? ''}
                          onChange={e => setEmails(current => ({ ...current, [row.id]: e.target.value }))}
                        />
                        <button type="submit" className="btn btn--outline btn--auto" disabled={busyId === row.id}>Save</button>
                      </form>
                    </td>
                    <td data-label="Role"><span className={`pill ${row.role === 'admin' ? 'pill--admin' : 'pill--user'}`}>{row.role}</span></td>
                    <td data-label="Created">{when(row.createdAt)}</td>
                    <td data-label="Last login">{when(row.lastLoginAt)}</td>
                    <td data-label="Status"><span className={`pill ${row.disabled ? 'pill--off' : 'pill--ok'}`}>{row.disabled ? 'Disabled' : 'Active'}</span></td>
                    <td data-label="Access">
                      <button
                        type="button"
                        className={`btn btn--auto ${row.disabled ? 'btn--outline' : 'btn--danger'}`}
                        disabled={busyId === row.id || (self && !row.disabled)}
                        onClick={() => row.disabled ? toggle(row) : setConfirmRow(row)}
                      >
                        {self && !row.disabled ? 'Your account' : row.disabled ? 'Enable' : 'Disable'}
                      </button>
                    </td>
                    <td data-label="Reset">
                      <button
                        type="button"
                        className="btn btn--outline btn--auto"
                        disabled={busyId === row.id}
                        onClick={() => sendReset(row)}
                      >
                        Send password reset link
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {confirmRow && (
        <div className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="disable-title">
          <div className="admin-modal__card">
            <p id="disable-title">Disable {confirmRow.name} (username: {confirmRow.username})? They will not be able to sign in.</p>
            <div className="admin-modal__actions">
              <button type="button" className="btn btn--outline btn--auto" onClick={() => setConfirmRow(null)}>Cancel</button>
              <button type="button" className="btn btn--danger btn--auto" onClick={() => { const row = confirmRow; setConfirmRow(null); toggle(row); }}>Disable</button>
            </div>
          </div>
        </div>
      )}
      {resetOffer && (
        <div className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="reset-title">
          <div className="admin-modal__card">
            <p id="reset-title">{resetOffer.reason}</p>
            <p className="admin-hint">This link is shown once. It expires in 24 hours.</p>
            <div className="admin-linkbox__row">
              <input className="input" readOnly value={resetOffer.link} aria-label="Password reset link" />
              <button type="button" className="btn btn--primary btn--auto" onClick={copyLink}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
            <div className="admin-modal__actions">
              <button type="button" className="btn btn--outline btn--auto" onClick={() => setResetOffer(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
