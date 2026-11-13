import { useEffect, useState } from 'react';
import { AdminShell } from '../../components/AdminShell';

type Invite = {
  id: number;
  name: string;
  username: string;
  email: string | null;
  createdAt: string;
  expiresAt: string;
};

function when(value: string) {
  return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function InvitesPage() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const load = () => {
    fetch('/api/admin/invites', { credentials: 'include' })
      .then(async r => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Could not load invites');
        setInvites(data.invites || []);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setCopied(false);
    try {
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, username, email: email.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not create invite');
      setInviteUrl(data.inviteUrl);
      setName('');
      setUsername('');
      setEmail('');
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const revoke = async (row: Invite) => {
    if (!window.confirm(`Revoke the invite for ${row.name}? The link will stop working.`)) return;
    setError('');
    const res = await fetch(`/api/admin/invites/${row.id}/revoke`, { method: 'POST', credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || 'Could not revoke invite');
      return;
    }
    setInvites(list => list.filter(i => i.id !== row.id));
  };

  return (
    <AdminShell title="Invites" subtitle="Create a one-time link. Nothing is emailed or texted — copy the link and send it yourself.">
      {error && <div className="error-msg">{error}</div>}
      <form className="admin-card admin-form" onSubmit={create}>
        <div className="admin-form__grid">
          <div className="form-group">
            <label htmlFor="invite-name">Name</label>
            <input id="invite-name" className="input" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div className="form-group">
            <label htmlFor="invite-username">Username</label>
            <input id="invite-username" className="input" value={username} onChange={e => setUsername(e.target.value)} autoCapitalize="none" required />
          </div>
          <div className="form-group">
            <label htmlFor="invite-email">Email (optional)</label>
            <input id="invite-email" className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Not sent" />
          </div>
        </div>
        <button type="submit" className="btn btn--primary btn--auto" disabled={saving}>{saving ? 'Creating…' : 'Create invite link'}</button>
      </form>

      {inviteUrl && (
        <div className="admin-linkbox">
          <div className="admin-linkbox__label">One-time invite link</div>
          <p>This is the only time the link is shown. It expires in 7 days and works once. It will not reset an existing account.</p>
          <div className="admin-linkbox__row">
            <input className="input" readOnly value={inviteUrl} onFocus={e => e.currentTarget.select()} aria-label="Invite link" />
            <button type="button" className="btn btn--primary btn--auto" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
          </div>
        </div>
      )}

      <h2 className="admin-section">Pending invites</h2>
      <div className="admin-card">
        {loading ? <p className="admin-empty">Loading invites…</p> : invites.length === 0 ? <p className="admin-empty">No pending invites.</p> : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Email</th>
                <th>Expires</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invites.map(row => (
                <tr key={row.id}>
                  <td data-label="Name"><strong>{row.name}</strong></td>
                  <td data-label="Username">{row.username}</td>
                  <td data-label="Email">{row.email || '—'}</td>
                  <td data-label="Expires">{when(row.expiresAt)}</td>
                  <td data-label="Invite">
                    <button type="button" className="btn btn--outline btn--auto" onClick={() => revoke(row)}>Revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AdminShell>
  );
}
