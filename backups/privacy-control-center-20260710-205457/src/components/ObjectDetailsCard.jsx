import { useState, useEffect } from 'react';
import PermissionSearch from './PermissionSearch';
import PermissionTable from './PermissionTable';
import PermissionDialog from './PermissionDialog';
import {
  exportCatalog,
  exportCatalogBinding,
  exportPermissions,
  exportSchema,
  exportSchemaObjects,
  exportTable,
  exportTableStatistics,
  exportVolume,
} from '../utils/excelExport';

/* eslint-disable react-hooks/set-state-in-effect */
const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000';

const buildPermissionPayload = (selectedObject, principal, principalType, privileges, administrator = '') => ({
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

const formatDate = (value) => {
  if (!value) return 'N/A';
  const timestamp = typeof value === 'number' && value < 1000000000000 ? value * 1000 : value;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(date);
};

function ObjectDetailsCard({
  selectedObject,
  objectDetails,
  permissions,
  permissionsMessage,
  loadingPermissions,
  exportedBy,
  onRefreshObject,
}) {
  const [isPermissionsOpen, setIsPermissionsOpen] = useState(true);
  const [isBindingOpen, setIsBindingOpen] = useState(true);
  const [isObjectsOpen, setIsObjectsOpen] = useState(true);
  const [isStatisticsOpen, setIsStatisticsOpen] = useState(true);
  const [userSearch, setUserSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [bindings, setBindings] = useState([]);
  const [objects, setObjects] = useState([]);
  const [statistics, setStatistics] = useState(null);
  const [loadingExtra, setLoadingExtra] = useState(false);
  const [extraMessage, setExtraMessage] = useState('');
  const [permissionDialog, setPermissionDialog] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [permissionActionMessage, setPermissionActionMessage] = useState('');
  const [permissionActionError, setPermissionActionError] = useState('');
  const [removing, setRemoving] = useState(false);
  const [auditEvents, setAuditEvents] = useState([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const objectType = selectedObject?.type;
  const objectName = selectedObject?.name;

  useEffect(() => {
    setUserSearch('');
    setGroupSearch('');
    setPermissionDialog(null);
    setRemoveTarget(null);
    setPermissionActionMessage('');
    setPermissionActionError('');
  }, [objectType, objectName]);

  const getTitle = () => {
    if (objectType === 'catalog') return 'Catalog Details';
    if (objectType === 'schema') return 'Schema Details';
    if (objectType === 'table') return 'Table Details';
    if (objectType === 'volume') return 'Volume Details';
    return 'Details';
  };

  const getAccessLevelColor = (level) => {
    const normalized = String(level || '').toUpperCase();
    if (normalized.includes('READ_WRITE') || normalized.includes('READ & WRITE')) return 'green';
    if (normalized.includes('READ_ONLY') || normalized.includes('READ ONLY')) return 'blue';
    if (normalized.includes('NO ACCESS')) return 'gray';
    return 'gray';
  };

  const visiblePermissions = (permissions || []).filter((permission) => {
    const principal = permission.principal || '';
    const principalType = permission.principal_type || '';
    const userMatches = Boolean(userSearch)
      && principalType.toLowerCase() === 'user'
      && principal.toLowerCase().includes(userSearch.toLowerCase());
    const groupMatches = Boolean(groupSearch)
      && principalType.toLowerCase() === 'group'
      && principal.toLowerCase().includes(groupSearch.toLowerCase());

    if (!userSearch && !groupSearch) return true;
    return userMatches || groupMatches;
  });

  const togglePermissions = () => setIsPermissionsOpen((current) => !current);
  const toggleBinding = () => setIsBindingOpen((current) => !current);

  const handleExportCatalog = () => {
    exportCatalog({
      catalogName: objectName,
      details: objectDetails,
      permissions: permissions || [],
      bindings,
      workspaceName: selectedObject?.workspaceName,
      exportedBy,
    });
  };

  const handleExportObject = () => {
    if (objectType === 'catalog') {
      handleExportCatalog();
      return;
    }

    if (objectType === 'schema') {
      exportSchema({
        schemaName: objectName,
        details: objectDetails,
        permissions: permissions || [],
        objects,
        exportedBy,
      });
      return;
    }

    if (objectType === 'table') {
      exportTable({
        tableName: objectName,
        details: objectDetails,
        permissions: permissions || [],
        statistics,
        exportedBy,
      });
      return;
    }

    if (objectType === 'volume') {
      exportVolume({
        volumeName: objectName,
        details: objectDetails,
        permissions: permissions || [],
        bindings,
        exportedBy,
      });
    }
  };

  const handleExportPermissions = (event) => {
    event.stopPropagation();
    exportPermissions({
      objectType: objectType ? objectType[0].toUpperCase() + objectType.slice(1) : 'Catalog',
      objectName,
      permissions: visiblePermissions,
    });
  };

  const handleExportCatalogBinding = (event) => {
    event.stopPropagation();
    exportCatalogBinding({
      catalogName: objectName,
      bindings,
    });
  };

  const recordAuditEvent = ({ action, principal, principalType, privileges, catalog, object }) => {
    setAuditEvents((current) => [
      {
        action: principalType === 'Group'
          ? `${action} Group ${action === 'Grant' ? 'Access' : 'Permissions'}`
          : action,
        principal,
        principalType,
        privileges,
        catalog,
        object,
        timestamp: new Date().toISOString(),
      },
      ...current,
    ]);
  };

  const refreshAfterPermissionChange = async () => {
    setRefreshToken((current) => current + 1);
    window.dispatchEvent(new CustomEvent('privacy-permissions-changed', {
      detail: {
        objectType,
        objectName,
        selectedObject,
      },
    }));
    if (onRefreshObject) {
      await onRefreshObject();
    }
  };

  const handlePermissionSuccess = async (event) => {
    recordAuditEvent(event);
    setPermissionDialog(null);
    setPermissionActionError('');
    setPermissionActionMessage(
      event.action === 'Grant'
        ? `${event.principalType === 'Group' ? 'Group permission' : 'Permission'} granted successfully.`
        : 'Permissions updated successfully.'
    );
    await refreshAfterPermissionChange();
  };

  const handleRemovePermission = async () => {
    if (!removeTarget || !selectedObject) return;
    setRemoving(true);
    setPermissionActionError('');
    setPermissionActionMessage('');

    const fullName = objectType === 'catalog'
      ? objectName
      : objectType === 'schema'
        ? `${selectedObject.catalogName}.${objectName}`
        : `${selectedObject.catalogName}.${selectedObject.schemaName}.${objectName}`;
    try {
      const response = await fetch(
        `${API_BASE}/permissions/remove`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPermissionPayload(
            selectedObject,
            removeTarget.principal,
            removeTarget.principal_type,
            removeTarget.privileges || [],
            exportedBy,
          )),
        },
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        setPermissionActionError(data.message || 'Unable to remove access.');
        return;
      }

      recordAuditEvent({
        action: 'Remove',
        principal: removeTarget.principal,
        principalType: removeTarget.principal_type,
        privileges: removeTarget.privileges || [],
        catalog: selectedObject?.catalogName || selectedObject?.name,
        object: fullName,
      });
      setRemoveTarget(null);
      setPermissionActionMessage('Access removed successfully.');
      await refreshAfterPermissionChange();
    } catch {
      setPermissionActionError('Unable to reach the permission API.');
    } finally {
      setRemoving(false);
    }
  };

  const handleExportSchemaObjects = (event) => {
    event.stopPropagation();
    exportSchemaObjects({
      schemaName: objectName,
      objects,
    });
  };

  const handleExportTableStatistics = (event) => {
    event.stopPropagation();
    exportTableStatistics({
      tableName: objectName,
      statistics,
    });
  };

  useEffect(() => {
    if (objectType === 'catalog' && objectName) {
      setBindings([]);
      setObjects([]);
      setStatistics(null);
      setExtraMessage('');
      setLoadingExtra(true);
      fetch(`${API_BASE}/catalogs/${encodeURIComponent(objectName)}/bundles`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setBindings(data.bindings || data.bundles || []);
          } else {
            setExtraMessage('Catalog binding is unavailable for this catalog.');
          }
        })
        .catch((err) => {
          setExtraMessage('Catalog binding is unavailable for this catalog.');
          console.error('Error loading catalog binding:', err);
        })
        .finally(() => setLoadingExtra(false));
    }
  }, [objectType, objectName, refreshToken]);

  useEffect(() => {
    if (objectType === 'schema' && objectName) {
      setBindings([]);
      setObjects([]);
      setStatistics(null);
      setExtraMessage('');
      setLoadingExtra(true);
      const catalogName = selectedObject?.catalogName || objectDetails?.find((d) => d.label === 'Catalog')?.value;
      if (catalogName) {
        fetch(`${API_BASE}/catalogs/${encodeURIComponent(catalogName)}/schemas/${encodeURIComponent(objectName)}/objects`)
          .then((res) => res.json())
          .then((data) => {
            if (data.success) {
              setObjects(data.objects || []);
            } else {
              setExtraMessage('Schema objects are unavailable for this schema.');
            }
          })
          .catch((err) => {
            setExtraMessage('Schema objects are unavailable for this schema.');
            console.error('Error loading objects:', err);
          })
          .finally(() => setLoadingExtra(false));
      } else {
        setExtraMessage('Schema objects are unavailable until catalog metadata loads.');
        setLoadingExtra(false);
      }
    }
  }, [objectType, objectName, selectedObject?.catalogName, objectDetails, refreshToken]);

  useEffect(() => {
    if (objectType === 'table' && objectName) {
      setBindings([]);
      setObjects([]);
      setStatistics(null);
      setExtraMessage('');
      setLoadingExtra(true);
      const catalogName = selectedObject?.catalogName || objectDetails?.find((d) => d.label === 'Catalog')?.value;
      const schemaName = selectedObject?.schemaName || objectDetails?.find((d) => d.label === 'Schema')?.value;
      if (catalogName && schemaName) {
        fetch(`${API_BASE}/catalogs/${encodeURIComponent(catalogName)}/schemas/${encodeURIComponent(schemaName)}/tables/${encodeURIComponent(objectName)}/statistics`)
          .then((res) => res.json())
          .then((data) => {
            if (data.success) {
              setStatistics(data.statistics);
            } else {
              setExtraMessage('Table statistics are unavailable for this table.');
            }
          })
          .catch((err) => {
            setExtraMessage('Table statistics are unavailable for this table.');
            console.error('Error loading statistics:', err);
          })
          .finally(() => setLoadingExtra(false));
      } else {
        setExtraMessage('Table statistics are unavailable until table metadata loads.');
        setLoadingExtra(false);
      }
    }
  }, [objectType, objectName, selectedObject?.catalogName, selectedObject?.schemaName, objectDetails, refreshToken]);

  useEffect(() => {
    if (objectType === 'volume' && objectName) {
      setBindings([]);
      setObjects([]);
      setStatistics(null);
      setExtraMessage('');
      setLoadingExtra(true);
      const catalogName = selectedObject?.catalogName || objectDetails?.find((d) => d.label === 'Catalog')?.value;
      const schemaName = selectedObject?.schemaName || objectDetails?.find((d) => d.label === 'Schema')?.value;
      if (catalogName && schemaName) {
        fetch(`${API_BASE}/catalogs/${encodeURIComponent(catalogName)}/schemas/${encodeURIComponent(schemaName)}/volumes/${encodeURIComponent(objectName)}/binding`)
          .then((res) => res.json())
          .then((data) => {
            setBindings(data.success ? data.bindings || [] : []);
          })
          .catch((err) => {
            setBindings([]);
            console.error('Error loading volume binding:', err);
          })
          .finally(() => setLoadingExtra(false));
      } else {
        setLoadingExtra(false);
      }
    }
  }, [objectType, objectName, selectedObject?.catalogName, selectedObject?.schemaName, objectDetails, refreshToken]);

  if (!selectedObject) return null;

  return (
    <div className="object-details-card">
      <div className="object-details-header">
        <h2>{getTitle()}</h2>
        <div className="details-header-actions">
          {['catalog', 'schema', 'table', 'volume'].includes(objectType) && (
            <button type="button" className="export-button" onClick={handleExportObject}>
              {`Export ${objectType[0].toUpperCase()}${objectType.slice(1)}`}
            </button>
          )}
          <span className="object-type-badge">{selectedObject.type}</span>
        </div>
      </div>

      {objectDetails && (
        <div className="summary-row">
          {objectDetails.map((item, index) => (
            <div key={index} className="summary-item">
              <span className="summary-label">{item.label}</span>
              <span className="summary-value">{item.value || 'N/A'}</span>
            </div>
          ))}
        </div>
      )}

      {(loadingPermissions || permissions) && (
        <div className="permissions-accordion">
          <div
            role="button"
            tabIndex={0}
            className="accordion-header"
            onClick={togglePermissions}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') togglePermissions();
            }}
          >
            <span className="accordion-title">Permissions</span>
            <span className="accordion-actions">
              {['catalog', 'schema', 'table', 'volume'].includes(objectType) && (
                <button type="button" className="export-button" onClick={handleExportPermissions}>
                  Export
                </button>
              )}
              {['catalog', 'schema', 'table', 'volume'].includes(objectType) && (
                <button
                  type="button"
                  className="primary-button permission-toolbar-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    const nextPrincipalType = groupSearch && !userSearch ? 'Group' : 'User';
                    setPermissionDialog({
                      mode: 'grant',
                      principal: nextPrincipalType === 'Group' ? groupSearch : userSearch || '',
                      principalType: nextPrincipalType,
                    });
                  }}
                >
                  Grant Access
                </button>
              )}
              <span className={`accordion-icon ${isPermissionsOpen ? 'open' : ''}`}>v</span>
            </span>
          </div>

          {isPermissionsOpen && (
            <div className="accordion-content">
              <PermissionSearch
                key={`${objectType || ''}:${objectName || ''}`}
                permissions={permissions || []}
                exportedBy={exportedBy}
                workspaceName={selectedObject?.workspaceName}
                onFilterChange={(filters) => {
                  setUserSearch(filters.userSearch);
                  setGroupSearch(filters.groupSearch);
                }}
              />
              {permissionActionMessage && (
                <div className="permission-status success">{permissionActionMessage}</div>
              )}
              {permissionActionError && (
                <div className="permission-status error">{permissionActionError}</div>
              )}
              {loadingPermissions ? (
                <div className="permission-table-empty">
                  <p>Loading permissions...</p>
                </div>
              ) : (
                <PermissionTable
                  permissions={permissions}
                  userSearch={userSearch}
                  groupSearch={groupSearch}
                  emptyMessage={permissionsMessage}
                  selectedObject={selectedObject}
                  onGrantMissingPrincipal={(principal, nextPrincipalType) => (
                    setPermissionDialog({ mode: 'grant', principal, principalType: nextPrincipalType })
                  )}
                  onEditPermission={(permission) => (
                    setPermissionDialog({
                      mode: 'edit',
                      principal: permission.principal,
                      principalType: permission.principal_type || 'User',
                    })
                  )}
                  onRemovePermission={setRemoveTarget}
                />
              )}
              <div className="audit-prep-strip">
                <span>Audit events prepared</span>
                <strong>{auditEvents.length}</strong>
              </div>
            </div>
          )}
        </div>
      )}

      {objectType === 'catalog' && (
        <div className="bundles-accordion">
          <div
            role="button"
            tabIndex={0}
            className="accordion-header"
            onClick={toggleBinding}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') toggleBinding();
            }}
          >
            <span className="accordion-title">Catalog Binding</span>
            <span className="accordion-actions">
              <button type="button" className="export-button" onClick={handleExportCatalogBinding}>
                Export
              </button>
              <span className={`accordion-icon ${isBindingOpen ? 'open' : ''}`}>v</span>
            </span>
          </div>

          {isBindingOpen && (
            <div className="accordion-content">
              {loadingExtra ? (
                <div className="loading-placeholder">Loading catalog binding...</div>
              ) : bindings.length > 0 ? (
                <div className="bundles-table-wrapper">
                  <table className="bundles-table">
                    <thead>
                      <tr>
                        <th>Workspace Name</th>
                        <th>Workspace ID</th>
                        <th>Access Level</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bindings.map((binding, index) => (
                        <tr key={index}>
                          <td className="bundle-name">{binding.workspace_name}</td>
                          <td className="bundle-id">{binding.workspace_id}</td>
                          <td className="bundle-access">
                            <span className={`access-badge access-${getAccessLevelColor(binding.access_level)}`}>
                              {binding.access_level}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">{extraMessage || 'No catalog binding found'}</div>
              )}
            </div>
          )}
        </div>
      )}

      {objectType === 'volume' && bindings.length > 0 && (
        <div className="bundles-accordion">
          <div
            role="button"
            tabIndex={0}
            className="accordion-header"
            onClick={toggleBinding}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') toggleBinding();
            }}
          >
            <span className="accordion-title">Volume Binding</span>
            <span className="accordion-actions">
              <span className={`accordion-icon ${isBindingOpen ? 'open' : ''}`}>v</span>
            </span>
          </div>

          {isBindingOpen && (
            <div className="accordion-content">
              <div className="bundles-table-wrapper">
                <table className="bundles-table">
                  <thead>
                    <tr>
                      <th>Workspace Name</th>
                      <th>Workspace ID</th>
                      <th>Access Level</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bindings.map((binding, index) => (
                      <tr key={index}>
                        <td className="bundle-name">{binding.workspace_name}</td>
                        <td className="bundle-id">{binding.workspace_id}</td>
                        <td className="bundle-access">
                          <span className={`access-badge access-${getAccessLevelColor(binding.access_level)}`}>
                            {binding.access_level}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {objectType === 'schema' && (
        <div className="objects-accordion">
          <div
            role="button"
            tabIndex={0}
            className="accordion-header"
            onClick={() => setIsObjectsOpen(!isObjectsOpen)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                setIsObjectsOpen(!isObjectsOpen);
              }
            }}
          >
            <span className="accordion-title">Schema Objects</span>
            <span className="accordion-actions">
              <button type="button" className="export-button" onClick={handleExportSchemaObjects}>
                Export
              </button>
              <span className={`accordion-icon ${isObjectsOpen ? 'open' : ''}`}>v</span>
            </span>
          </div>

          {isObjectsOpen && (
            <div className="accordion-content">
              {loadingExtra ? (
                <div className="loading-placeholder">Loading objects...</div>
              ) : objects.length > 0 ? (
                <div className="objects-table-wrapper">
                  <table className="objects-table">
                    <thead>
                      <tr>
                        <th>Object Name</th>
                        <th>Object Type</th>
                        <th>Created Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {objects.map((obj, index) => (
                        <tr key={index}>
                          <td className="object-name">{obj.object_name}</td>
                          <td className="object-type">{obj.object_type}</td>
                          <td className="object-created">{formatDate(obj.created_date)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">{extraMessage || 'No objects found in this schema'}</div>
              )}
            </div>
          )}
        </div>
      )}

      {objectType === 'table' && (
        <div className="statistics-accordion">
          <div
            role="button"
            tabIndex={0}
            className="accordion-header"
            onClick={() => setIsStatisticsOpen(!isStatisticsOpen)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                setIsStatisticsOpen(!isStatisticsOpen);
              }
            }}
          >
            <span className="accordion-title">Table Statistics</span>
            <span className="accordion-actions">
              <button type="button" className="export-button" onClick={handleExportTableStatistics}>
                Export
              </button>
              <span className={`accordion-icon ${isStatisticsOpen ? 'open' : ''}`}>v</span>
            </span>
          </div>

          {isStatisticsOpen && (
            <div className="accordion-content">
              {loadingExtra ? (
                <div className="loading-placeholder">Loading statistics...</div>
              ) : statistics ? (
                <div className="statistics-grid">
                  <div className="stat-item">
                    <span className="stat-label">Total Rows</span>
                    <span className="stat-value">{statistics.total_rows?.toLocaleString() || 'N/A'}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Total Columns</span>
                    <span className="stat-value">{statistics.total_columns || 'N/A'}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Storage Format</span>
                    <span className="stat-value">{statistics.storage_format || 'N/A'}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Table Type</span>
                    <span className="stat-value">{statistics.table_type || 'N/A'}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Last Modified</span>
                    <span className="stat-value">{formatDate(statistics.last_modified)}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Size</span>
                    <span className="stat-value">{statistics.size_in_mb ? `${statistics.size_in_mb} MB` : 'N/A'}</span>
                  </div>
                </div>
              ) : (
                <div className="empty-state">{extraMessage || 'No statistics available'}</div>
              )}
            </div>
          )}
        </div>
      )}

      {permissionDialog && (
        <PermissionDialog
          mode={permissionDialog.mode}
          selectedObject={selectedObject}
          principal={permissionDialog.principal}
          principalType={permissionDialog.principalType}
          administrator={exportedBy}
          onClose={() => setPermissionDialog(null)}
          onSuccess={handlePermissionSuccess}
        />
      )}

      {removeTarget && (
        <div className="permission-modal-backdrop" role="presentation">
          <div className="permission-confirm-modal" role="dialog" aria-modal="true" aria-label="Remove Access">
            <div className="permission-modal-header">
              <div>
                <h3>Remove Access</h3>
                <p>
                  Remove all permissions for {String(removeTarget.principal_type || '').toLowerCase()} <strong>{removeTarget.principal}</strong>
                  {' '}from {objectType === 'catalog' ? 'Catalog' : objectType} <strong>{objectName}</strong>?
                </p>
              </div>
              <button type="button" className="relationship-close" onClick={() => setRemoveTarget(null)} aria-label="Close">x</button>
            </div>
            <div className="permission-modal-footer">
              <button type="button" className="export-button" onClick={() => setRemoveTarget(null)} disabled={removing}>
                Cancel
              </button>
              <button type="button" className="danger-button" onClick={handleRemovePermission} disabled={removing}>
                {removing ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ObjectDetailsCard;
