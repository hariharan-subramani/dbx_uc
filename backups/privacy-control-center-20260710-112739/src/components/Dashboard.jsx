import Icon from './Icon';

function Dashboard({ catalogs, user, onSyncCatalogs, loading }) {
  return (
    <div className="dashboard">
      <div className="page-heading">
        <div>
          <h1>Privacy & Compliance</h1>
          <p>Monitor data governance and manage privacy controls across your workspace.</p>
        </div>
        <button 
          className="primary-button" 
          onClick={onSyncCatalogs} 
          disabled={loading}
        >
          <Icon name="refresh" size={16} />
          {loading ? "Syncing catalogs…" : "Sync catalogs"}
        </button>
      </div>

      <section className="metrics">
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-icon blue"><Icon name="catalog" /></span>
            <span className="trend">Live</span>
          </div>
          <p>Catalogs monitored</p>
          <strong>{catalogs.length}</strong>
          <span className="metric-note">Unity Catalog</span>
        </article>

        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-icon green"><Icon name="shield" /></span>
            <span className="trend healthy">Healthy</span>
          </div>
          <p>Connection status</p>
          <strong className="text-value">{user ? "Connected" : "Checking…"}</strong>
          <span className="metric-note">Databricks workspace</span>
        </article>

        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-icon amber"><Icon name="activity" /></span>
            <span className="trend neutral">Today</span>
          </div>
          <p>Compliance posture</p>
          <strong className="text-value">Ready</strong>
          <span className="metric-note">No issues detected</span>
        </article>
      </section>
    </div>
  );
}

export default Dashboard;