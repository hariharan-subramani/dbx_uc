import { useState, useEffect } from 'react';
import PermissionSearch from './PermissionSearch';
import PermissionTable from './PermissionTable';
import {
  exportCatalog,
  exportCatalogBinding,
  exportPermissions,
  exportSchema,
  exportSchemaObjects,
  exportTable,
  exportTableStatistics,
} from '../utils/excelExport';

/* eslint-disable react-hooks/set-state-in-effect */
const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000';

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
  const objectType = selectedObject?.type;
  const objectName = selectedObject?.name;

  useEffect(() => {
    setUserSearch('');
    setGroupSearch('');
  }, [objectType, objectName]);

  const getTitle = () => {
    if (objectType === 'catalog') return 'Catalog Details';
    if (objectType === 'schema') return 'Schema Details';
    if (objectType === 'table') return 'Table Details';
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
  }, [objectType, objectName]);

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
  }, [objectType, objectName, selectedObject?.catalogName, objectDetails]);

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
  }, [objectType, objectName, selectedObject?.catalogName, selectedObject?.schemaName, objectDetails]);

  if (!selectedObject) return null;

  return (
    <div className="object-details-card">
      <div className="object-details-header">
        <h2>{getTitle()}</h2>
        <div className="details-header-actions">
          {['catalog', 'schema', 'table'].includes(objectType) && (
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
              {['catalog', 'schema', 'table'].includes(objectType) && (
                <button type="button" className="export-button" onClick={handleExportPermissions}>
                  Export
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
                />
              )}
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
    </div>
  );
}

export default ObjectDetailsCard;
