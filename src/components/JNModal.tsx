import { useState, useRef, RefObject } from 'react';

interface JNJob {
  jnid: string;
  name?: string;
  display_name?: string;
  number?: string;
  status_name?: string;
  address_line1?: string;
  city?: string;
  state_text?: string;
}

interface Props {
  address: string;
  reportRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}

export function JNModal({ address, reportRef, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [jobs, setJobs] = useState<JNJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const handleSearch = async () => {
    if (!search.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/jn/jobs?keyword=${encodeURIComponent(search)}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setJobs(data.results || data.items || data || []);
    } catch (err: any) {
      setError(err.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSendToJob = async (job: JNJob) => {
    setSending(true);
    setError('');
    try {
      const reportHtml = reportRef.current?.innerHTML || '';
      const jobName = job.display_name || job.name || job.number || 'Unknown';
      const res = await fetch('/api/jn/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ jobId: job.jnid, jobName, reportHtml, address }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess(`Report sent to "${jobName}" in JobNimbus ✓`);
    } catch (err: any) {
      setError(err.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, fontFamily: 'Inter, system-ui, sans-serif' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'white', borderRadius: 12, width: '100%', maxWidth: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '20px 20px 12px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, color: '#032D59', fontSize: 18 }}>📤 Send to JobNimbus</h3>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6b7280' }}>✕</button>
          </div>
          {success ? (
            <div style={{ background: '#ecfdf5', color: '#16a34a', padding: '12px 16px', borderRadius: 8, fontWeight: 600 }}>{success}</div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={search} onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Search jobs by name or address..."
                style={{ flex: 1, padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }} autoFocus />
              <button onClick={handleSearch} disabled={loading}
                style={{ padding: '10px 16px', background: '#032D59', color: 'white', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {loading ? '...' : 'Search'}
              </button>
            </div>
          )}
          {error && <div style={{ color: '#E2312B', fontSize: 13, marginTop: 8 }}>{error}</div>}
        </div>
        {!success && (
          <div style={{ overflow: 'auto', flex: 1, padding: '8px 0' }}>
            {jobs.length === 0 && !loading && <div style={{ padding: '24px 20px', textAlign: 'center', color: '#6b7280', fontSize: 14 }}>Search for a job to send this report to.</div>}
            {Array.isArray(jobs) && jobs.map(job => (
              <button key={job.jnid} onClick={() => handleSendToJob(job)} disabled={sending}
                style={{ display: 'block', width: '100%', padding: '12px 20px', border: 'none', borderBottom: '1px solid #f3f4f6', background: 'white', cursor: 'pointer', textAlign: 'left', transition: 'background 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
                onMouseLeave={e => (e.currentTarget.style.background = 'white')}>
                <div style={{ fontWeight: 600, color: '#032D59', fontSize: 14 }}>{job.display_name || job.name || job.number || 'Unnamed'}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  {[job.address_line1, job.city, job.state_text].filter(Boolean).join(', ')}
                  {job.status_name && <span style={{ marginLeft: 8, background: '#e5e7eb', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>{job.status_name}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
