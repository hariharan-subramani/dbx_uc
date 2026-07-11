import { useEffect, useMemo, useState } from 'react';
import CompareUsers from './CompareUsers';
import { exportGroupAccess, exportUserAccess } from '../utils/excelExport';

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
      <button
        type="button"
        role="tab"
        aria-selected={activeMode === 'groups'}
        className={activeMode === 'groups' ? 'active' : ''}
        onClick={() => onModeChange('groups')}
      >
        Group Explorer
      </button>
    </div>
  );
}

function SearchUserPanel({ exportedBy, initialUser }) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedUserRecord, setSelectedUserRecord] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadingAccessScan, setLoadingAccessScan] = useState(false);
  const [message, setMessage] = useState('');

  const principalForUser = (user) => user?.name || user?.email || '';

  useEffect(() => {
    if (!query.trim()) {
      setUsers([]);
      setLoadingUsers(false);
      return;
    }

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
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return users.filter((user) => (
      user.name?.toLowerCase().includes(normalized)
      || user.email?.toLowerCase().includes(normalized)
    ));
  }, [query, users]);

  const handleSearch = async (userOverride = '') => {
    const userToLoad = userOverride || principalForUser(selectedUserRecord) || selectedUser || query;
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
      if (!data.success) {
        if (localUser) {
          setProfile((current) => current || {
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
          setMessage(data.message || 'Detailed access could not be loaded for this user right now.');
        } else {
          setProfile(null);
          setMessage(data.message || 'Unable to load user access.');
        }
        return;
      }

      setProfile(data);
      setMessage('');
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
    } catch {
      if (localUser) {
        setMessage('Detailed access could not be loaded for this user right now.');
      } else {
        setMessage('Unable to load user access.');
      }
    } finally {
      setLoadingProfile(false);
    }
  };

  useEffect(() => {
    if (!initialUser) return;
    setQuery(initialUser);
    setSelectedUser(initialUser);
    setSelectedUserRecord(null);
    handleSearch(initialUser);
  }, [initialUser]);

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
        <button type="button" className="primary-button" onClick={() => handleSearch()} disabled={loadingProfile}>
          {loadingProfile ? 'Analyzing...' : 'Search'}
        </button>
      </section>

      {query.trim() && (loadingUsers || filteredUsers.length > 0) && (
        <div className="user-result-list">
          {loadingUsers ? (
            <span className="muted-text">Searching users...</span>
          ) : filteredUsers.slice(0, 8).map((user) => (
            <button
              type="button"
              key={user.id || user.email}
              className={`user-result ${selectedUser === principalForUser(user) ? 'selected' : ''}`}
              onClick={() => {
                const principal = principalForUser(user);
                setSelectedUser(principal);
                setSelectedUserRecord(user);
                setQuery(principal);
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

function AccessTable({ title, items, emptyMessage, loading }) {
  return (
    <section className="identity-section">
      <div className="identity-section-header">
        <h3>{title}</h3>
        <span>{items?.length || 0}</span>
      </div>
      {!items || items.length === 0 ? (
        <div className="empty-state">{loading ? `${title} scan is running.` : emptyMessage}</div>
      ) : (
        <div className="permission-table-wrapper embedded-table-wrapper">
          <table className="permission-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Privileges</th>
                <th>Principal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${title}:${item.name}:${item.principal}`}>
                  <td className="principal-cell"><span className="principal-name">{item.name}</span></td>
                  <td><BadgeList values={item.privileges || []} /></td>
                  <td>{item.principal || 'Group'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function GroupExplorerPanel({ exportedBy, onOpenUser }) {
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [selectedGroupRecord, setSelectedGroupRecord] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadingAccessScan, setLoadingAccessScan] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!query.trim()) {
      setGroups([]);
      setLoadingGroups(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setLoadingGroups(true);
      fetch(`${API_BASE}/groups?search=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((response) => response.json())
        .then((data) => {
          setGroups(data.groups || []);
          setMessage(data.success ? '' : data.message || 'Group search is unavailable.');
        })
        .catch((err) => {
          if (err.name !== 'AbortError') {
            setGroups([]);
            setMessage('Group search is unavailable.');
          }
        })
        .finally(() => setLoadingGroups(false));
    }, 220);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  const filteredGroups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return groups.filter((group) => {
      const name = String(group.name || group.displayName || '').toLowerCase();
      return name.includes(normalized);
    });
  }, [groups, query]);

  const normalizeGroupMember = (member) => {
    const display = member.display || member.email || member.name || member.value || member.id || '';
    return {
      id: member.value || member.id,
      name: member.name || display,
      email: member.email || (String(display).includes('@') ? display : ''),
      type: member.type || 'User',
    };
  };

  const profileFromGroup = (group, additions = {}) => ({
    success: true,
    scan_complete: additions.scan_complete || false,
    group: {
      id: group?.id,
      name: group?.name || group?.displayName || selectedGroup || query,
      description: group?.description || '',
      principal_type: group?.principal_type || 'Group',
    },
    members: (group?.members || []).map(normalizeGroupMember),
    workspaces: additions.workspaces || [],
    catalogs: additions.catalogs || [],
    schemas: additions.schemas || [],
    tables: additions.tables || [],
    permissions: additions.permissions || [],
    privileges: additions.privileges || [],
  });

  const loadGroupProfile = async (groupName, groupRecord) => {
    const groupToLoad = groupName || selectedGroup || query;
    if (!groupToLoad) {
      setMessage('Enter or select a group to analyze.');
      return;
    }

    let currentGroup = groupRecord || selectedGroupRecord || filteredGroups.find((group) => {
      const name = String(group.name || group.displayName || '').toLowerCase();
      return name === String(groupToLoad).toLowerCase();
    });
    if (!currentGroup) {
      currentGroup = filteredGroups.find((group) => {
        const name = String(group.name || group.displayName || '').toLowerCase();
        return name.includes(String(groupToLoad).toLowerCase());
      });
    }
    if (!currentGroup) {
      setMessage('Select a group from the search results before analyzing.');
      return;
    }

    setSelectedGroup(groupToLoad);
    setSelectedGroupRecord(currentGroup);
    setLoadingProfile(true);
    setLoadingAccessScan(false);
    setMessage('');
    setProfile(profileFromGroup(currentGroup));

    try {
      const workspaceData = await fetchJson('/workspace').catch(() => ({ success: false, workspaces: [] }));
      const workspaces = workspaceData.success ? workspaceData.workspaces || [] : [];
      setProfile(profileFromGroup(currentGroup, { workspaces }));
      setLoadingAccessScan(true);
      fetchJson(`/groups/${encodeURIComponent(currentGroup.name || currentGroup.displayName || groupToLoad)}/permissions?scan=true`)
        .then((scanData) => {
          if (!scanData.success) {
            setMessage(scanData.message || 'Detailed group access scan could not be completed.');
            return;
          }

          const permissions = scanData.permissions || [];
          setProfile(profileFromGroup(currentGroup, {
            scan_complete: true,
            workspaces,
            permissions,
            catalogs: permissions.filter((item) => item.object_type === 'Catalog'),
            schemas: permissions.filter((item) => item.object_type === 'Schema'),
            tables: permissions.filter((item) => item.object_type === 'Table'),
            privileges: [...new Set(permissions.flatMap((item) => item.privileges || []))].sort(),
          }));
          setMessage('');
        })
        .catch(() => setMessage('Detailed group access scan could not be completed.'))
        .finally(() => setLoadingAccessScan(false));
    } catch {
      setMessage('Unable to load group profile.');
    } finally {
      setLoadingProfile(false);
    }
  };

  const workspaceItems = (profile?.workspaces || []).map((workspace) => ({
    name: workspace.display_name || workspace.name || workspace.host || 'Workspace',
    principal: workspace.workspace_id || workspace.host || '',
    privileges: ['Workspace access'],
  }));

  return (
    <>
      {profile && (
        <div className="panel-actions">
          <button type="button" className="primary-button" onClick={() => exportGroupAccess({ profile, exportedBy })}>
            Export
          </button>
        </div>
      )}

      <section className="identity-search">
        <div className="search-field">
          <label className="search-label" htmlFor="access-group-search">Search Group</label>
          <input
            id="access-group-search"
            className="search-input"
            type="text"
            value={query}
            placeholder="Search existing Databricks groups..."
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedGroup(event.target.value);
              setSelectedGroupRecord(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') loadGroupProfile();
            }}
          />
        </div>
        <button type="button" className="primary-button" onClick={() => loadGroupProfile()} disabled={loadingProfile}>
          {loadingProfile ? 'Analyzing...' : 'Search'}
        </button>
      </section>

      {query.trim() && (loadingGroups || filteredGroups.length > 0) && (
        <div className="user-result-list">
          {loadingGroups ? (
            <span className="muted-text">Searching groups...</span>
          ) : filteredGroups.slice(0, 10).map((group) => (
            <button
              type="button"
              key={group.id || group.name}
              className={`user-result ${selectedGroup === group.name ? 'selected' : ''}`}
              onClick={() => {
                const groupName = group.name || group.displayName;
                setSelectedGroup(groupName);
                setSelectedGroupRecord(group);
                setQuery(groupName);
              }}
            >
              <strong>{group.name || group.displayName}</strong>
              <span>{group.member_count || 0} members</span>
            </button>
          ))}
        </div>
      )}

      {message && <div className="alert" role="alert"><span>!</span>{message}</div>}

      {loadingAccessScan && (
        <div className="scan-status">
          <div className="loading-spinner small"></div>
          <span>Scanning catalog, schema, table, and privilege access for this group...</span>
        </div>
      )}

      {profile && (
        <div className="identity-profile">
          <section className="identity-section">
            <div className="identity-section-header">
              <h3>Group Information</h3>
            </div>
            <div className="summary-row identity-summary">
              <div className="summary-item"><span className="summary-label">Group Name</span><span className="summary-value">{profile.group?.name || 'Unavailable'}</span></div>
              <div className="summary-item"><span className="summary-label">Description</span><span className="summary-value">{profile.group?.description || 'Unavailable'}</span></div>
              <div className="summary-item"><span className="summary-label">Principal Type</span><span className="summary-value">{profile.group?.principal_type || 'Group'}</span></div>
              <div className="summary-item"><span className="summary-label">Members Count</span><span className="summary-value">{profile.members?.length || 0}</span></div>
              <div className="summary-item"><span className="summary-label">Workspace Count</span><span className="summary-value">{profile.workspaces?.length || 0}</span></div>
              <div className="summary-item"><span className="summary-label">Catalog Count</span><span className="summary-value">{profile.catalogs?.length || 0}</span></div>
              <div className="summary-item"><span className="summary-label">Schema Count</span><span className="summary-value">{profile.schemas?.length || 0}</span></div>
              <div className="summary-item"><span className="summary-label">Table Count</span><span className="summary-value">{profile.tables?.length || 0}</span></div>
            </div>
          </section>

          <section className="access-overview">
            <AccessMetric label="Members" value={profile.members?.length || 0} />
            <AccessMetric label="Workspaces" value={profile.workspaces?.length || 0} />
            <AccessMetric label="Catalogs" value={profile.catalogs?.length || 0} />
            <AccessMetric label="Schemas" value={profile.schemas?.length || 0} />
            <AccessMetric label="Tables" value={profile.tables?.length || 0} />
            <AccessMetric label="Privileges" value={profile.privileges?.length || 0} />
          </section>

          <section className="identity-section">
            <div className="identity-section-header">
              <h3>Members</h3>
              <span>{profile.members?.length || 0}</span>
            </div>
            {(profile.members || []).length === 0 ? (
              <div className="empty-state">No members found.</div>
            ) : (
              <div className="permission-table-wrapper embedded-table-wrapper">
                <table className="permission-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.members.map((member) => (
                      <tr key={member.id || member.email || member.name}>
                        <td className="principal-cell">
                          <button type="button" className="table-link" onClick={() => onOpenUser(member.email || member.name)}>
                            {member.name || member.email}
                          </button>
                        </td>
                        <td>{member.email || 'Unavailable'}</td>
                        <td><span className="principal-type type-user">{member.type || 'User'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="identity-section">
            <div className="identity-section-header">
              <h3>Effective Permissions</h3>
              <span>{profile.privileges?.length || 0}</span>
            </div>
            <BadgeList values={profile.privileges || []} />
          </section>

          <AccessTable title="Workspace Access" items={workspaceItems} emptyMessage="No workspace access found." />
          <AccessTable title="Catalog Access" items={profile.catalogs} emptyMessage="No catalog access found." loading={loadingAccessScan} />
          <AccessTable title="Schema Access" items={profile.schemas} emptyMessage="No schema access found." loading={loadingAccessScan} />
          <AccessTable title="Table Access" items={profile.tables} emptyMessage="No table access found." loading={loadingAccessScan} />
        </div>
      )}
    </>
  );
}

function UserAccessExplorer({ exportedBy }) {
  const [viewMode, setViewMode] = useState('search');
  const [userToOpen, setUserToOpen] = useState('');

  const handleOpenUser = (user) => {
    if (!user) return;
    setUserToOpen(user);
    setViewMode('search');
  };

  return (
    <div className="identity-page user-access-module">
      <UserAccessHeader activeMode={viewMode} onModeChange={setViewMode} />
      <div key={viewMode} className="mode-panel">
        {viewMode === 'search' ? (
          <SearchUserPanel exportedBy={exportedBy} initialUser={userToOpen} />
        ) : viewMode === 'compare' ? (
          <CompareUsersPanel exportedBy={exportedBy} />
        ) : (
          <GroupExplorerPanel exportedBy={exportedBy} onOpenUser={handleOpenUser} />
        )}
      </div>
    </div>
  );
}

export default UserAccessExplorer;
