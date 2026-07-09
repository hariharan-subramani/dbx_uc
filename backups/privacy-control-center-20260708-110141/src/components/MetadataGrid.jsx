function MetadataGrid({ title, items }) {
  if (!items || items.length === 0) return null;

  return (
    <div className="metadata-grid">
      <h3 className="metadata-grid-title">{title}</h3>
      <div className="metadata-grid-content">
        {items.map((item, index) => (
          <div key={index} className="metadata-item">
            <span className="metadata-label">{item.label}</span>
            <span className="metadata-value">{item.value || 'N/A'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default MetadataGrid;