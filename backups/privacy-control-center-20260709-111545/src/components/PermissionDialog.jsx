import { useEffect, useMemo, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000';

const getFullName = (selectedObject) => {
  if (!selectedObject) return '';
  if (selectedObject.type === 'catalog') return selectedObject.name;
  if (selectedObject.type === 'schema') return `${selectedObject.catalogName}.${selectedObject.name}`;
  if (selectedObject.type === 'table') {
    return `${selectedObject.catalogName}.${selectedObject.schemaName}.${selectedObject.name}`;
  }
  return selectedObject.name || '';
};

const getPermissionsEndpoint = (selectedObject) => {
  if (!selectedObject) return '';
  if (selectedObject.type === 'catalog') {
    return `/catalogs/${encodeURIComponent(selectedObject.name)}/permissions`;
  }
  if (selectedObject.type === 'schema') {
    return `/schemas/${encodeURIComponent(selectedObject.catalogName)}/${encodeURIComponent(selectedObject.name)}/permissions`;
  }
  if (selectedObject.type === 'table') {
    return `/tables/${encodeURIComponent(selectedObject.catalogName)}/${encodeURIComponent(selectedObject.schemaName)}/${encodeURIComponent(selectedObject.name)}/permissions`;
  }
  return '';
};

const friendlyMessage = (status, fallback) => {
  if (fallback) return fallback;
  if (status === 400) return 'Invalid principal or privilege for this object.';
  if (status === 401) return 'Databricks authentication failed.';
  if (status === 403) return 'Permission denied. You cannot manage grants for this object.';
  if (status === 404) return 'Catalog object or principal was not found.';
  if (status === 409) return 'Permission already exists or conflicts with the current state.';
  if (status >= 500) return 'Databricks returned a server error.';
  return 'Unable to update permissions.';
};

const parseJsonResponse = async (response) => {
  const responseText = await response.text();
  let data = null;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = null;
  }
  return { data, responseText };
};

function PermissionDialog({
  mode,
  selectedObject,
  principal = '',
  principalType = 'User',
  onClose,
  onSuccess,
}) {
  const [currentPrincipal, setCurrentPrincipal] = useState(principal);
  const [currentPrincipalType, setCurrentPrincipalType] = useState(principalType);
  const [groups, setGroups] = useState([]);
  const [selectedPrivileges, setSelectedPrivileges] = useState([]);
  const [loadingPrivileges, setLoadingPrivileges] = useState(false);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const isGroupPrincipal = currentPrincipalType === 'Group';
  const title = mode === 'edit'
    ? `Update ${isGroupPrincipal ? 'Group' : 'User'} Permissions`
    : isGroupPrincipal
      ? 'Grant Group Access'
      : 'Grant Catalog Access';
  const objectType = selectedObject?.type || 'catalog';
  const fullName = useMemo(() => getFullName(selectedObject), [selectedObject]);
  const allPrivileges = useMemo(
    () => groups.flatMap((group) => group.privileges || []).map((privilege) => privilege.name),
    [groups],
  );

  useEffect(() => {
    setCurrentPrincipal(principal);
    setCurrentPrincipalType(principalType || 'User');
  }, [principal, principalType]);

  useEffect(() => {
    if (!objectType) return;
    setLoadingPrivileges(true);
    setMessage('');

    const url = `${API_BASE}/permissions/${encodeURIComponent(objectType)}/available-privileges`;
    console.info('[PermissionDialog] Loading available privileges', {
      method: 'GET',
      url,
      objectType,
      selectedObject,
    });

    fetch(url)
      .then(async (response) => {
        const { data, responseText } = await parseJsonResponse(response);
        if (!response.ok) {
          console.error('[PermissionDialog] Available privileges request failed', {
            method: 'GET',
            url,
            statusCode: response.status,
            responseBody: responseText,
            errorMessage: data?.message || data?.detail || response.statusText,
          });
          setGroups([]);
          setMessage(data?.message || 'Available privileges could not be loaded. Restart the FastAPI backend if this route returns 404.');
          return;
        }

        if (data?.success) {
          setGroups(data.groups || []);
        } else {
          console.error('[PermissionDialog] Available privileges returned an error payload', {
            method: 'GET',
            url,
            statusCode: response.status,
            responseBody: responseText,
            errorMessage: data?.message || 'Unknown backend error',
          });
          setGroups([]);
          setMessage(data?.message || 'Available privileges could not be loaded.');
        }
      })
      .catch((error) => {
        console.error('[PermissionDialog] Available privileges request crashed', {
          method: 'GET',
          url,
          errorMessage: error.message,
        });
        setGroups([]);
        setMessage('Available privileges could not be loaded.');
      })
      .finally(() => setLoadingPrivileges(false));
  }, [objectType]);

  useEffect(() => {
    if (mode !== 'edit' || !selectedObject || !currentPrincipal) {
      if (mode === 'grant') setSelectedPrivileges([]);
      return;
    }

    const endpoint = getPermissionsEndpoint(selectedObject);
    if (!endpoint) return;

    setLoadingCurrent(true);
    fetch(`${API_BASE}${endpoint}`)
      .then((response) => response.json())
      .then((data) => {
        if (!data.success) {
          setMessage(data.message || 'Current permissions could not be loaded.');
          setSelectedPrivileges([]);
          return;
        }

        const match = (data.permissions || []).find(
          (permission) => String(permission.principal || '').toLowerCase() === currentPrincipal.toLowerCase(),
        );
        setSelectedPrivileges(match?.privileges || []);
      })
      .catch(() => {
        setMessage('Current permissions could not be loaded.');
        setSelectedPrivileges([]);
      })
      .finally(() => setLoadingCurrent(false));
  }, [currentPrincipal, mode, selectedObject]);

  const togglePrivilege = (privilege) => {
    setSelectedPrivileges((current) => (
      current.includes(privilege)
        ? current.filter((item) => item !== privilege)
        : [...current, privilege]
    ));
  };

  const handleSubmit = async () => {
    if (!currentPrincipal.trim()) {
      setMessage('Principal is required.');
      return;
    }
    if (selectedPrivileges.length === 0) {
      setMessage('Select at least one privilege.');
      return;
    }

    setSaving(true);
    setMessage('');

    const action = mode === 'edit' ? 'update' : 'grant';
    const endpoint = objectType === 'catalog'
      ? `/catalogs/${encodeURIComponent(fullName)}/permissions`
      : `/permissions/${encodeURIComponent(objectType)}/${encodeURIComponent(fullName)}/${action}`;
    try {
      const response = await fetch(
        `${API_BASE}${endpoint}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            principal: currentPrincipal.trim(),
            principal_type: currentPrincipalType,
            privileges: selectedPrivileges,
            action,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        setMessage(friendlyMessage(response.status, data.message));
        return;
      }
      onSuccess({
        action: mode === 'edit' ? 'Update' : 'Grant',
        principal: currentPrincipal.trim(),
        principalType: currentPrincipalType,
        privileges: selectedPrivileges,
        catalog: selectedObject?.catalogName || selectedObject?.name,
        object: fullName,
        response: data,
      });
    } catch {
      setMessage('Unable to reach the permission API.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="permission-modal-backdrop" role="presentation">
      <div className="permission-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="permission-modal-header">
          <div>
            <h3>{title}</h3>
            <p>{objectType.toUpperCase()} - {fullName}</p>
          </div>
          <button type="button" className="relationship-close" onClick={onClose} aria-label="Close">x</button>
        </div>

        <div className="permission-modal-body">
          <div className="permission-form-grid">
            <label className="permission-field">
              <span>Catalog</span>
              <input className="search-input" value={selectedObject?.catalogName || selectedObject?.name || ''} readOnly />
            </label>
            <label className="permission-field">
              <span>{isGroupPrincipal ? 'Group' : 'User'}</span>
              <input
                className="search-input"
                value={currentPrincipal}
                onChange={(event) => setCurrentPrincipal(event.target.value)}
                readOnly={mode === 'edit'}
              />
            </label>
            <label className="permission-field">
              <span>Principal Type</span>
              <select
                className="search-input"
                value={currentPrincipalType}
                onChange={(event) => setCurrentPrincipalType(event.target.value)}
                disabled
              >
                <option value="User">User</option>
                <option value="Group">Group</option>
              </select>
            </label>
          </div>

          <div className="privilege-picker">
            <div className="privilege-picker-header">
              <strong>Privileges</strong>
              <span>{selectedPrivileges.length} selected</span>
            </div>

            {(loadingPrivileges || loadingCurrent) ? (
              <div className="loading-placeholder">Loading privileges...</div>
            ) : (
              <div className="privilege-groups">
                {groups.map((group) => (
                  <section className="privilege-group" key={group.group}>
                    <h4>{group.group}</h4>
                    <div className="privilege-options">
                      {(group.privileges || []).map((privilege) => (
                        <label className="privilege-option" key={privilege.name}>
                          <input
                            type="checkbox"
                            checked={selectedPrivileges.includes(privilege.name)}
                            disabled={!allPrivileges.includes(privilege.name)}
                            onChange={() => togglePrivilege(privilege.name)}
                          />
                          <span>
                            <strong>{privilege.name}</strong>
                            {privilege.description && <small>{privilege.description}</small>}
                          </span>
                        </label>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>

          {message && <div className="permission-message" role="alert">{message}</div>}
        </div>

        <div className="permission-modal-footer">
          <button type="button" className="export-button" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="primary-button permission-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving...' : mode === 'edit' ? 'Save Changes' : 'Grant Access'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PermissionDialog;
