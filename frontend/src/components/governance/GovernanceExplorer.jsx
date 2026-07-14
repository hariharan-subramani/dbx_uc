import { useCallback, useEffect, useMemo, useState } from "react";
import GovernanceDashboard from "./GovernanceDashboard";
import UnityCatalogPanel from "./UnityCatalogPanel";
import StorageCredentialPanel from "./StorageCredentialPanel";
import ExternalLocationPanel from "./ExternalLocationPanel";
import CatalogBindingPanel from "./CatalogBindingPanel";
import AuditHistoryPanel from "./AuditHistoryPanel";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

const configs = [
  { id: "catalogs", title: "Unity Catalogs", description: "Catalogs registered in the connected Unity Catalog metastore.", endpoint: "/governance/unity-catalogs", dataKey: "catalogs", filename: "UnityCatalogs.xlsx", sheetName: "Unity Catalogs", detailTitle: "Catalog Details",
    columns: [{ key: "name", label: "Catalog Name" }, { key: "owner", label: "Owner" }, { key: "metastore_name", label: "Metastore" }, { key: "region", label: "Region" }, { key: "isolation_mode", label: "Isolation Mode" }, { key: "created_date", label: "Created Date" }, { key: "comment", label: "Comment" }],
    details: [{ key: "name", label: "Name" }, { key: "owner", label: "Owner" }, { key: "metastore_id", label: "Metastore ID" }, { key: "metastore_name", label: "Metastore Name" }, { key: "region", label: "Region" }, { key: "isolation_mode", label: "Isolation Mode" }, { key: "created_date", label: "Created Date" }, { key: "comment", label: "Comment" }] },
  { id: "credentials", title: "Storage Credentials", description: "Cloud credentials registered for governed storage access.", endpoint: "/governance/storage-credentials", dataKey: "storage_credentials", filename: "StorageCredentials.xlsx", sheetName: "Storage Credentials", detailTitle: "Storage Credential Details",
    columns: [{ key: "name", label: "Credential Name" }, { key: "credential_type", label: "Credential Type" }, { key: "cloud_provider", label: "Cloud Provider" }, { key: "owner", label: "Owner" }, { key: "read_only", label: "Read Only" }, { key: "status", label: "Status" }, { key: "created_date", label: "Created Date" }],
    details: [{ key: "name", label: "Credential Name" }, { key: "credential_type", label: "Credential Type" }, { key: "cloud_provider", label: "Cloud Provider" }, { key: "authentication_type", label: "Authentication Type" }, { key: "owner", label: "Owner" }, { key: "read_only", label: "Read Only" }, { key: "comment", label: "Comment" }, { key: "created_date", label: "Created Date" }] },
  { id: "locations", title: "External Locations", description: "Governed cloud storage paths and their associated credentials.", endpoint: "/governance/external-locations", dataKey: "external_locations", filename: "ExternalLocations.xlsx", sheetName: "External Locations", detailTitle: "External Location Details",
    columns: [{ key: "name", label: "Location Name" }, { key: "url", label: "URL" }, { key: "credential_name", label: "Storage Credential" }, { key: "owner", label: "Owner" }, { key: "read_only", label: "Read Only" }, { key: "status", label: "Status" }],
    details: [{ key: "name", label: "Location" }, { key: "url", label: "URL" }, { key: "credential_name", label: "Storage Credential" }, { key: "cloud_provider", label: "Cloud Provider" }, { key: "owner", label: "Owner" }, { key: "read_only", label: "Read Only" }, { key: "created_date", label: "Created Date" }] },
  { id: "bindings", title: "Catalog Bindings", description: "Workspace access boundaries configured for each catalog.", endpoint: "/governance/catalog-bindings", dataKey: "catalog_bindings", filename: "CatalogBindings.xlsx", sheetName: "Catalog Bindings", detailTitle: "Catalog Binding Details",
    columns: [{ key: "catalog", label: "Catalog" }, { key: "workspace_name", label: "Workspace Name" }, { key: "workspace_id", label: "Workspace ID" }, { key: "access_level", label: "Access Level" }, { key: "status", label: "Status" }],
    details: [{ key: "catalog", label: "Catalog" }, { key: "workspace_name", label: "Workspace Name" }, { key: "workspace_id", label: "Workspace ID" }, { key: "access_level", label: "Access Level" }, { key: "status", label: "Status" }] },
  { id: "audit", title: "Audit History", description: "Governance activity history, ready for a future audit source integration.", endpoint: "/governance/audit-history", dataKey: "audit_records", filename: "AuditHistory.xlsx", sheetName: "Audit History", detailTitle: "Audit Record Details", emptyMessage: "No audit history available.",
    columns: [{ key: "timestamp", label: "Timestamp" }, { key: "user", label: "User" }, { key: "action", label: "Action" }, { key: "object_type", label: "Object Type" }, { key: "object_name", label: "Object Name" }, { key: "result", label: "Result" }],
    details: [{ key: "timestamp", label: "Timestamp" }, { key: "user", label: "User" }, { key: "action", label: "Action" }, { key: "object_type", label: "Object Type" }, { key: "object_name", label: "Object Name" }, { key: "result", label: "Result" }] },
];

const emptyState = () => Object.fromEntries(configs.map(({ id }) => [id, { data: [], count: 0, loading: false, loaded: false, error: "", warning: "" }]));
const panels = { catalogs: UnityCatalogPanel, credentials: StorageCredentialPanel, locations: ExternalLocationPanel, bindings: CatalogBindingPanel, audit: AuditHistoryPanel };

const GovernanceExplorer = () => {
  const [resources, setResources] = useState(emptyState);
  const [activeSection, setActiveSection] = useState("catalogs");
  const [summary, setSummary] = useState({ counts: {}, loading: true, warnings: {} });

  const load = useCallback(async (config) => {
    setResources((current) => ({ ...current, [config.id]: { ...current[config.id], loading: true, error: "" } }));
    try {
      const response = await fetch(`${API_BASE}${config.endpoint}`);
      const payload = await response.json();
      if (!response.ok || payload.success === false) throw new Error(payload.message || "Unable to load governance data.");
      const data = payload[config.dataKey] || [];
      setResources((current) => ({ ...current, [config.id]: { data, count: payload.count ?? data.length, loading: false, loaded: true, error: "", warning: payload.warning || payload.message || "" } }));
    } catch (error) {
      setResources((current) => ({ ...current, [config.id]: { ...current[config.id], loading: false, loaded: true, error: error.message || "This Databricks workspace does not expose this governance resource." } }));
    }
  }, []);

  const loadSummary = useCallback(async () => {
    setSummary((current) => ({ ...current, loading: true }));
    try {
      const response = await fetch(`${API_BASE}/governance/summary`);
      const payload = await response.json();
      if (!response.ok || payload.success === false) throw new Error(payload.message || "Unable to load governance summary.");
      setSummary({ counts: payload.counts || {}, warnings: payload.warnings || {}, loading: false });
    } catch (error) {
      setSummary({ counts: {}, warnings: { summary: error.message }, loading: false });
    }
  }, []);

  useEffect(() => { loadSummary(); load(configs[0]); }, [load, loadSummary]);

  const cards = useMemo(() => [
    { id: "catalogs", label: "Unity Catalogs", count: summary.counts.unity_catalogs ?? 0, loading: summary.loading },
    { id: "credentials", label: "Storage Credentials", count: summary.counts.storage_credentials ?? 0, loading: summary.loading },
    { id: "locations", label: "External Locations", count: summary.counts.external_locations ?? 0, loading: summary.loading },
    { id: "bindings", label: "Catalog Bindings", count: summary.counts.catalog_bindings ?? 0, loading: summary.loading },
    { id: "managed", label: "Managed Catalogs", count: summary.counts.managed_catalogs ?? 0, loading: summary.loading, note: "Derived from live catalogs" },
  ], [summary]);

  const selectCard = (id) => {
    const target = id === "managed" ? "catalogs" : id;
    setActiveSection(target);
    const config = configs.find((item) => item.id === target);
    if (config && !resources[target].loaded && !resources[target].loading) load(config);
    document.getElementById(`governance-${target}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="governance-explorer">
      <div className="page-heading"><div><h1>Governance Explorer</h1><p>Live Unity Catalog governance resources for the connected Databricks workspace.</p></div></div>
      <GovernanceDashboard cards={cards} activeSection={activeSection} onSelect={selectCard} />
      <nav className="governance-section-nav" aria-label="Governance sections">
        {configs.map((config) => <button className={activeSection === config.id ? "active" : ""} key={config.id} onClick={() => selectCard(config.id)} type="button">{config.title}</button>)}
      </nav>
      <div className="governance-sections">
        {configs.map((config) => {
          const Panel = panels[config.id];
          return <Panel config={config} state={resources[config.id]} onRefresh={() => load(config)} key={config.id} />;
        })}
      </div>
    </div>
  );
};

export default GovernanceExplorer;
