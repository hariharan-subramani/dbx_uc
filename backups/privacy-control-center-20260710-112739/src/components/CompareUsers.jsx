import { useEffect, useMemo, useState } from 'react';
import { exportUserComparison } from '../utils/excelExport';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000';

const sections = [
  ['groups', 'Groups'],
  ['catalogs', 'Catalog Access'],
  ['schemas', 'Schema Access'],
  ['tables', 'Table Access'],
  ['privileges', 'Privileges'],
];

function UserPicker({ id, label, value, onChange, onSubmit }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!value.trim()) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setLoading(true);
      fetch(`${API_BASE}/users?search=${encodeURIComponent(value)}`, { signal: controller.signal })
        .then((response) => response.json())
        .then((data) => setSuggestions(data.users || []))
        .catch((err) => {
          if (err.name !== 'AbortError') setSuggestions([]);
        })
        .finally(() => setLoading(false));
    }, 180);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [value]);

  const visibleSuggestions = useMemo(() => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return [];
    return suggestions
      .filter((user) => (
        user.name?.toLowerCase().includes(normalized)
        || user.email?.toLowerCase().includes(normalized)
      ))
      .slice(0, 8);
  }, [suggestions, value]);

  return (
    <div className="search-field user-picker">
      <label className="search-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="search-input"
        type="text"
        value={value}
        placeholder="Search existing user..."
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSubmit();
        }}
      />
      {open && (loading || visibleSuggestions.length > 0) && (
        <div className="user-suggestions">
          {loading ? (
            <div className="suggestion-empty">Searching users...</div>
          ) : visibleSuggestions.map((user) => (
            <button
              type="button"
              key={user.id || user.email}
              className="suggestion-option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(user.email);
                setOpen(false);
              }}
            >
              <strong>{user.name || user.email}</strong>
              <span>{user.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ComparisonTable({ title, section }) {
  const names = [...new Set([
    ...(section?.user_a || []),
    ...(section?.user_b || []),
  ])].sort();

  return (
    <section className="identity-section">
      <div className="identity-section-header">
        <h3>{title}</h3>
        <span>{section?.missing_for_user_b?.length || 0} missing</span>
      </div>
      {names.length === 0 ? (
        <div className="empty-state">No access found for this section.</div>
      ) : (
        <div className="permission-table-wrapper">
          <table className="permission-table comparison-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>User A</th>
                <th>User B</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              {names.map((name) => {
                const inA = section.user_a?.includes(name);
                const inB = section.user_b?.includes(name);
                const missing = section.missing_for_user_b?.includes(name);
                const extra = section.extra_for_user_b?.includes(name);
                return (
                  <tr key={name} className={missing ? 'difference-row' : ''}>
                    <td className="principal-cell"><span className="principal-name">{name}</span></td>
                    <td><span className={`presence-badge ${inA ? 'yes' : 'no'}`}>{inA ? 'YES' : 'NO'}</span></td>
                    <td><span className={`presence-badge ${inB ? 'yes' : 'no'}`}>{inB ? 'YES' : 'NO'}</span></td>
                    <td>
                      {missing && <span className="missing-badge">Missing Access</span>}
                      {extra && <span className="source-badge inherited">Extra for User B</span>}
                      {!missing && !extra && <span className="source-badge direct">Matched</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CompareUsers({ exportedBy, embedded = false }) {
  const [userA, setUserA] = useState('');
  const [userB, setUserB] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingDetailed, setLoadingDetailed] = useState(false);
  const [message, setMessage] = useState('');

  const handleCompare = async () => {
    if (!userA || !userB) {
      setMessage('Enter both users before comparing.');
      return;
    }

    setLoading(true);
    setMessage('');
    setReport(null);
    try {
      const response = await fetch(`${API_BASE}/users/compare?user1=${encodeURIComponent(userA)}&user2=${encodeURIComponent(userB)}&scan=false`);
      const data = await response.json();
      setReport(data.success ? data : null);
      setMessage(data.success ? '' : data.message || 'Unable to compare users.');
    } catch {
      setMessage('Unable to compare users.');
    } finally {
      setLoading(false);
    }
  };

  const handleDetailedScan = async () => {
    if (!userA || !userB) return;

    setLoadingDetailed(true);
    setMessage('Scanning detailed catalog, schema, table, and privilege access...');
    try {
      const response = await fetch(`${API_BASE}/users/compare?user1=${encodeURIComponent(userA)}&user2=${encodeURIComponent(userB)}&scan=true`);
      const data = await response.json();
      setReport(data.success ? data : report);
      setMessage(data.success ? '' : data.message || 'Detailed comparison could not be completed.');
    } catch {
      setMessage('Detailed comparison could not be completed.');
    } finally {
      setLoadingDetailed(false);
    }
  };

  return (
    <div className={embedded ? 'compare-panel' : 'identity-page'}>
      {!embedded && (
        <div className="page-heading">
          <div>
            <h1>Compare Users</h1>
            <p>Compare groups, object access, and privileges to explain why one user can access data another cannot.</p>
          </div>
          {report && (
            <button type="button" className="primary-button" onClick={() => exportUserComparison({ report, exportedBy })}>
              Export Excel
            </button>
          )}
        </div>
      )}

      {embedded && report && (
        <div className="panel-actions">
          <button type="button" className="primary-button" onClick={() => exportUserComparison({ report, exportedBy })}>
            Export Excel
          </button>
        </div>
      )}

      <section className="compare-search">
        <UserPicker id="user-a" label="User A" value={userA} onChange={setUserA} onSubmit={handleCompare} />
        <UserPicker id="user-b" label="User B" value={userB} onChange={setUserB} onSubmit={handleCompare} />
        <button type="button" className="primary-button" onClick={handleCompare} disabled={loading}>
          {loading ? 'Comparing...' : 'Compare'}
        </button>
      </section>

      {message && <div className="alert" role="alert"><span>!</span>{message}</div>}

      {report && (
        <div className="comparison-report">
          <section className="identity-section">
            <div className="identity-section-header">
              <h3>Comparison Report</h3>
            </div>
            <div className="summary-row identity-summary">
              <div className="summary-item">
                <span className="summary-label">User A</span>
                <span className="summary-value">{report.user_a?.user?.email || report.user_a?.user?.name}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">User B</span>
                <span className="summary-value">{report.user_b?.user?.email || report.user_b?.user?.name}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Missing Items</span>
                <span className="summary-value">{report.difference_summary?.length || 0}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Recommendations</span>
                <span className="summary-value">{report.recommended_actions?.length || 0}</span>
              </div>
            </div>
            {!report.scan_complete && (
              <div className="detail-scan-strip">
                <span>Quick comparison loaded. Run detailed scan for catalog, schema, table, and privilege differences.</span>
                <button type="button" className="secondary-button" onClick={handleDetailedScan} disabled={loadingDetailed}>
                  {loadingDetailed ? 'Scanning...' : 'Scan Detailed Access'}
                </button>
              </div>
            )}
          </section>

          {sections.map(([key, title]) => (
            <ComparisonTable key={key} title={title} section={report.comparison?.[key]} />
          ))}

          <section className="identity-section">
            <div className="identity-section-header">
              <h3>Access Difference Summary</h3>
            </div>
            {(report.difference_summary || []).length === 0 ? (
              <div className="empty-state">User B already matches User A for the scanned access.</div>
            ) : (
              <ul className="action-list">
                {report.difference_summary.map((item) => (
                  <li key={item}>User B is missing {item}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="identity-section">
            <div className="identity-section-header">
              <h3>Recommended Actions</h3>
            </div>
            {(report.recommended_actions || []).length === 0 ? (
              <div className="empty-state">No recommended actions.</div>
            ) : (
              <ul className="action-list">
                {report.recommended_actions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default CompareUsers;
