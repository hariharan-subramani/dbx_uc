import { useMemo, useState } from "react";
import { exportGovernanceRows } from "../../utils/excelExport";

const display = (value) => {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value === null || value === undefined || value === "" ? "—" : String(value);
};

const GovernanceResourcePanel = ({ config, state, onRefresh }) => {
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  const rows = useMemo(() => state.data || [], [state.data]);
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return rows;
    return rows.filter((row) => Object.values(row).some((cell) => String(cell ?? "").toLowerCase().includes(value)));
  }, [query, rows]);

  const exportRows = () => exportGovernanceRows({
    rows,
    columns: config.columns,
    sheetName: config.sheetName,
    filename: config.filename,
    emptyMessage: config.emptyMessage,
  });

  return (
    <section className="governance-panel" id={`governance-${config.id}`}>
      <div className="governance-panel-header">
        <div><h2>{config.title}</h2><p>{config.description}</p></div>
        <div className="governance-actions">
          <button className="secondary-button" onClick={onRefresh} disabled={state.loading} type="button">
            {state.loading ? "Refreshing…" : "Refresh"}
          </button>
          <button className="secondary-button" onClick={exportRows} type="button">Export</button>
          <button className="primary-button" onClick={() => selected && setSelected(selected)} disabled={!selected} type="button">View Details</button>
        </div>
      </div>
      <label className="governance-search">
        <span>Search</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${config.title.toLowerCase()}`} />
      </label>
      {state.error && <div className="governance-inline-error" role="alert">{state.error}</div>}
      {state.warning && <div className="governance-inline-warning">{state.warning}</div>}
      <div className="governance-table-wrap">
        <table className="governance-table">
          <thead><tr>{config.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
          <tbody>
            {!state.loading && filtered.map((row, index) => (
              <tr
                className={selected === row ? "selected" : ""}
                key={`${row.name || row.catalog || index}-${index}`}
                onClick={() => setSelected(row)}
                onDoubleClick={() => setSelected(row)}
                tabIndex="0"
                onKeyDown={(event) => event.key === "Enter" && setSelected(row)}
              >
                {config.columns.map((column) => <td key={column.key}>{display(row[column.key])}</td>)}
              </tr>
            ))}
            {state.loading && <tr><td colSpan={config.columns.length} className="governance-empty">Loading live Databricks data…</td></tr>}
            {!state.loading && filtered.length === 0 && <tr><td colSpan={config.columns.length} className="governance-empty">{config.emptyMessage || "No records available."}</td></tr>}
          </tbody>
        </table>
      </div>
      {selected && (
        <aside className="governance-details" aria-label={`${config.title} details`}>
          <div className="governance-details-title"><h3>{config.detailTitle}</h3><button onClick={() => setSelected(null)} aria-label="Close details" type="button">×</button></div>
          <dl>{config.details.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{display(selected[field.key])}</dd></div>)}</dl>
        </aside>
      )}
    </section>
  );
};

export default GovernanceResourcePanel;
