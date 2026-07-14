import { useEffect, useState } from 'react';
import { exportGovernanceRows } from '../utils/excelExport';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000';
const labelize = (key) => key.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
const show = (value) => value === null || value === undefined || value === '' ? 'Unavailable' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);

const definitions = {
  catalog: [
    { id: 'unity-catalog', title: 'Unity Catalog Information', dataKey: 'information' },
    { id: 'storage-credentials', title: 'Storage Credential', dataKey: 'credentials', empty: 'No Storage Credential is associated with this catalog.' },
    { id: 'external-locations', title: 'External Locations', dataKey: 'external_locations', empty: 'No External Location is associated with this catalog.' },
    { id: 'attached-workspaces', title: 'Attached Workspaces', dataKey: 'workspaces', empty: 'No Attached Workspaces' },
    { id: 'audit', title: 'Audit History', placeholder: 'Future enhancement. This section will include permission grants, permission revokes, ownership changes, catalog binding changes, exports, and user activity.' },
  ],
  schema: [
    { id: 'storage', title: 'Storage Information', dataKey: 'information' },
    { id: 'parent-catalog', title: 'Parent Catalog', dataKey: 'information' },
    { id: 'external-locations', title: 'External Locations', dataKey: 'external_locations', empty: 'No External Locations' },
    { id: 'audit', title: 'Audit History', placeholder: 'Future enhancement.' },
  ],
  table: [
    { id: 'storage', title: 'Storage Information', dataKey: 'information' },
    { id: 'external-locations', title: 'External Locations', dataKey: 'external_locations', empty: 'No External Location is associated with this table.' },
    { id: 'columns', title: 'Columns', dataKey: 'columns', empty: 'No Columns Available' },
    { id: 'lineage', title: 'Lineage', placeholder: 'Future enhancement.' },
    { id: 'audit', title: 'Audit History', placeholder: 'Future enhancement.' },
  ],
  volume: [
    { id: 'storage', title: 'Storage Information', dataKey: 'information' },
    { id: 'external-locations', title: 'External Locations', dataKey: 'external_locations', empty: 'No External Location is associated with this volume.' },
    { id: 'attached-workspaces', title: 'Attached Workspace', dataKey: 'workspaces', empty: 'No Attached Workspaces' },
    { id: 'audit', title: 'Audit History', placeholder: 'Future enhancement.' },
  ],
};

const pathFor = (selectedObject) => {
  const catalog = selectedObject.type === 'catalog' ? selectedObject.name : selectedObject.catalogName;
  let path = `/data-governance/catalogs/${encodeURIComponent(catalog)}`;
  if (selectedObject.type !== 'catalog') path += `/schemas/${encodeURIComponent(selectedObject.type === 'schema' ? selectedObject.name : selectedObject.schemaName)}`;
  if (selectedObject.type === 'table') path += `/tables/${encodeURIComponent(selectedObject.name)}`;
  if (selectedObject.type === 'volume') path += `/volumes/${encodeURIComponent(selectedObject.name)}`;
  return path;
};

const rowsFrom = (value) => Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];

function DataGovernanceAccordions({ selectedObject }) {
  const sections = definitions[selectedObject?.type] || [];
  const [active, setActive] = useState('');
  const [states, setStates] = useState({});

  useEffect(() => {
    const closeForOtherAccordion = (event) => {
      if (!String(event.detail || '').startsWith('governance:')) setActive('');
    };
    window.addEventListener('data-explorer-accordion-open', closeForOtherAccordion);
    return () => window.removeEventListener('data-explorer-accordion-open', closeForOtherAccordion);
  }, []);

  const open = async (section) => {
    const next = active === section.id ? '' : section.id;
    setActive(next);
    if (next) window.dispatchEvent(new CustomEvent('data-explorer-accordion-open', { detail: `governance:${section.id}` }));
    if (!next || section.placeholder || states[section.id]?.loaded) return;
    setStates((current) => ({ ...current, [section.id]: { loading: true, rows: [], error: '' } }));
    try {
      const response = await fetch(`${API_BASE}${pathFor(selectedObject)}?section=${encodeURIComponent(section.id)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'Unable to load governance information.');
      const unavailable = payload.section_available === false || (payload.errors || []).length > 0;
      setStates((current) => ({ ...current, [section.id]: { loading: false, loaded: true, rows: rowsFrom(payload[section.dataKey]), unavailable, error: '' } }));
    } catch {
      setStates((current) => ({ ...current, [section.id]: { loading: false, loaded: true, rows: [], error: 'Unable to load governance information.' } }));
    }
  };

  const exportSection = (event, section) => {
    event.stopPropagation();
    const rows = states[section.id]?.rows || [];
    const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    exportGovernanceRows({ rows, columns: keys.map((key) => ({ key, label: labelize(key) })), sheetName: section.title.slice(0, 31), filename: `${section.title.replaceAll(' ', '')}_${selectedObject.name}.xlsx`, emptyMessage: section.empty });
  };

  return <>{sections.map((section) => {
    const state = states[section.id] || {};
    const keys = [...new Set((state.rows || []).flatMap((row) => Object.keys(row)))];
    return (
      <div className="governance-object-accordion" key={section.id}>
        <div className="accordion-header" role="button" tabIndex={0} onClick={() => open(section)} onKeyDown={(event) => ['Enter', ' '].includes(event.key) && open(section)}>
          <span className="accordion-title">{section.title}</span>
          <span className="accordion-actions">
            {!section.placeholder && <button className="export-button" type="button" onClick={(event) => exportSection(event, section)}>Export</button>}
            <span className={`accordion-icon ${active === section.id ? 'open' : ''}`}>v</span>
          </span>
        </div>
        <div className={`governance-accordion-body ${active === section.id ? 'open' : ''}`}>
          <div className="accordion-content">
            {section.placeholder ? <div className="governance-placeholder"><strong>{section.title}</strong><p>{section.placeholder}</p></div>
              : state.loading ? <div className="loading-placeholder">Loading governance information...</div>
              : state.error ? <div className="empty-state">Unavailable</div>
              : state.unavailable ? <div className="empty-state">Unavailable</div>
              : (state.rows || []).length === 0 ? <div className="empty-state">{section.empty || 'No governance information available'}</div>
              : state.rows.length === 1 ? <div className="governance-info-grid">{keys.map((key) => <div key={key}><span>{labelize(key)}</span><strong>{show(state.rows[0][key])}</strong></div>)}</div>
              : <div className="objects-table-wrapper"><table className="objects-table"><thead><tr>{keys.map((key) => <th key={key}>{labelize(key)}</th>)}</tr></thead><tbody>{state.rows.map((row, index) => <tr key={index}>{keys.map((key) => <td key={key}>{show(row[key])}</td>)}</tr>)}</tbody></table></div>}
          </div>
        </div>
      </div>
    );
  })}</>;
}

export default DataGovernanceAccordions;
