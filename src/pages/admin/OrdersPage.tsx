import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminShell } from '../../components/AdminShell';

type Order = {
  id: number;
  userId: number;
  userName: string;
  username: string;
  address: string;
  createdAt: string;
  status: string;
  areaSqFt: number | null;
  squares: number | null;
  quoteLow: number | null;
  quoteHigh: number | null;
};

type StaffUser = { id: number; name: string; username: string };

function money(n: number | null) {
  if (n == null) return null;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function statusClass(status: string) {
  if (status === 'poor') return 'pill--off';
  if (status === 'fair') return 'pill--warn';
  if (status === 'good') return 'pill--ok';
  return 'pill--user';
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [q, setQ] = useState('');
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/admin/users', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { users: [] })
      .then(data => setUsers(data.users || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (userId) params.set('userId', userId);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      setLoading(true);
      fetch(`/api/admin/orders?${params.toString()}`, { credentials: 'include' })
        .then(async r => {
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(data.error || 'Could not load orders');
          setOrders(data.orders || []);
          setError('');
        })
        .catch((err: Error) => setError(err.message))
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [q, userId, from, to]);

  return (
    <AdminShell
      title="All orders"
      subtitle="Every saved inspection report, newest first. A report is the measurement on file: who ran it, the address, roof area, and squares."
    >
      {error && <div className="error-msg">{error}</div>}
      <div className="admin-card admin-form">
        <div className="admin-filters">
          <div className="form-group">
            <label htmlFor="order-q">Search</label>
            <input id="order-q" className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Address, name, or username" />
          </div>
          <div className="form-group">
            <label htmlFor="order-user">User</label>
            <select id="order-user" className="input" value={userId} onChange={e => setUserId(e.target.value)}>
              <option value="">Everyone</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="order-from">From</label>
            <input id="order-from" className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="order-to">To</label>
            <input id="order-to" className="input" type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="admin-card">
        {loading ? <p className="admin-empty">Loading orders…</p> : orders.length === 0 ? <p className="admin-empty">No matching orders.</p> : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Who</th>
                <th>Address</th>
                <th>Date</th>
                <th>Status</th>
                <th>Area</th>
                <th>Squares</th>
                <th>Quote</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map(row => {
                const low = money(row.quoteLow);
                const high = money(row.quoteHigh);
                const quote = low && high ? `${low} – ${high}` : '—';
                return (
                  <tr key={row.id}>
                    <td data-label="Who"><strong>{row.userName}</strong><div className="admin-meta">{row.username}</div></td>
                    <td data-label="Address">{row.address}</td>
                    <td data-label="Date">{new Date(row.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    <td data-label="Status"><span className={`pill ${statusClass(row.status)}`}>{row.status}</span></td>
                    <td data-label="Area">{row.areaSqFt != null ? `${row.areaSqFt.toLocaleString()} sq ft` : '—'}</td>
                    <td data-label="Squares">{row.squares != null ? row.squares : '—'}</td>
                    <td data-label="Quote">{quote}</td>
                    <td data-label="Report"><Link className="btn btn--outline btn--auto admin-open" to={`/reports/${row.id}`}>Open</Link></td>
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
