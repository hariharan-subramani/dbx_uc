import { useEffect, useMemo, useState } from 'react';
import { exportGroupManagement } from '../utils/excelExport';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000';

const parseResponse = async (response) => {
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return { data, text };
};

const apiRequest = async (path, options = {}) => {
  const response = await fetch(`${API_BASE}${path}`, options);
  const { data, text } = await parseResponse(response);
  if (!response.ok || data.success === false) {
    const message = data.message || data.detail || text || `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return data;
};

const normalizeMember = (member) => ({
  id: member.value || member.id,
  value: member.value || member.id,
  display: member.display || member.email || member.name || member.value,
  email: member.email || member.display || '',
  role: 'Member',
});

function GroupModal({ mode, group, onClose, onSave }) {
  const [name, setName] = useState(group?.name || '');
  const [description, setDescription] = useState(group?.description || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const title = mode === 'create' ? 'Create Group' : 'Edit Group';

  const handleSave = async () => {
    if (!name.trim()) {
      setMessage('Group name is required.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      await onSave({ name: name.trim(), description: description.trim() });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="permission-modal-backdrop" role="presentation">
      <div className="permission-confirm-modal group-edit-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="permission-modal-header">
          <div>
            <h3>{title}</h3>
            <p>{mode === 'create' ? 'Create a Databricks SCIM group.' : 'Rename this Databricks SCIM group.'}</p>
          </div>
          <button type="button" className="relationship-close" onClick={onClose} aria-label="Close">x</button>
        </div>
        <div className="permission-modal-body">
          <label className="permission-field">
            <span>Group Name</span>
            <input className="search-input" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="permission-field">
            <span>Description</span>
            <input className="search-input" value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <div className="muted-text">Databricks workspace SCIM groups may store this value as an external identifier when supported.</div>
          {message && <div className="permission-message" role="alert">{message}</div>}
        </div>
        <div className="permission-modal-footer">
          <button type="button" className="export-button" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="primary-button permission-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : mode === 'create' ? 'Create Group' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddMemberModal({ group, onClose, onSave }) {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('Member');
  const [users, setUsers] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setLoading(true);
      fetch(`${API_BASE}/users?search=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((response) => response.json())
        .then((data) => setUsers(data.success ? data.users || [] : []))
        .catch((error) => {
          if (error.name !== 'AbortError') setUsers([]);
        })
        .finally(() => setLoading(false));
    }, 180);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [open, query]);

  const handleSave = async () => {
    if (!query.trim()) {
      setMessage('Select or enter a user.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      await onSave({ user: query.trim(), role });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="permission-modal-backdrop" role="presentation">
      <div className="permission-confirm-modal group-edit-modal" role="dialog" aria-modal="true" aria-label="Add User to Group">
        <div className="permission-modal-header">
          <div>
            <h3>Add User to Group</h3>
            <p>Group: <strong>{group?.name}</strong></p>
          </div>
          <button type="button" className="relationship-close" onClick={onClose} aria-label="Close">x</button>
        </div>
        <div className="permission-modal-body">
          <label className="permission-field">
            <span>User</span>
            <div className="user-picker group-user-picker">
              <input
                className="search-input"
                value={query}
                placeholder="Search existing Databricks users..."
                autoComplete="off"
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 120)}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setOpen(true);
                }}
              />
              {open && (loading || users.length > 0) && (
                <div className="user-suggestions">
                  {loading ? (
                    <div className="suggestion-empty">Searching users...</div>
                  ) : users.slice(0, 8).map((user) => (
                    <button
                      type="button"
                      key={user.id || user.email}
                      className="suggestion-option"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setQuery(user.email || user.name);
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
          </label>
          <label className="permission-field">
            <span>Role</span>
            <select className="search-input" value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="Member">Member</option>
              <option value="Admin">Admin</option>
            </select>
          </label>
          <div className="muted-text">Databricks SCIM groups support membership, not per-member roles. Use Member for Databricks writes.</div>
          {message && <div className="permission-message" role="alert">{message}</div>}
        </div>
        <div className="permission-modal-footer">
          <button type="button" className="export-button" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="primary-button permission-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Adding...' : 'Add User'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ title, message, confirmLabel, onClose, onConfirm, loading }) {
  return (
    <div className="permission-modal-backdrop" role="presentation">
      <div className="permission-confirm-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="permission-modal-header">
          <div>
            <h3>{title}</h3>
            <p>{message}</p>
          </div>
          <button type="button" className="relationship-close" onClick={onClose} aria-label="Close">x</button>
        </div>
        <div className="permission-modal-footer">
          <button type="button" className="export-button" onClick={onClose} disabled={loading}>Cancel</button>
          <button type="button" className="danger-button" onClick={onConfirm} disabled={loading}>
            {loading ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function GroupManagement({ exportedBy }) {
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupSearch, setGroupSearch] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadingPermissions, setLoadingPermissions] = useState(false);
  const [groupPermissions, setGroupPermissions] = useState([]);
  const [message, setMessage] = useState('');
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [working, setWorking] = useState(false);
  const [auditEvents, setAuditEvents] = useState([]);

  const loadGroups = async (search = groupSearch) => {
    setLoadingGroups(true);
    setMessage('');
    try {
      const data = await apiRequest(`/groups?search=${encodeURIComponent(search)}`);
      setGroups(data.groups || []);
      if (!selectedGroupId && data.groups?.[0]) setSelectedGroupId(data.groups[0].id);
    } catch (error) {
      setGroups([]);
      setMessage(error.message || 'Group management is not supported by the connected Databricks workspace.');
    } finally {
      setLoadingGroups(false);
    }
  };

  const loadGroupDetails = async (groupId = selectedGroupId) => {
    if (!groupId) {
      setSelectedGroup(null);
      setGroupPermissions([]);
      return;
    }
    setLoadingDetails(true);
    setMessage('');
    try {
      const data = await apiRequest(`/groups/${encodeURIComponent(groupId)}/details`);
      setSelectedGroup(data.group);
      loadGroupPermissions(data.group?.name);
    } catch (error) {
      setSelectedGroup(null);
      setGroupPermissions([]);
      setMessage(error.message);
    } finally {
      setLoadingDetails(false);
    }
  };

  const loadGroupPermissions = async (groupName) => {
    if (!groupName) {
      setGroupPermissions([]);
      return;
    }
    setLoadingPermissions(true);
    try {
      const data = await apiRequest(`/groups/${encodeURIComponent(groupName)}/permissions`);
      setGroupPermissions(data.permissions || []);
    } catch (error) {
      console.error('Group permissions scan failed', {
        groupName,
        message: error.message,
      });
      setGroupPermissions([]);
    } finally {
      setLoadingPermissions(false);
    }
  };

  useEffect(() => {
    loadGroups('');
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => loadGroups(groupSearch), 180);
    return () => clearTimeout(timeout);
  }, [groupSearch]);

  useEffect(() => {
    loadGroupDetails(selectedGroupId);
  }, [selectedGroupId]);

  const members = useMemo(() => (
    (selectedGroup?.members || []).map(normalizeMember)
  ), [selectedGroup]);

  const filteredMembers = useMemo(() => {
    const normalized = memberSearch.trim().toLowerCase();
    if (!normalized) return members;
    return members.filter((member) => (
      String(member.display || '').toLowerCase().includes(normalized)
      || String(member.email || '').toLowerCase().includes(normalized)
    ));
  }, [memberSearch, members]);

  const recordAudit = (action, details) => {
    setAuditEvents((current) => [{
      action,
      group: selectedGroup?.name || details?.group || '',
      principal: details?.principal || '',
      timestamp: new Date().toISOString(),
    }, ...current]);
  };

  const refreshAll = async (groupId = selectedGroupId) => {
    await loadGroups(groupSearch);
    await loadGroupDetails(groupId);
  };

  const handleCreateGroup = async (payload) => {
    const data = await apiRequest('/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    recordAudit('Create Group', { group: payload.name });
    setModal(null);
    setSelectedGroupId(data.group?.id || selectedGroupId);
    await refreshAll(data.group?.id || selectedGroupId);
  };

  const handleUpdateGroup = async (payload) => {
    const data = await apiRequest(`/groups/${encodeURIComponent(selectedGroup.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    recordAudit('Rename Group', { group: payload.name });
    setModal(null);
    await refreshAll(data.group?.id || selectedGroup.id);
  };

  const handleAddMember = async (payload) => {
    const data = await apiRequest(`/groups/${encodeURIComponent(selectedGroup.id)}/members`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    recordAudit('Add User', { principal: payload.user });
    setModal(null);
    await refreshAll(data.group?.id || selectedGroup.id);
  };

  const handleRemoveMember = async (member) => {
    setWorking(true);
    try {
      await apiRequest(`/groups/${encodeURIComponent(selectedGroup.id)}/members/${encodeURIComponent(member.value)}`, {
        method: 'DELETE',
      });
      recordAudit('Remove User', { principal: member.display });
      setConfirm(null);
      await refreshAll(selectedGroup.id);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setWorking(false);
    }
  };

  const handleDeleteGroup = async () => {
    setWorking(true);
    try {
      await apiRequest(`/groups/${encodeURIComponent(selectedGroup.id)}`, { method: 'DELETE' });
      recordAudit('Delete Group', { group: selectedGroup.name });
      setConfirm(null);
      setSelectedGroupId('');
      setSelectedGroup(null);
      await loadGroups(groupSearch);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setWorking(false);
    }
  };

  const handleExport = async () => {
    if (!selectedGroup) return;

    let permissions = groupPermissions;
    let timeout;
    setLoadingPermissions(true);
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 20000);
      const data = await apiRequest(
        `/groups/${encodeURIComponent(selectedGroup.name)}/permissions?scan=true`,
        { signal: controller.signal },
      );
      permissions = data.permissions || [];
      setGroupPermissions(permissions);
    } catch (error) {
      const reason = error.name === 'AbortError'
        ? 'The permissions scan took too long.'
        : error.message;
      setMessage(`Group permissions could not be included in this export. ${reason}`);
    } finally {
      clearTimeout(timeout);
      setLoadingPermissions(false);
    }

    exportGroupManagement({
      group: selectedGroup,
      members,
      permissions,
      generatedBy: exportedBy,
    });
  };

  return (
    <div className="identity-page group-management-page">
      <div className="page-heading">
        <div>
          <h1>Group Management</h1>
          <p>Manage Databricks SCIM groups and group membership.</p>
        </div>
        <button type="button" className="primary-button" onClick={() => setModal('create')}>
          Create Group
        </button>
      </div>

      {message && <div className="alert" role="alert"><span>!</span>{message}</div>}

      <div className="group-management-layout">
        <section className="identity-section group-list-panel">
          <div className="identity-section-header">
            <h3>Existing Groups</h3>
            <span>{groups.length}</span>
          </div>
          <div className="group-list-tools">
            <label className="search-field">
              <span className="search-label">Search Group</span>
              <input
                className="search-input"
                value={groupSearch}
                placeholder="Search..."
                onChange={(event) => setGroupSearch(event.target.value)}
              />
            </label>
          </div>
          <div className="group-list">
            {loadingGroups ? (
              <div className="empty-state">Loading groups...</div>
            ) : groups.length === 0 ? (
              <div className="empty-state">No groups found.</div>
            ) : groups.map((group) => (
              <button
                type="button"
                key={group.id || group.name}
                className={`group-list-item ${selectedGroupId === group.id ? 'selected' : ''}`}
                onClick={() => setSelectedGroupId(group.id)}
              >
                <strong>{group.name}</strong>
                <span>{group.member_count || 0} members</span>
              </button>
            ))}
          </div>
        </section>

        <section className="identity-section group-detail-panel">
          <div className="identity-section-header">
            <h3>Group Details</h3>
            <span>{selectedGroup?.group_type || 'Group'}</span>
          </div>

          {loadingDetails ? (
            <div className="empty-state">Loading group details...</div>
          ) : !selectedGroup ? (
            <div className="empty-state">Select a group to view details.</div>
          ) : (
            <>
              <div className="details-header-actions group-actions">
                <button type="button" className="export-button" onClick={handleExport} disabled={loadingPermissions}>
                  {loadingPermissions ? 'Scanning...' : 'Export'}
                </button>
                <button type="button" className="export-button" onClick={() => setModal('edit')}>Edit Group</button>
                <button type="button" className="danger-button" onClick={() => setConfirm({ type: 'deleteGroup' })}>
                  Delete Group
                </button>
              </div>

              <div className="summary-row identity-summary">
                <div className="summary-item"><span className="summary-label">Group Name</span><span className="summary-value">{selectedGroup.name}</span></div>
                <div className="summary-item"><span className="summary-label">Created Date</span><span className="summary-value">{selectedGroup.created_at || 'Unavailable'}</span></div>
                <div className="summary-item"><span className="summary-label">Description</span><span className="summary-value">{selectedGroup.description || 'Unavailable'}</span></div>
                <div className="summary-item"><span className="summary-label">Number of Members</span><span className="summary-value">{members.length}</span></div>
                <div className="summary-item"><span className="summary-label">Group Type</span><span className="summary-value">{selectedGroup.group_type}</span></div>
              </div>

              <div className="members-section">
                <div className="identity-section-header">
                  <h3>Members</h3>
                  <span>{filteredMembers.length}</span>
                </div>
                <div className="member-toolbar">
                  <label className="search-field">
                    <span className="search-label">Search User</span>
                    <input
                      className="search-input"
                      value={memberSearch}
                      placeholder="Search users inside this group..."
                      onChange={(event) => setMemberSearch(event.target.value)}
                    />
                  </label>
                  <button type="button" className="primary-button" onClick={() => setModal('addMember')}>
                    Add User
                  </button>
                </div>

                <div className="permission-table-wrapper">
                  <table className="permission-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMembers.length === 0 ? (
                        <tr>
                          <td colSpan="4"><span className="muted-text">No members found.</span></td>
                        </tr>
                      ) : filteredMembers.map((member) => (
                        <tr key={member.value || member.display}>
                          <td className="principal-cell"><span className="principal-name">{member.display}</span></td>
                          <td>{member.email || member.display}</td>
                          <td><span className="principal-type type-user">{member.role}</span></td>
                          <td className="permission-actions-cell">
                            <button type="button" className="table-action-button" disabled title="Databricks SCIM does not support per-member roles.">
                              Edit
                            </button>
                            <button
                              type="button"
                              className="table-action-button danger"
                              onClick={() => setConfirm({ type: 'removeMember', member })}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="audit-prep-strip">
                <span>Audit events prepared</span>
                <strong>{auditEvents.length}</strong>
              </div>
            </>
          )}
        </section>
      </div>

      {modal === 'create' && (
        <GroupModal
          mode="create"
          onClose={() => setModal(null)}
          onSave={handleCreateGroup}
        />
      )}
      {modal === 'edit' && selectedGroup && (
        <GroupModal
          mode="edit"
          group={selectedGroup}
          onClose={() => setModal(null)}
          onSave={handleUpdateGroup}
        />
      )}
      {modal === 'addMember' && selectedGroup && (
        <AddMemberModal
          group={selectedGroup}
          onClose={() => setModal(null)}
          onSave={handleAddMember}
        />
      )}
      {confirm?.type === 'removeMember' && (
        <ConfirmModal
          title="Remove"
          message={`Remove ${confirm.member.display} from ${selectedGroup?.name}?`}
          confirmLabel="Remove"
          loading={working}
          onClose={() => setConfirm(null)}
          onConfirm={() => handleRemoveMember(confirm.member)}
        />
      )}
      {confirm?.type === 'deleteGroup' && (
        <ConfirmModal
          title="Delete Group"
          message="This action cannot be undone."
          confirmLabel="Delete Group"
          loading={working}
          onClose={() => setConfirm(null)}
          onConfirm={handleDeleteGroup}
        />
      )}
    </div>
  );
}

export default GroupManagement;
