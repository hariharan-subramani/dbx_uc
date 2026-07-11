import Icon from './Icon';

function TableSelector({ tables, selectedTable, onSelectTable, loading, disabled }) {
  return (
    <div className="selector-section">
      <label className="selector-label">
        <Icon name="table" size={16} />
        Table
      </label>
      <div className="selector-dropdown">
        <select
          value={selectedTable}
          onChange={(e) => onSelectTable(e.target.value)}
          disabled={loading || disabled || tables.length === 0}
          className="selector-select"
        >
          <option value="">Select table</option>
          {tables.map((table) => (
            <option key={table.name} value={table.name}>
              {table.name}
            </option>
          ))}
        </select>
        <Icon name="chevron" size={16} className="selector-chevron" />
      </div>
    </div>
  );
}

export default TableSelector;