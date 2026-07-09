import Icon from './Icon';

function CatalogDropdown({ catalogs, selectedCatalog, onSelectCatalog, loading }) {
  return (
    <div className="catalog-dropdown-wrapper">
      <label htmlFor="catalog-select" className="dropdown-label">Select Catalog</label>
      <div className="catalog-dropdown">
        <select
          id="catalog-select"
          value={selectedCatalog}
          onChange={(e) => onSelectCatalog(e.target.value)}
          disabled={loading || catalogs.length === 0}
          className="dropdown-select"
        >
          <option value="">-- Select a catalog --</option>
          {catalogs.map((catalog) => (
            <option key={catalog} value={catalog}>
              {catalog}
            </option>
          ))}
        </select>
        <Icon name="chevron" size={16} className="dropdown-chevron" />
      </div>
    </div>
  );
}

export default CatalogDropdown;