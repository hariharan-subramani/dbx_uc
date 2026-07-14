const GovernanceCards = ({ cards, activeSection, onSelect }) => (
  <div className="governance-cards" aria-label="Governance resource totals">
    {cards.map((card) => (
      <button
        className={`governance-card${activeSection === card.id ? " active" : ""}`}
        key={card.id}
        onClick={() => onSelect(card.id)}
        type="button"
      >
        <span>{card.label}</span>
        <strong>{card.loading ? "—" : card.count}</strong>
        <small>{card.note || "Live from Databricks"}</small>
      </button>
    ))}
  </div>
);

export default GovernanceCards;
