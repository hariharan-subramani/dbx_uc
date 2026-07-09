import { useMemo, useState } from 'react';

function RelationshipModal({
  isOpen,
  title,
  subjectLabel,
  subject,
  itemLabel,
  items,
  loading,
  message,
  onClose,
  onExport,
}) {
  const [search, setSearch] = useState('');

  const filteredItems = useMemo(() => {
    const normalized = search.toLowerCase();
    return (items || []).filter((item) => {
      const value = item.name || item.email || item;
      return !normalized || String(value).toLowerCase().includes(normalized);
    });
  }, [items, search]);

  if (!isOpen) return null;

  return (
    <div className="relationship-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="relationship-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="relationship-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="relationship-modal-header">
          <div>
            <h3 id="relationship-modal-title">{title}</h3>
            <p>{subjectLabel}: <strong>{subject}</strong></p>
          </div>
          <button type="button" className="relationship-close" onClick={onClose} aria-label="Close">x</button>
        </div>

        <div className="relationship-modal-tools">
          <input
            className="search-input"
            type="text"
            value={search}
            placeholder={`Search ${itemLabel.toLowerCase()}...`}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="button" className="export-button" onClick={onExport} disabled={loading || !items?.length}>
            Export Excel
          </button>
        </div>

        <div className="relationship-total">Total {itemLabel}: {items?.length || 0}</div>

        <div className="relationship-list">
          {loading ? (
            <div className="relationship-empty">Loading...</div>
          ) : message ? (
            <div className="relationship-empty">{message}</div>
          ) : filteredItems.length === 0 ? (
            <div className="relationship-empty">No matching {itemLabel.toLowerCase()} found.</div>
          ) : filteredItems.map((item) => {
            const value = item.name || item.email || item;
            return (
              <div key={item.id || value} className="relationship-list-item">
                <span className="relationship-check">✓</span>
                <span>{value}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default RelationshipModal;
