function RelationshipBadge({ icon, label, count, loading, onClick }) {
  return (
    <button
      type="button"
      className="relationship-badge"
      onClick={onClick}
      disabled={loading}
      title={label}
    >
      <span aria-hidden="true">{icon}</span>
      {label} ({loading ? '...' : count})
    </button>
  );
}

export default RelationshipBadge;
