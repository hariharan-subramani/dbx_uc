import { useEffect, useMemo, useState } from 'react';
import RelationshipBadge from './RelationshipBadge';
import RelationshipModal from './RelationshipModal';
import { exportGroupMembers, exportUserGroups } from '../utils/excelExport';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000';

function PermissionSearch({ onFilterChange, permissions = [], exportedBy, workspaceName }) {
  const [userSearch, setUserSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [activeModal, setActiveModal] = useState(null);
  const [userGroups, setUserGroups] = useState([]);
  const [groupMembers, setGroupMembers] = useState([]);
  const [userSuggestions, setUserSuggestions] = useState([]);
  const [activeSuggestion, setActiveSuggestion] = useState('');
  const [relationshipLoading, setRelationshipLoading] = useState(false);
  const [relationshipMessage, setRelationshipMessage] = useState('');
  const [loadingUserSuggestions, setLoadingUserSuggestions] = useState(false);

  const localUserSuggestions = useMemo(() => {
    const normalized = userSearch.trim().toLowerCase();
    if (!normalized) return [];
    return permissions
      .filter((permission) => (
        String(permission.principal_type || '').toLowerCase() === 'user'
        && String(permission.principal || '').toLowerCase().includes(normalized)
      ))
      .map((permission) => ({ email: permission.principal, name: permission.principal }));
  }, [permissions, userSearch]);

  const localGroupSuggestions = useMemo(() => {
    const normalized = groupSearch.trim().toLowerCase();
    const grantableBuiltIns = ['account users'];
    const existingPrincipals = permissions
      .filter((permission) => (
        String(permission.principal_type || '').toLowerCase() === 'group'
      ))
      .map((permission) => permission.principal);

    return [...existingPrincipals, ...grantableBuiltIns]
      .filter((name) => (
        name
        && (!normalized || String(name).toLowerCase().includes(normalized))
      ))
      .map((name) => ({ name, grantable: true, source: 'Unity Catalog' }));
  }, [permissions, groupSearch]);

  const selectedUser = useMemo(() => {
    const normalized = userSearch.trim().toLowerCase();
    if (!normalized) return '';
    const exact = permissions.find((permission) => (
      String(permission.principal_type || '').toLowerCase() === 'user'
      && String(permission.principal || '').toLowerCase() === normalized
    ));
    return exact?.principal || '';
  }, [permissions, userSearch]);

  const selectedGroup = useMemo(() => {
    const normalized = groupSearch.trim().toLowerCase();
    if (!normalized) return '';
    const exact = permissions.find((permission) => (
      String(permission.principal_type || '').toLowerCase() === 'group'
      && String(permission.principal || '').toLowerCase() === normalized
    ));
    return exact?.principal || '';
  }, [permissions, groupSearch]);

  useEffect(() => {
    if (!selectedUser) return;

    let isActive = true;
    fetch(`${API_BASE}/users/${encodeURIComponent(selectedUser)}/groups`)
      .then((response) => response.json())
      .then((data) => {
        if (!isActive) return;
        setUserGroups(data.success ? data.groups || [] : []);
      })
      .catch(() => {
        if (isActive) setUserGroups([]);
      });

    return () => {
      isActive = false;
    };
  }, [selectedUser]);

  useEffect(() => {
    const normalized = userSearch.trim();
    if (activeSuggestion !== 'user' || selectedUser) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      const url = `${API_BASE}/users?search=${encodeURIComponent(normalized)}`;
      setLoadingUserSuggestions(true);
      console.info('[PermissionSearch] Loading user suggestions', {
        method: 'GET',
        url,
        search: normalized,
      });
      fetch(url, { signal: controller.signal })
        .then(async (response) => {
          const responseText = await response.text();
          let data = null;
          try {
            data = responseText ? JSON.parse(responseText) : {};
          } catch {
            data = null;
          }
          if (!response.ok) {
            console.error('[PermissionSearch] User suggestions request failed', {
              method: 'GET',
              url,
              statusCode: response.status,
              responseBody: responseText,
              errorMessage: data?.message || data?.detail || response.statusText,
            });
            setUserSuggestions([]);
            return;
          }
          setUserSuggestions(data?.success ? data.users || [] : []);
        })
        .catch((err) => {
          if (err.name !== 'AbortError') {
            console.error('[PermissionSearch] User suggestions request crashed', {
              method: 'GET',
              url,
              errorMessage: err.message,
            });
            setUserSuggestions([]);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoadingUserSuggestions(false);
        });
    }, 180);

    return () => {
      clearTimeout(timeout);
      controller.abort();
      setLoadingUserSuggestions(false);
    };
  }, [activeSuggestion, selectedUser, userSearch]);

  useEffect(() => {
    if (!selectedGroup) return;

    let isActive = true;
    fetch(`${API_BASE}/groups/${encodeURIComponent(selectedGroup)}/members`)
      .then((response) => response.json())
      .then((data) => {
        if (!isActive) return;
        setGroupMembers(data.success ? data.members || [] : []);
      })
      .catch(() => {
        if (isActive) setGroupMembers([]);
      });

    return () => {
      isActive = false;
    };
  }, [selectedGroup]);

  const updateUserSearch = (value) => {
    setUserSearch(value);
    setUserGroups([]);
    if (!value.trim()) setUserSuggestions([]);
    onFilterChange({ userSearch: value, groupSearch });
  };

  const updateGroupSearch = (value) => {
    setGroupSearch(value);
    setGroupMembers([]);
    onFilterChange({ userSearch, groupSearch: value });
  };

  const selectUserSuggestion = (user) => {
    const value = user.email || user.name || '';
    setUserSearch(value);
    setUserSuggestions([]);
    setActiveSuggestion('');
    onFilterChange({ userSearch: value, groupSearch });
  };

  const selectGroupSuggestion = (group) => {
    const value = group.name || '';
    setGroupSearch(value);
    setActiveSuggestion('');
    onFilterChange({ userSearch, groupSearch: value });
  };

  const mergedUserSuggestions = useMemo(() => {
    const seen = new Set();
    return [...localUserSuggestions, ...userSuggestions]
      .filter((user) => {
        const value = user.email || user.name;
        if (!value || seen.has(value.toLowerCase())) return false;
        seen.add(value.toLowerCase());
        return true;
      })
      .slice(0, 8);
  }, [localUserSuggestions, userSuggestions]);

  const mergedGroupSuggestions = useMemo(() => {
    const seen = new Set();
    return localGroupSuggestions
      .filter((group) => {
        const value = group.name;
        if (!value || seen.has(value.toLowerCase())) return false;
        seen.add(value.toLowerCase());
        return true;
      })
      .slice(0, 8);
  }, [localGroupSuggestions]);

  const openUserGroups = () => {
    if (!selectedUser) return;
    setActiveModal('userGroups');
    setRelationshipLoading(true);
    setRelationshipMessage('');
    fetch(`${API_BASE}/users/${encodeURIComponent(selectedUser)}/groups`)
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          setUserGroups(data.groups || []);
        } else {
          setUserGroups([]);
          setRelationshipMessage(data.message || 'This information is not available in the current Databricks edition.');
        }
      })
      .catch(() => {
        setUserGroups([]);
        setRelationshipMessage('This information is not available in the current Databricks edition.');
      })
      .finally(() => setRelationshipLoading(false));
  };

  const openGroupMembers = () => {
    if (!selectedGroup) return;
    setActiveModal('groupMembers');
    setRelationshipLoading(true);
    setRelationshipMessage('');
    fetch(`${API_BASE}/groups/${encodeURIComponent(selectedGroup)}/members`)
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          setGroupMembers(data.members || []);
        } else {
          setGroupMembers([]);
          setRelationshipMessage(data.message || 'This information is not available in the current Databricks edition.');
        }
      })
      .catch(() => {
        setGroupMembers([]);
        setRelationshipMessage('This information is not available in the current Databricks edition.');
      })
      .finally(() => setRelationshipLoading(false));
  };

  return (
    <>
      <div className="permission-search">
        <div className="search-field relationship-search-field">
        <label htmlFor="user-search" className="search-label">Search User</label>
        <input
          id="user-search"
          type="text"
          className="search-input"
          placeholder="Filter by user..."
          value={userSearch}
          autoComplete="off"
          onFocus={() => setActiveSuggestion('user')}
          onBlur={() => setTimeout(() => setActiveSuggestion(''), 120)}
          onChange={(e) => updateUserSearch(e.target.value)}
        />
        {activeSuggestion === 'user' && (mergedUserSuggestions.length > 0 || loadingUserSuggestions) && (
          <div className="user-suggestions relationship-suggestions">
            {loadingUserSuggestions && mergedUserSuggestions.length === 0 && (
              <div className="suggestion-empty">Loading users...</div>
            )}
            {mergedUserSuggestions.map((user) => (
              <button
                type="button"
                key={user.id || user.email || user.name}
                className="suggestion-option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectUserSuggestion(user)}
              >
                <strong>{user.name || user.email}</strong>
                <span>{user.email || user.name}</span>
              </button>
            ))}
          </div>
        )}
        {selectedUser && (
          <RelationshipBadge
            icon="👥"
            label="Groups"
            count={userGroups.length}
            onClick={openUserGroups}
          />
        )}
        </div>
        <div className="search-field relationship-search-field">
        <label htmlFor="group-search" className="search-label">Search Group</label>
        <input
          id="group-search"
          type="text"
          className="search-input"
          placeholder="Filter by group..."
          value={groupSearch}
          autoComplete="off"
          onFocus={() => setActiveSuggestion('group')}
          onBlur={() => setTimeout(() => setActiveSuggestion(''), 120)}
          onChange={(e) => updateGroupSearch(e.target.value)}
        />
        {activeSuggestion === 'group' && mergedGroupSuggestions.length > 0 && (
          <div className="user-suggestions relationship-suggestions">
            {mergedGroupSuggestions.map((group) => (
              <button
                type="button"
                key={group.id || group.name}
                className="suggestion-option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectGroupSuggestion(group)}
              >
                <strong>{group.name}</strong>
                <span>{group.source || 'Unity Catalog group'}</span>
              </button>
            ))}
          </div>
        )}
        {selectedGroup && (
          <RelationshipBadge
            icon="👤"
            label="Members"
            count={groupMembers.length}
            onClick={openGroupMembers}
          />
        )}
        </div>
      </div>

      <RelationshipModal
        isOpen={activeModal === 'userGroups'}
        title="User Group Membership"
        subjectLabel="User"
        subject={selectedUser}
        itemLabel="Groups"
        items={userGroups}
        loading={relationshipLoading}
        message={relationshipMessage}
        onClose={() => setActiveModal(null)}
        onExport={() => exportUserGroups({
          user: selectedUser,
          groups: userGroups,
          workspace: workspaceName,
          generatedBy: exportedBy,
        })}
      />
      <RelationshipModal
        isOpen={activeModal === 'groupMembers'}
        title="Group Members"
        subjectLabel="Group"
        subject={selectedGroup}
        itemLabel="Members"
        items={groupMembers}
        loading={relationshipLoading}
        message={relationshipMessage}
        onClose={() => setActiveModal(null)}
        onExport={() => exportGroupMembers({
          group: selectedGroup,
          members: groupMembers,
          workspace: workspaceName,
          generatedBy: exportedBy,
        })}
      />
    </>
  );
}

export default PermissionSearch;
