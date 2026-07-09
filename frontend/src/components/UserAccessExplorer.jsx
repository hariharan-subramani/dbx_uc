import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import { exportUserAccess } from '../utils/excelExport';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000';

const fetchJson = async (path) => {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
  return response.json();
};

const unique = (items = []) => Array.from(new Set(items.filter(Boolean))).sort();

function PrivilegeBadges({ privileges = [] }) {
  if (!privileges.length) return <span className="muted-text">No privileges visible</span>;
  return (
    <div className="privileges-list">
      {privileges.map((privilege) => (
        <span className="privilege-badge" key={privilege}>{privilege}</span>
      ))}
    </div>
  );
}

function AccessTable({ title, items = [] }) {
  return (
    <section className="identity-card">
      <div className="identity-card-header">
        <h2>{title}</h2>
        <span className="count-badge">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="empty-state">No visible access found.</div>
      ) : (
        <div className="identity-table-wrapper">
          <table className="identity-table">
            <thead>
              <tr>
                <th>Object</th>
                <th>Privileges</th>
                <th>Permission Source</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.object_type}-${item.object_name}-${item.permission_source}`}>
                  <td className="object-name">{item.object_name}</td>
                  <td><PrivilegeBadges privileges={item.privileges || []} /></td>
                  <td>
                    <span className={item.permission_source === 'Direct' ? 'source-badge direct' : 'source-badge inherited'}>
                      {item.permission_source}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function UserSearch({ value, onChange, onSelect, users, loading }) {
  return (
    <div className="identity-search-block">
      <label className="search-label" htmlFor="user-access-search">Search User</label>
      <div className="identity-search-row">
        <input
          id="user-access-search"
          className="search-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search by name or email"
        />
        <button className="primary-button" type="button" onClick={() => onSelect(value)} disabled={!value.trim() || loading}>
          <Icon name="search" size={16} />
          Search
        </button>
      </div>
      {value.trim() && users.length > 0 && (
        <div className="suggestion-list">
          {users.map((user) => (
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

function UserAccessExplorer({ user: exportedBy }) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [deepScan, setDeepScan] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const search = query.trim();
    if (!search) {
      return undefined;
    }

    const handle = window.setTimeout(() => {
      setLoadingUsers(true);
      fetchJson(`/users?search=${encodeURIComponent(search)}`)
        .then((data) => setUsers(data.users || []))
        .catch(() => setUsers([]))
        .finally(() => setLoadingUsers(false));
    }, 250);

    return () => window.clearTimeout(handle);
  }, [query]);

  const loadAccess = (selectedUser) => {
    const userName = selectedUser.trim();
    if (!userName) return;
    setQuery(userName);
    setLoadingAccess(true);
    setError('');
    fetchJson(`/users/${encodeURIComponent(userName)}/access?deep=${deepScan}`)
      .then((data) => {
        setProfile(data);
        if (!data.success) setError(data.message || 'User access could not be fully analyzed.');
      })
      .catch((err) => {
        setProfile(null);
        setError('User access is unavailable right now.');
        console.error('Error loading user access:', err);
      })
      .finally(() => setLoadingAccess(false));
  };

  const summary = useMemo(() => {
    const access = profile?.access || {};
    return [
      { label: 'Groups', value: profile?.groups?.length || 0 },
      { label: 'Catalogs', value: access.catalogs?.length || 0 },
      { label: 'Schemas', value: access.schemas?.length || 0 },
      { label: 'Tables', value: access.tables?.length || 0 },
      { label: 'Privileges', value: profile?.effective_permissions?.length || 0 },
    ];
  }, [profile]);

  const userInfo = profile?.user || {};
  const access = profile?.access || {};

  return (
    <div className="identity-page">
      <div className="page-heading">
        <div>
          <h1>User Access Explorer</h1>
          <p>Search a principal and review direct and inherited access across the workspace.</p>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={!profile}
          onClick={() => exportUserAccess({ profile, exportedBy })}
        >
          <Icon name="download" size={15} />
          Export User Access
        </button>
      </div>

      <UserSearch
        value={query}
        onChange={(value) => {
          setQuery(value);
          if (!value.trim()) setUsers([]);
        }}
        onSelect={loadAccess}
        users={users}
        loading={loadingUsers || loadingAccess}
      />

      <label className="toggle-row">
        <input
          type="checkbox"
          checked={deepScan}
          onChange={(event) => setDeepScan(event.target.checked)}
        />
        <span>Deep object scan</span>
      </label>

      {error && <div className="alert" role="alert"><span>!</span>{error}</div>}
      {profile?.messages?.map((message) => (
        <div className="info-alert" role="status" key={message}>{message}</div>
      ))}
      {loadingAccess && <div className="loading-placeholder">Analyzing user access...</div>}

      {profile && !loadingAccess && (
        <div className="identity-stack">
          <section className="identity-card">
            <div className="identity-card-header">
              <h2>User Information</h2>
              <span className="principal-type type-user">{userInfo.principal_type || 'User'}</span>
            </div>
            <div className="identity-info-grid">
              <div><span>Name</span><strong>{userInfo.name || 'Unavailable'}</strong></div>
              <div><span>Email</span><strong>{userInfo.email || userInfo.user_name || 'Unavailable'}</strong></div>
              <div><span>Status</span><strong>{userInfo.status || 'Unknown'}</strong></div>
              <div><span>Principal Type</span><strong>{userInfo.principal_type || 'User'}</strong></div>
            </div>
          </section>

          <div className="identity-summary-grid">
            {summary.map((item) => (
              <div className="metric-card compact" key={item.label}>
                <p>{item.label}</p>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>

          <section className="identity-card">
            <div className="identity-card-header">
              <h2>Groups</h2>
              <span className="count-badge">{profile.groups?.length || 0}</span>
            </div>
            <div className="badge-cloud">
              {(profile.groups || []).length > 0
                ? profile.groups.map((group) => <span className="source-badge inherited" key={group}>{group}</span>)
                : <span className="muted-text">No groups visible for this user.</span>}
            </div>
          </section>

          <AccessTable title="Workspace Access" items={access.workspace || []} />
          <AccessTable title="Catalog Access" items={access.catalogs || []} />
          <AccessTable title="Schema Access" items={access.schemas || []} />
          <AccessTable title="Table Access" items={access.tables || []} />

          <section className="identity-card">
            <div className="identity-card-header">
              <h2>Effective Permissions</h2>
              <span className="count-badge">{profile.effective_permissions?.length || 0}</span>
            </div>
            <PrivilegeBadges privileges={unique(profile.effective_permissions)} />
          </section>
        </div>
      )}
    </div>
  );
}

export default UserAccessExplorer;
