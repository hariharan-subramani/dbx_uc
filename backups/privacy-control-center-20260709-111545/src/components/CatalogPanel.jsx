import Icon from './Icon';

function CatalogPanel({ selectedCatalog, loading }) {
  return (
    <div className="explorer-panel catalog-panel">
      <div className="panel-header">
        <div className="panel-title">
          <Icon name="catalog" size={18} />
          <h3>Catalog</h3>
        </div>
      </div>
      <div className="panel-content">
        {loading ? (
          <div className="panel-loading">
            {[1, 2, 3].map((item) => (
              <div className="skeleton-item" key={item} />
            ))}
          </div>
        ) : !selectedCatalog ? (
          <div className="panel-empty">
            <Icon name="catalog" size={24} />
            <p>Select a catalog</p>
            <span>Choose a catalog from the dropdown above</span>
          </div>
        ) : (
          <div className="panel-list">
            <div className="panel-list-item selected">
              <Icon name="database" size={16} />
              <span>{selectedCatalog}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CatalogPanel;
