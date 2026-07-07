import Icon from './Icon';

function TablePanel({ tables, selectedTable, onSelectTable, loading, error, onRetry, selectedSchema }) {
  return (
    <div className="explorer-panel table-panel">
      <div className="panel-header">
        <div className="panel-title">
          <Icon name="table" size={18} />
          <h3>Tables</h3>
        </div>
      </div>
      <div className="panel-content">
        {error ? (
          <div className="panel-error">
            <p>{error}</p>
            {onRetry && (
              <button className="retry-button" onClick={onRetry}>
                <Icon name="refresh" size={14} />
                Try again
              </button>
            )}
          </div>
        ) : loading ? (
          <div className="panel-loading">
            {[1, 2, 3].map((item) => (
              <div className="skeleton-item" key={item} />
            ))}
          </div>
        ) : tables.length === 0 && !selectedSchema ? (
          <div className="panel-empty">
            <Icon name="table" size={24} />
            <p>Select a schema</p>
            <span>Choose a schema to view tables</span>
          </div>
        ) : tables.length === 0 ? (
          <div className="panel-empty">
            <Icon name="table" size={24} />
            <p>No tables found</p>
            <span>This schema has no tables</span>
          </div>
        ) : (
          <div className="panel-list">
            {tables.map((table) => (
              <button
                key={table.name}
                className={`panel-list-item ${selectedTable === table.name ? 'selected' : ''}`}
                onClick={() => onSelectTable(table.name)}
              >
                <Icon name="table" size={16} />
                <div className="item-details">
                  <span className="item-name">{table.name}</span>
                  {table.comment && <span className="item-description">{table.comment}</span>}
                </div>
                {table.table_type && (
                  <span className="item-badge">{table.table_type.replaceAll('_', ' ')}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default TablePanel;