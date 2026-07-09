import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import { exportUserComparison } from '../utils/excelExport';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000';

const fetchJson = async (path) => {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
  return response.json();
};

const accessNames = (profile, section) => (
  (profile?.access?.[section] || []).map((item) => item.object_name).filter(Boolean)
);

const unique = (items = []) => Array.from(new Set(items.filter(Boolean))).sort();

function UserLookup({ id, label, value, onChange, onSelect }) {
  const [matches, setMatches] = useState([]);

  useEffect(() => {
    const query = value.trim();
    if (!query) {
      return undefined;
    }

    const handle = window.setTimeout(() => {
      fetchJson(`/users?search=${encodeURIComponent(query)}`)
        .then((data) => setMatches(data.users || []))
        .catch(() => setMatches([]));
    }, 250);

    return () => window.clearTimeout(handle);
  }, [value]);

  return (
    <div className="compare-user-field">
      <label className="search-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="search-input"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          if (!event.target.value.trim()) setMatches([]);
        }}
        placeholder="Search by name or email"
      />
      {value.trim() && matches.length > 0 && (
        <div className="suggestion-list compact">
          {matches.map((user) => (
            <button type="button" key={user.id || user.email} onClick={() => onSelect(user.email || user.user_name)}>
              <strong>{user.name || user.email}</strong>
              <span>{user.email || user.user_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ComparisonTable({ title, valuesA = [], valuesB = [], labelA, labelB }) {
  const rows = unique([...valuesA, ...valuesB]);

  return (
    <section className="identity-card">
      <div className="identity-card-header">
        <h2>{title}</h2>
        <span className="count-badge">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">No visible entries to compare.</div>
      ) : (
        <div className="identity-table-wrapper">
          <table className="identity-table comparison-table">
            <thead>
              <tr>
                <th>{title}</th>
                <th>{labelA}</th>
                <th>{labelB}</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const hasA = valuesA.includes(row);
                const hasB = valuesB.includes(row);
                const differs = hasA !== hasB;
                return (
                  <tr key={row} className={differs ? 'difference-row' : ''}>
                    <td className="object-name">{row}</td>
                    <td><span className={hasA ? 'yes-badge' : 'no-badge'}>{hasA ? 'YES' : 'NO'}</span></td>
                    <td><span className={hasB ? 'yes-badge' : 'no-badge'}>{hasB ? 'YES' : 'NO'}</span></td>
                    <td>{differs ? <span className="missing-badge">Missing Access</span> : <span className="muted-text">Matched</span>}</td>
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

function DifferenceSummary({ comparison }) {
  const differences = comparison?.differences || {};
  const missing = [
    ...(differences.groups_missing_from_user2 || []).map((item) => `${item} group`),
    ...(differences.catalogs_missing_from_user2 || []).map((item) => `${item} catalog`),
    ...(differences.schemas_missing_from_user2 || []).map((item) => `${item} schema`),
    ...(differences.tables_missing_from_user2 || []).map((item) => `${item} table`),
    ...(differences.privileges_missing_from_user2 || []).map((item) => `${item} privilege`),
  ];
  const userB = comparison?.user2?.user?.email || comparison?.user2?.user?.name || 'User B';

  return (
    <section className="identity-card">
      <div className="identity-card-header">
        <h2>Access Difference Summary</h2>
        <span className="count-badge">{missing.length}</span>
      </div>
      {missing.length === 0 ? (
        <div className="empty-state">No missing access found for {userB}.</div>
      ) : (
        <div className="summary-list">
          <strong>{userB} is missing</strong>
          {missing.map((item) => <span key={item}>{item}</span>)}
        </div>
      )}
    </section>
  );
}

function RecommendedActions({ comparison }) {
  const recommendations = comparison?.recommendations || [];
  const userB = comparison?.user2?.user?.email || comparison?.user2?.user?.name || 'User B';
  const userA = comparison?.user1?.user?.email || comparison?.user1?.user?.name || 'User A';

  return (
    <section className="identity-card">
      <div className="identity-card-header">
        <h2>Recommended Actions</h2>
        <span className="count-badge">{recommendations.length}</span>
      </div>
      {recommendations.length === 0 ? (
        <div className="empty-state">{userB} already matches the visible access profile for {userA}.</div>
      ) : (
        <div className="recommendation-list">
          <strong>To make {userB} equivalent to {userA}</strong>
          {recommendations.map((item) => (
            <div className="recommendation-item" key={`${item.action}-${item.target}`}>
              <span>{item.action}</span>
              <strong>{item.target}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CompareUsers({ user: exportedBy }) {
  const [userA, setUserA] = useState('');
  const [userB, setUserB] = useState('');
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deepScan, setDeepScan] = useState(false);
  const [error, setError] = useState('');

  const labels = useMemo(() => ({
    a: comparison?.user1?.user?.email || comparison?.user1?.user?.name || 'User A',
    b: comparison?.user2?.user?.email || comparison?.user2?.user?.name || 'User B',
  }), [comparison]);

  const runComparison = () => {
    if (!userA.trim() || !userB.trim()) return;
    setLoading(true);
    setError('');
    fetchJson(`/users/compare?user1=${encodeURIComponent(userA.trim())}&user2=${encodeURIComponent(userB.trim())}&deep=${deepScan}`)
      .then((data) => {
        setComparison(data);
        if (!data.success) setError(data.message || 'Comparison completed with limited access data.');
      })
      .catch((err) => {
        setComparison(null);
        setError('User comparison is unavailable right now.');
        console.error('Error comparing users:', err);
      })
      .finally(() => setLoading(false));
  };

  return (
    <div className="identity-page">
      <div className="page-heading">
        <div>
          <h1>Compare Users</h1>
          <p>Compare group membership, object access, and privileges between two users.</p>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={!comparison}
          onClick={() => exportUserComparison({ comparison, exportedBy })}
        >
          <Icon name="download" size={15} />
          Export Comparison
        </button>
      </div>

      <section className="identity-card">
        <div className="compare-controls">
          <UserLookup id="compare-user-a" label="User A" value={userA} onChange={setUserA} onSelect={setUserA} />
          <UserLookup id="compare-user-b" label="User B" value={userB} onChange={setUserB} onSelect={setUserB} />
          <button className="primary-button" type="button" onClick={runComparison} disabled={loading || !userA.trim() || !userB.trim()}>
            <Icon name="users" size={16} />
            Compare
          </button>
        </div>
        <label className="toggle-row inline">
          <input
            type="checkbox"
            checked={deepScan}
            onChange={(event) => setDeepScan(event.target.checked)}
          />
          <span>Deep object scan</span>
        </label>
      </section>

      {error && <div className="alert" role="alert"><span>!</span>{error}</div>}
      {comparison?.user1?.messages?.map((message) => (
        <div className="info-alert" role="status" key={`a-${message}`}>{message}</div>
      ))}
      {comparison?.user2?.messages?.map((message) => (
        <div className="info-alert" role="status" key={`b-${message}`}>{message}</div>
      ))}
      {loading && <div className="loading-placeholder">Building comparison report...</div>}

      {comparison && !loading && (
        <div className="identity-stack">
          <ComparisonTable title="Groups" valuesA={comparison.user1?.groups || []} valuesB={comparison.user2?.groups || []} labelA={labels.a} labelB={labels.b} />
          <ComparisonTable title="Catalog Access" valuesA={accessNames(comparison.user1, 'catalogs')} valuesB={accessNames(comparison.user2, 'catalogs')} labelA={labels.a} labelB={labels.b} />
          <ComparisonTable title="Schema Access" valuesA={accessNames(comparison.user1, 'schemas')} valuesB={accessNames(comparison.user2, 'schemas')} labelA={labels.a} labelB={labels.b} />
          <ComparisonTable title="Table Access" valuesA={accessNames(comparison.user1, 'tables')} valuesB={accessNames(comparison.user2, 'tables')} labelA={labels.a} labelB={labels.b} />
          <ComparisonTable title="Privileges" valuesA={comparison.user1?.effective_permissions || []} valuesB={comparison.user2?.effective_permissions || []} labelA={labels.a} labelB={labels.b} />
          <DifferenceSummary comparison={comparison} />
          <RecommendedActions comparison={comparison} />
        </div>
      )}
    </div>
  );
}

export default CompareUsers;
