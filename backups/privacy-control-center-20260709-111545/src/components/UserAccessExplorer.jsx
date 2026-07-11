import { useEffect, useMemo, useState } from 'react';
import CompareUsers from './CompareUsers';
import { exportUserAccess } from '../utils/excelExport';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000';

const fetchJson = async (path) => {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
  return response.json();
};

function BadgeList({ values }) {
  if (!values || values.length === 0) {
    return <span className="muted-text">No privileges found</span>;
  }

  return (
    <div className="privileges-list">
      {values.map((value) => (
        <span key={value} className="privilege-badge">{value}</span>
      ))}
    </div>
  );
}

function AccessMetric({ label, value }) {
  return (
    <div className="access-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CompactAccessList({ title, items, emptyMessage, loading }) {
  return (
    <section className="identity-section">
      <div className="identity-section-header">
        <h3>{title}</h3>
        <span>{items?.length || 0}</span>
      </div>
      {!items || items.length === 0 ? (
        <div className="empty-state">{loading ? `${title} scan is running.` : emptyMessage}</div>
      ) : (
        <div className="compact-access-list">
          {items.slice(0, 10).map((item) => (
            <div key={`${title}:${item.name}:${item.principal}`} className="compact-access-item">
              <div>
                <strong>{item.name}</strong>
                {item.principal && <span>via {item.principal}</span>}
              </div>
              <span className={`source-badge ${item.source === 'Direct' ? 'direct' : 'inherited'}`}>
                {item.source || 'Direct'}
              </span>
            </div>
          ))}
          {items.length > 10 && (
            <div className="compact-more">+ {items.length - 10} more in export</div>
          )}
        </div>
      )}
    </section>
  );
}

function UserAccessHeader({ activeMode, onModeChange }) {
  return (
    <div className="user-access-header">
      <div className="page-heading">
        <div>
          <h1>User Access Explorer</h1>
          <p>Review user access across the Databricks workspace.</p>
        </div>
      </div>
      <SegmentedControl activeMode={activeMode} onModeChange={onModeChange} />
    </div>
  );
}

function SegmentedControl({ activeMode, onModeChange }) {
  return (
    <div className="segmented-control" role="tablist" aria-label="User access view mode">
      <button
        type="button"
        role="tab"
        aria-selected={activeMode === 'search'}
        className={activeMode === 'search' ? 'active' : ''}
        onClick={() => onModeChange('search')}
      >
        Search User
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeMode === 'compare'}
        className={activeMode === 'compare' ? 'active' : ''}
        onClick={() => onModeChange('compare')}
      >
        Compare Users
      </button>
    </div>
  );
}

function SearchUserPanel({ exportedBy }) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedUserRecord, setSelectedUserRecord] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadingAccessScan, setLoadingAccessScan] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setLoadingUsers(true);
      fetch(`${API_BASE}/users?search=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((response) => response.json())
        .then((data) => {
          setUsers(data.users || []);
          setMessage(data.success ? '' : data.message || 'User search is unavailable.');
        })
        .catch((err) => {
          if (err.name !== 'AbortError') {
            setUsers([]);
            setMessage('User search is unavailable.');
          }
        })
        .finally(() => setLoadingUsers(false));
    }, 250);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  const filteredUsers = useMemo(() => {
    const normalized = query.toLowerCase();
    return users.filter((user) => (
      !normalized
      || user.name?.toLowerCase().includes(normalized)
      || user.email?.toLowerCase().includes(normalized)
    ));
  }, [query, users]);

  const handleSearch = async () => {
    const userToLoad = selectedUser || query;
    if (!userToLoad) {
      setMessage('Enter or select a user to analyze.');
      return;
    }

    setLoadingProfile(true);
    setLoadingAccessScan(false);
    setMessage('');
    const localUser = selectedUserRecord || filteredUsers.find((user) => user.email === userToLoad || user.name === userToLoad);
    if (localUser) {
      setProfile({
        success: true,
        scan_complete: false,
        user: localUser,
        groups: [],
        workspaces: [],
        catalogs: [],
        schemas: [],
        tables: [],
        privileges: [],
      });
    } else {
      setProfile(null);
    }
    try {
      const data = await fetchJson(`/users/${encodeURIComponent(userToLoad)}/access?scan=false`);
      setProfile(data.success ? data : null);
      setMessage(data.success ? '' : data.message || 'Unable to load user access.');
      if (data.success) {
        setLoadingAccessScan(true);
        fetchJson(`/users/${encodeURIComponent(userToLoad)}/access?scan=true`)
          .then((scanData) => {
            if (scanData.success) {
              setProfile(scanData);
              setMessage('');
            } else {
              setMessage(scanData.message || 'Detailed access scan could not be completed.');
            }
          })
          .catch(() => {
            setMessage('Detailed access scan could not be completed.');
          })
          .finally(() => setLoadingAccessScan(false));
      }
    } catch {
      setMessage('Unable to load user access.');
    } finally {
      setLoadingProfile(false);
    }
  };

  return (
    <>
      {profile && (
        <div className="panel-actions">
          <button type="button" className="primary-button" onClick={() => exportUserAccess({ profile, exportedBy })}>
            Export User Access
          </button>
        </div>
      )}

      <section className="identity-search">
        <div className="search-field">
          <label className="search-label" htmlFor="access-user-search">Search User</label>
          <input
            id="access-user-search"
            className="search-input"
            type="text"
            value={query}
            placeholder="Search by name or email..."
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedUser(event.target.value);
              setSelectedUserRecord(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleSearch();
            }}
          />
        </div>
        <button type="button" className="primary-button" onClick={handleSearch} disabled={loadingProfile}>
          {loadingProfile ? 'Analyzing...' : 'Search'}
        </button>
      </section>

      {(loadingUsers || filteredUsers.length > 0) && (
        <div className="user-result-list">
          {loadingUsers ? (
            <span className="muted-text">Searching users...</span>
          ) : filteredUsers.slice(0, 8).map((user) => (
            <button
              type="button"
              key={user.id || user.email}
              className={`user-result ${selectedUser === user.email ? 'selected' : ''}`}
              onClick={() => {
                setSelectedUser(user.email);
                setSelectedUserRecord(user);
                setQuery(user.email);
              }}
            >
              <strong>{user.name || user.email}</strong>
              <span>{user.email}</span>
            </button>
          ))}
        </div>
      )}

      {message && <div className="alert" role="alert"><span>!</span>{message}</div>}

      {loadingAccessScan && (
        <div className="scan-status">
          <div className="loading-spinner small"></div>
          <span>Scanning catalog, schema, table, and privilege access...</span>
        </div>
      )}

      {profile && (
        <div className="identity-profile">
          <section className="identity-section">
            <div className="identity-section-header">
              <h3>User Information</h3>
            </div>
            <div className="summary-row identity-summary">
              <div className="summary-item"><span className="summary-label">Name</span><span className="summary-value">{profile.user?.name || 'Unavailable'}</span></div>
              <div className="summary-item"><span className="summary-label">Email</span><span className="summary-value">{profile.user?.email || 'Unavailable'}</span></div>
              <div className="summary-item"><span className="summary-label">Status</span><span className="summary-value">{profile.user?.status || 'Unavailable'}</span></div>
              <div className="summary-item"><span className="summary-label">Principal Type</span><span className="summary-value">{profile.user?.principal_type || 'User'}</span></div>
            </div>
          </section>

          <section className="access-overview">
            <AccessMetric label="Groups" value={profile.groups?.length || 0} />
            <AccessMetric label="Workspaces" value={profile.workspaces?.length || 0} />
            <AccessMetric label="Catalogs" value={profile.catalogs?.length || 0} />
            <AccessMetric label="Schemas" value={profile.schemas?.length || 0} />
            <AccessMetric label="Tables" value={profile.tables?.length || 0} />
            <AccessMetric label="Privileges" value={profile.privileges?.length || 0} />
          </section>

          <section className="identity-section">
            <div className="identity-section-header">
              <h3>Groups</h3>
              <span>{profile.groups?.length || 0}</span>
            </div>
            <div className="chip-list">
              {(profile.groups || []).length === 0 ? (
                <span className="muted-text">No groups found</span>
              ) : profile.groups.map((group) => (
                <span key={group.id || group.name} className="group-chip">{group.name}</span>
              ))}
            </div>
          </section>

          <section className="identity-section">
            <div className="identity-section-header">
              <h3>Effective Permissions</h3>
              <span>{profile.privileges?.length || 0}</span>
            </div>
            <BadgeList values={profile.privileges || []} />
          </section>

          <CompactAccessList title="Workspace Access" items={(profile.workspaces || []).map((workspace) => ({
            name: workspace.display_name || workspace.name || workspace.host,
            source: 'Direct',
            privileges: ['Workspace access'],
          }))} emptyMessage="No workspace access found." />
          <CompactAccessList
            title="Catalog Access"
            items={profile.catalogs}
            emptyMessage="No catalog access found."
            loading={loadingAccessScan}
          />
          <CompactAccessList
            title="Schema Access"
            items={profile.schemas}
            emptyMessage="No schema access found."
            loading={loadingAccessScan}
          />
          <CompactAccessList
            title="Table Access"
            items={profile.tables}
            emptyMessage="No table access found."
            loading={loadingAccessScan}
          />
        </div>
      )}
    </>
  );
}

function CompareUsersPanel({ exportedBy }) {
  return <CompareUsers exportedBy={exportedBy} embedded />;
}

function UserAccessExplorer({ exportedBy }) {
  const [viewMode, setViewMode] = useState('search');

  return (
    <div className="identity-page user-access-module">
      <UserAccessHeader activeMode={viewMode} onModeChange={setViewMode} />
      <div key={viewMode} className="mode-panel">
        {viewMode === 'search' ? (
          <SearchUserPanel exportedBy={exportedBy} />
        ) : (
          <CompareUsersPanel exportedBy={exportedBy} />
        )}
      </div>
    </div>
  );
}

export default UserAccessExplorer;
