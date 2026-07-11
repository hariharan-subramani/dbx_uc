function InfoCard({ title, items }) {
  return (
    <div className="info-card">
      <h3 className="info-card-title">{title}</h3>
      <div className="info-card-content">
        {items.map((item, index) => (
          <div key={index} className="info-item">
            <span className="info-label">{item.label}</span>
            <span className="info-value">{item.value || 'N/A'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default InfoCard;
