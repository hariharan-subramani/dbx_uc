import Icon from './Icon';

function SchemaSelector({ schemas, selectedSchema, onSelectSchema, loading, disabled }) {
  return (
    <div className="selector-section">
      <label className="selector-label">
        <Icon name="schema" size={16} />
        Schema
      </label>
      <div className="selector-dropdown">
        <select
          value={selectedSchema}
          onChange={(e) => onSelectSchema(e.target.value)}
          disabled={loading || disabled || schemas.length === 0}
          className="selector-select"
        >
          <option value="">Select schema</option>
          {schemas.map((schema) => (
            <option key={schema.name} value={schema.name}>
              {schema.name}
            </option>
          ))}
        </select>
        <Icon name="chevron" size={16} className="selector-chevron" />
      </div>
    </div>
  );
}

export default SchemaSelector;