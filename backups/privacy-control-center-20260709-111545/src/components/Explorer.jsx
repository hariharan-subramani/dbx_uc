import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import WorkspaceSelector from './WorkspaceSelector';
import CatalogSelector from './CatalogSelector';
import SchemaSelector from './SchemaSelector';
import TableSelector from './TableSelector';
import DetailsPanel from './DetailsPanel';

/* eslint-disable react-hooks/exhaustive-deps, react-hooks/immutability, react-hooks/set-state-in-effect */
const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000';

const unavailable = (message) => message || 'Unavailable';

const formatDate = (value) => {
  if (!value) return 'Unavailable';
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

const fetchJson = async (path) => {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
  return response.json();
};

function Explorer({ user }) {
  const { workspace, catalog, schema, table } = useParams();
  const navigate = useNavigate();
  const isNavigatingFromURL = useRef(false);

  const [workspaces, setWorkspaces] = useState([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState(workspace || '');
  const [catalogs, setCatalogs] = useState([]);
  const [selectedCatalog, setSelectedCatalog] = useState(catalog || '');
  const [schemas, setSchemas] = useState([]);
  const [selectedSchema, setSelectedSchema] = useState(schema || '');
  const [tables, setTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState(table || '');
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [loadingCatalogs, setLoadingCatalogs] = useState(false);
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [error, setError] = useState('');

  const [selectedObject, setSelectedObject] = useState(null);
  const [objectDetails, setObjectDetails] = useState(null);
  const [permissions, setPermissions] = useState(null);
  const [permissionsMessage, setPermissionsMessage] = useState('');
  const [loadingPermissions, setLoadingPermissions] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const selectedWorkspaceLabel = () => (
    workspaces.find((item) => item.value === selectedWorkspace)?.label || selectedWorkspace
  );

  useEffect(() => {
    let isActive = true;
    setLoadingWorkspace(true);

    fetchJson('/workspace')
      .then((data) => {
        if (!isActive) return;
        const nextWorkspaces = (data.workspaces || []).map((item) => ({
          label: item.display_name || item.name || 'Databricks Workspace',
          value: item.host || item.workspace_id || item.name,
          host: item.host,
          workspaceId: item.workspace_id,
        })).filter((item) => item.value);
        setWorkspaces(nextWorkspaces);
        if (!selectedWorkspace && nextWorkspaces.length === 1) {
          setSelectedWorkspace(nextWorkspaces[0].value);
          navigate(`/workspace/${encodeURIComponent(nextWorkspaces[0].value)}`);
        }
      })
      .catch((err) => {
        if (!isActive) return;
        setError('Workspace information is unavailable.');
        console.error('Error loading workspace:', err);
      })
      .finally(() => {
        if (isActive) setLoadingWorkspace(false);
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (isNavigatingFromURL.current) {
      isNavigatingFromURL.current = false;
      return;
    }

    setSelectedWorkspace(workspace || '');
    setSelectedCatalog(catalog || '');
    setSelectedSchema(schema || '');
    setSelectedTable(table || '');
  }, [workspace, catalog, schema, table]);

  useEffect(() => {
    if (selectedWorkspace) {
      loadCatalogs();
    }
  }, [selectedWorkspace]);

  useEffect(() => {
    if (selectedCatalog) {
      loadCatalogSelection(selectedCatalog);
    }
  }, [selectedCatalog]);

  useEffect(() => {
    if (selectedCatalog && selectedSchema) {
      loadSchemaSelection(selectedCatalog, selectedSchema);
    }
  }, [selectedCatalog, selectedSchema]);

  useEffect(() => {
    if (selectedCatalog && selectedSchema && selectedTable) {
      loadTableSelection(selectedCatalog, selectedSchema, selectedTable);
    }
  }, [selectedCatalog, selectedSchema, selectedTable]);

  async function loadCatalogs() {
    setLoadingCatalogs(true);
    setError('');
    try {
      const data = await fetchJson('/catalogs');
      setCatalogs(data.catalogs || []);
    } catch (err) {
      setError('Catalogs are unavailable right now.');
      setCatalogs([]);
      console.error('Error loading catalogs:', err);
    } finally {
      setLoadingCatalogs(false);
    }
  }

  async function loadCatalogSelection(catalogName) {
    setLoadingSchemas(true);
    setLoadingDetails(true);
    setSelectedObject({ type: 'catalog', name: catalogName, workspaceName: selectedWorkspaceLabel() });
    setObjectDetails(null);
    setPermissions(null);
    setPermissionsMessage('');
    setLoadingPermissions(true);
    setSchemas([]);
    setTables([]);

    try {
      const [metadataData, schemasData] = await Promise.all([
        fetchJson(`/catalogs/${encodeURIComponent(catalogName)}/metadata`).catch((err) => ({ success: false, error: err.message })),
        fetchJson(`/catalogs/${encodeURIComponent(catalogName)}/schemas`).catch((err) => ({ success: false, error: err.message, schemas: [] })),
      ]);

      const nextSchemas = schemasData.schemas || [];
      setSchemas(nextSchemas);
      if (!schemasData.success) setError('Schemas are unavailable for this catalog.');

      const meta = metadataData.success ? metadataData.metadata || {} : {};
      setObjectDetails([
        { label: 'Name', value: meta.name || catalogName },
        { label: 'Owner', value: unavailable(meta.owner) },
        { label: 'Created Date', value: formatDate(meta.created_at) },
        { label: 'Comment', value: meta.comment || 'Metadata comment is unavailable.' },
        { label: 'Schema Count', value: String(nextSchemas.length) },
      ]);

      fetchJson(`/catalogs/${encodeURIComponent(catalogName)}/permissions`)
        .then((permissionsData) => {
          setPermissions(permissionsData.success ? permissionsData.permissions || [] : []);
          setPermissionsMessage(permissionsData.success ? '' : permissionsData.message || 'Unable to load permissions.');
        })
        .catch((err) => {
          setPermissions([]);
          setPermissionsMessage('Unable to load permissions.');
          console.error('Error loading catalog permissions:', err);
        })
        .finally(() => setLoadingPermissions(false));
    } catch (err) {
      setError('Catalog metadata is unavailable right now.');
      setLoadingPermissions(false);
      console.error('Error loading catalog details:', err);
    } finally {
      setLoadingSchemas(false);
      setLoadingDetails(false);
    }
  }

  async function loadSchemaSelection(catalogName, schemaName) {
    setLoadingTables(true);
    setLoadingDetails(true);
    setSelectedObject({ type: 'schema', name: schemaName, catalogName, workspaceName: selectedWorkspaceLabel() });
    setObjectDetails(null);
    setPermissions(null);
    setPermissionsMessage('');
    setLoadingPermissions(true);
    setTables([]);

    try {
      const [metadataData, tablesData] = await Promise.all([
        fetchJson(`/catalogs/${encodeURIComponent(catalogName)}/schemas/${encodeURIComponent(schemaName)}/metadata`).catch((err) => ({ success: false, error: err.message })),
        fetchJson(`/catalogs/${encodeURIComponent(catalogName)}/schemas/${encodeURIComponent(schemaName)}/tables`).catch((err) => ({ success: false, error: err.message, tables: [] })),
      ]);

      const nextTables = tablesData.tables || [];
      setTables(nextTables);
      if (!tablesData.success) setError('Tables are unavailable for this schema.');

      const meta = metadataData.success ? metadataData.metadata || {} : {};
      setObjectDetails([
        { label: 'Name', value: meta.name || schemaName },
        { label: 'Owner', value: unavailable(meta.owner) },
        { label: 'Catalog', value: meta.catalog_name || catalogName },
        { label: 'Table Count', value: String(nextTables.length) },
        { label: 'Comment', value: meta.comment || 'Metadata comment is unavailable.' },
        { label: 'Created Date', value: formatDate(meta.created_at) },
      ]);

      fetchJson(`/schemas/${encodeURIComponent(catalogName)}/${encodeURIComponent(schemaName)}/permissions`)
        .then((permissionsData) => {
          setPermissions(permissionsData.success ? permissionsData.permissions || [] : []);
          setPermissionsMessage(permissionsData.success ? '' : permissionsData.message || 'Unable to load permissions.');
        })
        .catch((err) => {
          setPermissions([]);
          setPermissionsMessage('Unable to load permissions.');
          console.error('Error loading schema permissions:', err);
        })
        .finally(() => setLoadingPermissions(false));
    } catch (err) {
      setError('Schema metadata is unavailable right now.');
      setLoadingPermissions(false);
      console.error('Error loading schema details:', err);
    } finally {
      setLoadingTables(false);
      setLoadingDetails(false);
    }
  }

  async function loadTableSelection(catalogName, schemaName, tableName) {
    setLoadingDetails(true);
    setSelectedObject({ type: 'table', name: tableName, catalogName, schemaName, workspaceName: selectedWorkspaceLabel() });
    setObjectDetails(null);
    setPermissions(null);
    setPermissionsMessage('');
    setLoadingPermissions(true);

    try {
      const metadataData = await fetchJson(
        `/catalogs/${encodeURIComponent(catalogName)}/schemas/${encodeURIComponent(schemaName)}/tables/${encodeURIComponent(tableName)}/metadata`
      ).catch((err) => ({ success: false, error: err.message }));

      const meta = metadataData.success ? metadataData.metadata || {} : {};
      const columnCount = Array.isArray(meta.columns) ? meta.columns.length : null;

      setObjectDetails([
        { label: 'Name', value: meta.name || tableName },
        { label: 'Owner', value: unavailable(meta.owner) },
        { label: 'Schema', value: meta.schema_name || schemaName },
        { label: 'Catalog', value: meta.catalog_name || catalogName },
        { label: 'Columns Count', value: columnCount === null ? 'Unavailable' : String(columnCount) },
        { label: 'Storage', value: meta.data_source_format || meta.storage_location || 'Unavailable' },
        { label: 'Created Date', value: formatDate(meta.created_at) },
        { label: 'Comment', value: meta.comment || 'Metadata comment is unavailable.' },
      ]);

      fetchJson(`/tables/${encodeURIComponent(catalogName)}/${encodeURIComponent(schemaName)}/${encodeURIComponent(tableName)}/permissions`)
        .then((permissionsData) => {
          setPermissions(permissionsData.success ? permissionsData.permissions || [] : []);
          setPermissionsMessage(permissionsData.success ? '' : permissionsData.message || 'Unable to load permissions.');
        })
        .catch((err) => {
          setPermissions([]);
          setPermissionsMessage('Unable to load permissions.');
          console.error('Error loading table permissions:', err);
        })
        .finally(() => setLoadingPermissions(false));
    } catch (err) {
      setError('Table metadata is unavailable right now.');
      setLoadingPermissions(false);
      console.error('Error loading table details:', err);
    } finally {
      setLoadingDetails(false);
    }
  }

  const handleSelectWorkspace = (workspaceName) => {
    isNavigatingFromURL.current = true;
    setSelectedWorkspace(workspaceName);
    setSelectedCatalog('');
    setSelectedSchema('');
    setSelectedTable('');
    setCatalogs([]);
    setSchemas([]);
    setTables([]);
    setSelectedObject(null);
    setObjectDetails(null);
    setPermissions(null);
    setPermissionsMessage('');
    setLoadingPermissions(false);

    navigate(workspaceName ? `/workspace/${encodeURIComponent(workspaceName)}` : '/');
  };

  const handleSelectCatalog = (catalogName) => {
    isNavigatingFromURL.current = true;
    setSelectedCatalog(catalogName);
    setSelectedSchema('');
    setSelectedTable('');
    setSchemas([]);
    setTables([]);

    if (catalogName && selectedWorkspace) {
      navigate(`/workspace/${encodeURIComponent(selectedWorkspace)}/catalog/${encodeURIComponent(catalogName)}`);
    }
  };

  const handleSelectSchema = (schemaName) => {
    isNavigatingFromURL.current = true;
    setSelectedSchema(schemaName);
    setSelectedTable('');
    setTables([]);

    if (schemaName && selectedWorkspace && selectedCatalog) {
      navigate(`/workspace/${encodeURIComponent(selectedWorkspace)}/catalog/${encodeURIComponent(selectedCatalog)}/schema/${encodeURIComponent(schemaName)}`);
    }
  };

  const handleSelectTable = (tableName) => {
    isNavigatingFromURL.current = true;
    setSelectedTable(tableName);

    if (tableName && selectedWorkspace && selectedCatalog && selectedSchema) {
      navigate(`/workspace/${encodeURIComponent(selectedWorkspace)}/catalog/${encodeURIComponent(selectedCatalog)}/schema/${encodeURIComponent(selectedSchema)}/table/${encodeURIComponent(tableName)}`);
    }
  };

  const refreshSelectedObject = async () => {
    if (selectedTable && selectedCatalog && selectedSchema) {
      await loadTableSelection(selectedCatalog, selectedSchema, selectedTable);
      return;
    }
    if (selectedSchema && selectedCatalog) {
      await loadSchemaSelection(selectedCatalog, selectedSchema);
      return;
    }
    if (selectedCatalog) {
      await loadCatalogSelection(selectedCatalog);
    }
  };

  return (
    <div className="explorer">
      {error && (
        <div className="alert" role="alert">
          <span>!</span>
          {error}
        </div>
      )}

      <div className="explorer-layout">
        <div className="explorer-left">
          <div className="selectors-container">
            <WorkspaceSelector
              workspaces={workspaces}
              selectedWorkspace={selectedWorkspace}
              onSelectWorkspace={handleSelectWorkspace}
              loading={loadingWorkspace}
            />
            <CatalogSelector
              catalogs={catalogs}
              selectedCatalog={selectedCatalog}
              onSelectCatalog={handleSelectCatalog}
              loading={loadingCatalogs}
              disabled={!selectedWorkspace}
            />
            <SchemaSelector
              schemas={schemas}
              selectedSchema={selectedSchema}
              onSelectSchema={handleSelectSchema}
              loading={loadingSchemas}
              disabled={!selectedCatalog}
            />
            <TableSelector
              tables={tables}
              selectedTable={selectedTable}
              onSelectTable={handleSelectTable}
              loading={loadingTables}
              disabled={!selectedSchema}
            />
          </div>
        </div>

        <div className="explorer-right">
          <DetailsPanel
            selectedObject={selectedObject}
            objectDetails={objectDetails}
            permissions={permissions}
            permissionsMessage={permissionsMessage}
            loadingPermissions={loadingPermissions}
            loadingDetails={loadingDetails}
            exportedBy={user}
            onRefreshObject={refreshSelectedObject}
          />
        </div>
      </div>
    </div>
  );
}

export default Explorer;
