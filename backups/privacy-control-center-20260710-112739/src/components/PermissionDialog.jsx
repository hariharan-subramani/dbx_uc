import { useEffect, useMemo, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000';

const getFullName = (selectedObject) => {
  if (!selectedObject) return '';
  if (selectedObject.type === 'catalog') return selectedObject.name;
  if (selectedObject.type === 'schema') return `${selectedObject.catalogName}.${selectedObject.name}`;
  if (selectedObject.type === 'table') {
    return `${selectedObject.catalogName}.${selectedObject.schemaName}.${selectedObject.name}`;
  }
  if (selectedObject.type === 'volume') {
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
  if (selectedObject.type === 'volume') {
    return `/volumes/${encodeURIComponent(selectedObject.catalogName)}/${encodeURIComponent(selectedObject.schemaName)}/${encodeURIComponent(selectedObject.name)}/permissions`;
  }
  return '';
};

const getPermissionPayload = (selectedObject, principal, principalType, privileges, administrator) => ({
  objectType: selectedObject?.type || 'catalog',
  catalog: selectedObject?.type === 'catalog' ? selectedObject?.name || '' : selectedObject?.catalogName || '',
  schema: selectedObject?.type === 'schema' ? selectedObject?.name || '' : selectedObject?.schemaName || '',
  table: selectedObject?.type === 'table' ? selectedObject?.name || '' : '',
  volume: selectedObject?.type === 'volume' ? selectedObject?.name || '' : '',
  principalType,
  principal,
  privileges,
  administrator,
});

const getValidationPayload = (selectedObject, principal, principalType) => ({
  principal,
  principal_type: principalType.toLowerCase(),
  object_type: selectedObject?.type || 'catalog',
  catalog: selectedObject?.type === 'catalog' ? selectedObject?.name || '' : selectedObject?.catalogName || '',
  schema: selectedObject?.type === 'schema' ? selectedObject?.name || '' : selectedObject?.schemaName || '',
  table: selectedObject?.type === 'table' ? selectedObject?.name || '' : '',
  volume: selectedObject?.type === 'volume' ? selectedObject?.name || '' : '',
});

const getValidationTone = (validation) => {
  if (!validation) return '';
  if (validation.grantable) return 'success';
  if (String(validation.reason || '').toLowerCase().includes('workspace')) return 'warning';
  return 'error';
};

const getValidationLabel = (validation) => {
  if (!validation) return '';
  if (validation.grantable) return '✅ Grantable';
  if (String(validation.reason || '').toLowerCase().includes('workspace')) return '⚠ Workspace Group';
  if (String(validation.reason || '').toLowerCase().includes('not found')) return '❌ Principal Not Found';
  return `❌ ${validation.reason || 'Not Grantable'}`;
};

const getSuggestionBadge = (suggestion, isGroupPrincipal) => {
  if (isGroupPrincipal) {
    if (suggestion.grantable) return { label: `✅ ${suggestion.grantability_label || 'Account Group'}`, tone: 'success' };
    return { label: `⚠ ${suggestion.grantability_label || 'Workspace Group'}`, tone: 'warning' };
  }
  return { label: `✅ ${suggestion.grantability_label || 'User'}`, tone: 'success' };
};

const friendlyMessage = (status, fallback) => {
  if (fallback) return fallback;
  if (status === 400) return 'Invalid principal or privilege for this object.';
  if (status === 401) return 'Databricks authentication failed.';
  if (status === 403) return 'Permission denied. You cannot manage grants for this object.';
  if (status === 404) return 'Catalog object or principal was not found.';
  if (status === 409) return 'Selected privileges are already assigned to this principal.';
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
  administrator = '',
  onClose,
  onSuccess,
}) {
  const [currentPrincipal, setCurrentPrincipal] = useState(principal);
  const [currentPrincipalType, setCurrentPrincipalType] = useState(principalType);
  const [groups, setGroups] = useState([]);
  const [currentPermissions, setCurrentPermissions] = useState([]);
  const [selectedPrivileges, setSelectedPrivileges] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [activeSuggestions, setActiveSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [principalValidation, setPrincipalValidation] = useState(null);
  const [loadingValidation, setLoadingValidation] = useState(false);
  const [loadingPrivileges, setLoadingPrivileges] = useState(false);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const isEdit = mode === 'edit';
  const isGroupPrincipal = currentPrincipalType === 'Group';
  const objectType = selectedObject?.type || 'catalog';
  const fullName = useMemo(() => getFullName(selectedObject), [selectedObject]);
  const title = isEdit
    ? 'Edit Permission'
    : `Grant ${objectType[0].toUpperCase()}${objectType.slice(1)} Access`;
  const allPrivileges = useMemo(
    () => groups.flatMap((group) => group.privileges || []).map((privilege) => privilege.name),
    [groups],
  );
  const existingPrivileges = useMemo(() => {
    const normalizedPrincipal = currentPrincipal.trim().toLowerCase();
    if (!normalizedPrincipal) return [];
    const match = currentPermissions.find((permission) => (
      String(permission.principal || '').toLowerCase() === normalizedPrincipal
      && String(permission.principal_type || '').toLowerCase() === currentPrincipalType.toLowerCase()
    ));
    return match?.privileges || [];
  }, [currentPermissions, currentPrincipal, currentPrincipalType]);
  const duplicatePrivileges = selectedPrivileges.filter((privilege) => existingPrivileges.includes(privilege));
  const grantablePrivileges = isEdit
    ? selectedPrivileges
    : selectedPrivileges.filter((privilege) => !existingPrivileges.includes(privilege));
  const validationTone = getValidationTone(principalValidation);
  const grantBlockedByValidation = !isEdit && (
    loadingValidation
    || (currentPrincipal.trim() && principalValidation && !principalValidation.grantable)
  );

  useEffect(() => {
    setCurrentPrincipal(principal);
    setCurrentPrincipalType(principalType || 'User');
  }, [principal, principalType]);

  useEffect(() => {
    if (isEdit) {
      setPrincipalValidation(null);
      setLoadingValidation(false);
      return;
    }

    const principalName = currentPrincipal.trim();
    if (!principalName) {
      setPrincipalValidation(null);
      setLoadingValidation(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setLoadingValidation(true);
      fetch(`${API_BASE}/permissions/validate-principal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(getValidationPayload(selectedObject, principalName, currentPrincipalType)),
      })
        .then((response) => response.json())
        .then((data) => {
          if (!controller.signal.aborted) setPrincipalValidation(data);
        })
        .catch((error) => {
          if (error.name !== 'AbortError') {
            setPrincipalValidation({
              grantable: false,
              reason: 'Validation Failed',
              message: 'Unable to validate this principal right now.',
            });
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoadingValidation(false);
        });
    }, 250);

    return () => {
      clearTimeout(timeout);
      controller.abort();
      setLoadingValidation(false);
    };
  }, [currentPrincipal, currentPrincipalType, isEdit, selectedObject]);

  useEffect(() => {
    if (!objectType) return;
    setLoadingPrivileges(true);
    setMessage('');

    const url = `${API_BASE}/permissions/${encodeURIComponent(objectType)}/available-privileges`;
    fetch(url)
      .then(async (response) => {
        const { data } = await parseJsonResponse(response);
        if (!response.ok || !data?.success) {
          setGroups([]);
          setMessage(data?.message || 'Available privileges could not be loaded.');
          return;
        }
        setGroups(data.groups || []);
      })
      .catch(() => {
        setGroups([]);
        setMessage('Available privileges could not be loaded.');
      })
      .finally(() => setLoadingPrivileges(false));
  }, [objectType]);

  useEffect(() => {
    const endpoint = getPermissionsEndpoint(selectedObject);
    if (!endpoint) return;

    setLoadingCurrent(true);
    fetch(`${API_BASE}${endpoint}`)
      .then((response) => response.json())
      .then((data) => {
        if (!data.success) {
          setCurrentPermissions([]);
          if (isEdit) {
            setMessage(data.message || 'Current permissions could not be loaded.');
            setSelectedPrivileges([]);
          }
          return;
        }

        const nextPermissions = data.permissions || [];
        setCurrentPermissions(nextPermissions);
        if (isEdit && currentPrincipal) {
          const match = nextPermissions.find((permission) => (
            String(permission.principal || '').toLowerCase() === currentPrincipal.toLowerCase()
            && String(permission.principal_type || '').toLowerCase() === currentPrincipalType.toLowerCase()
          ));
          setSelectedPrivileges(match?.privileges || []);
        }
      })
      .catch(() => {
        setCurrentPermissions([]);
        if (isEdit) {
          setMessage('Current permissions could not be loaded.');
          setSelectedPrivileges([]);
        }
      })
      .finally(() => setLoadingCurrent(false));
  }, [currentPrincipal, currentPrincipalType, isEdit, selectedObject]);

  useEffect(() => {
    const search = currentPrincipal.trim();
    if (isEdit || !activeSuggestions || !search) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      const endpoint = isGroupPrincipal ? 'groups' : 'users';
      setLoadingSuggestions(true);
      fetch(`${API_BASE}/${endpoint}?search=${encodeURIComponent(search)}`, { signal: controller.signal })
        .then((response) => response.json())
        .then((data) => {
          if (controller.signal.aborted) return;
          setSuggestions(data.success ? data[endpoint] || [] : []);
        })
        .catch((error) => {
          if (error.name !== 'AbortError') setSuggestions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoadingSuggestions(false);
        });
    }, 180);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [activeSuggestions, currentPrincipal, isEdit, isGroupPrincipal]);

  const changePrincipalType = (nextType) => {
    if (isEdit) return;
    setCurrentPrincipalType(nextType);
    setCurrentPrincipal('');
    setSelectedPrivileges([]);
    setSuggestions([]);
    setPrincipalValidation(null);
    setMessage('');
  };

  const selectSuggestion = (suggestion) => {
    const value = isGroupPrincipal
      ? suggestion.name || suggestion.displayName || ''
      : suggestion.email || suggestion.userName || suggestion.name || '';
    setCurrentPrincipal(value);
    setPrincipalValidation(null);
    setSuggestions([]);
    setActiveSuggestions(false);
  };

  const togglePrivilege = (privilege) => {
    if (!isEdit && existingPrivileges.includes(privilege)) {
      setMessage(`${privilege} is already assigned to this principal.`);
      return;
    }
    setMessage('');
    setSelectedPrivileges((current) => (
      current.includes(privilege)
        ? current.filter((item) => item !== privilege)
        : [...current, privilege]
    ));
  };

  const handleSubmit = async () => {
    const principalName = currentPrincipal.trim();
    if (!principalName) {
      setMessage('Principal is required.');
      return;
    }
    if (selectedPrivileges.length === 0) {
      setMessage('Select at least one privilege.');
      return;
    }
    if (!isEdit && grantablePrivileges.length === 0) {
      setMessage('Selected privileges are already assigned to this principal.');
      return;
    }
    if (!isEdit && (!principalValidation || !principalValidation.grantable)) {
      setMessage('This principal cannot receive Unity Catalog permissions.');
      return;
    }

    setSaving(true);
    setMessage('');

    const endpoint = isEdit ? '/permissions/edit' : '/permissions/grant';
    try {
      const response = await fetch(
        `${API_BASE}${endpoint}`,
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(getPermissionPayload(
            selectedObject,
            principalName,
            currentPrincipalType,
            isEdit ? selectedPrivileges : grantablePrivileges,
            administrator,
          )),
        },
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        setMessage(friendlyMessage(data.status_code || response.status, data.message));
        return;
      }
      onSuccess({
        action: isEdit ? 'Edit' : 'Grant',
        principal: principalName,
        principalType: currentPrincipalType,
        privileges: isEdit ? selectedPrivileges : grantablePrivileges,
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
              <span>Securable</span>
              <input className="search-input" value={fullName || selectedObject?.name || ''} readOnly />
            </label>

            <div className="permission-field">
              <span>Principal Type</span>
              <div className="principal-type-options">
                {['User', 'Group'].map((type) => (
                  <label key={type} className="principal-type-option">
                    <input
                      type="radio"
                      name="principal-type"
                      checked={currentPrincipalType === type}
                      disabled={isEdit}
                      onChange={() => changePrincipalType(type)}
                    />
                    <span>{type}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="permission-field user-picker">
              <span>{isGroupPrincipal ? 'Group' : 'User'}</span>
              <input
                className="search-input"
                value={currentPrincipal}
                placeholder={isGroupPrincipal ? 'Search existing groups...' : 'Search existing users...'}
                autoComplete="off"
                readOnly={isEdit}
                onFocus={() => setActiveSuggestions(true)}
                onBlur={() => setTimeout(() => setActiveSuggestions(false), 120)}
                onChange={(event) => {
                  setCurrentPrincipal(event.target.value);
                  setMessage('');
                }}
              />
              {activeSuggestions && !isEdit && (suggestions.length > 0 || loadingSuggestions) && (
                <div className="user-suggestions">
                  {loadingSuggestions && suggestions.length === 0 && (
                    <div className="suggestion-empty">Searching...</div>
                  )}
                  {suggestions.map((suggestion) => (
                    (() => {
                      const badge = getSuggestionBadge(suggestion, isGroupPrincipal);
                      return (
                    <button
                      type="button"
                      key={suggestion.id || suggestion.email || suggestion.name || suggestion.displayName}
                      className="suggestion-option"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectSuggestion(suggestion)}
                    >
                      <strong>{suggestion.name || suggestion.displayName || suggestion.email}</strong>
                      <span>{suggestion.email || suggestion.userName || suggestion.source || suggestion.name}</span>
                      <span className={`principal-grantability-badge ${badge.tone}`}>{badge.label}</span>
                    </button>
                      );
                    })()
                  ))}
                </div>
              )}
            </label>
          </div>

          {!isEdit && currentPrincipal.trim() && (
            <div className={`principal-validation ${validationTone || 'neutral'}`} role="status">
              <strong>
                {loadingValidation
                  ? 'Validating principal...'
                  : principalValidation?.grantable
                    ? '✅ Grantable'
                    : getValidationLabel(principalValidation)}
              </strong>
              <span>
                {loadingValidation
                  ? 'Checking whether this principal can receive Unity Catalog permissions.'
                  : principalValidation?.grantable
                    ? principalValidation?.message || 'This principal can receive Unity Catalog permissions.'
                    : `This principal cannot receive Unity Catalog permissions. ${principalValidation?.message || ''}`}
              </span>
            </div>
          )}

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
                      {(group.privileges || []).map((privilege) => {
                        const isDuplicate = !isEdit && existingPrivileges.includes(privilege.name);
                        return (
                          <label
                            className={`privilege-option ${isDuplicate ? 'disabled' : ''}`}
                            key={privilege.name}
                          >
                            <input
                              type="checkbox"
                              checked={selectedPrivileges.includes(privilege.name)}
                              disabled={!allPrivileges.includes(privilege.name) || isDuplicate}
                              onChange={() => togglePrivilege(privilege.name)}
                            />
                            <span>
                              <strong>{privilege.name}</strong>
                              {privilege.description && <small>{privilege.description}</small>}
                              {isDuplicate && <small>Already assigned</small>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>

          {!isEdit && duplicatePrivileges.length > 0 && (
            <div className="permission-message" role="status">
              Already assigned: {duplicatePrivileges.join(', ')}
            </div>
          )}
          {message && <div className="permission-message" role="alert">{message}</div>}
        </div>

        <div className="permission-modal-footer">
          <button type="button" className="export-button" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="primary-button permission-primary" onClick={handleSubmit} disabled={saving || grantBlockedByValidation}>
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Grant Access'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PermissionDialog;
