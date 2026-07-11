import { useState } from 'react';
import Icon from './Icon';

function SchemaPanel({ schemas, selectedSchema, onSelectSchema, loading, error, onRetry }) {
  const [showDropdown, setShowDropdown] = useState(false);

  return (
    <div className="explorer-panel schema-panel">
      <div 
        className="panel-header" 
        onClick={() => selectedSchema && setShowDropdown(!showDropdown)}
        style={selectedSchema ? { cursor: 'pointer' } : {}}
      >
        <div className="panel-title">
          <Icon name="schema" size={18} />
          <h3>Schemas</h3>
          {selectedSchema && (
            <span className="selected-indicator">
              <Icon name="chevron" size={14} className={showDropdown ? 'rotate' : ''} />
            </span>
          )}
        </div>
      </div>
      
      {showDropdown && selectedSchema && (
        <div className="schema-dropdown-container">
          <select
            value={selectedSchema}
            onChange={(e) => {
              onSelectSchema(e.target.value);
              setShowDropdown(false);
            }}
            className="dropdown-select"
            autoFocus
          >
            {schemas.map((schema) => (
              <option key={schema.name} value={schema.name}>
                {schema.name}
              </option>
            ))}
          </select>
        </div>
      )}

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
        ) : schemas.length === 0 && !selectedSchema ? (
          <div className="panel-empty">
            <Icon name="schema" size={24} />
            <p>Select a catalog</p>
            <span>Choose a catalog to view schemas</span>
          </div>
        ) : schemas.length === 0 ? (
          <div className="panel-empty">
            <Icon name="schema" size={24} />
            <p>No schemas found</p>
            <span>This catalog has no schemas</span>
          </div>
        ) : !selectedSchema ? (
          <div className="panel-list">
            {schemas.map((schema) => (
              <button
                key={schema.name}
                className="panel-list-item"
                onClick={() => onSelectSchema(schema.name)}
              >
                <Icon name="schema" size={16} />
                <div className="item-details">
                  <span className="item-name">{schema.name}</span>
                  {schema.comment && <span className="item-description">{schema.comment}</span>}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="panel-list">
            <div className="panel-list-item selected">
              <Icon name="schema" size={16} />
              <div className="item-details">
                <span className="item-name">{selectedSchema}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SchemaPanel;