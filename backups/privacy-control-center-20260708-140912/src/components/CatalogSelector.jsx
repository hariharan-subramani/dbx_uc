import Icon from './Icon';

function CatalogSelector({ catalogs, selectedCatalog, onSelectCatalog, loading, disabled }) {
  return (
    <div className="selector-section">
      <label className="selector-label">
        <Icon name="catalog" size={16} />
        Catalog
      </label>
      <div className="selector-dropdown">
        <select
          value={selectedCatalog}
          onChange={(e) => onSelectCatalog(e.target.value)}
          disabled={loading || disabled || catalogs.length === 0}
          className="selector-select"
        >
          <option value="">Select catalog</option>
          {catalogs.map((catalog) => (
            <option key={catalog} value={catalog}>
              {catalog}
            </option>
          ))}
        </select>
        <Icon name="chevron" size={16} className="selector-chevron" />
      </div>
    </div>
  );
}

export default CatalogSelector;