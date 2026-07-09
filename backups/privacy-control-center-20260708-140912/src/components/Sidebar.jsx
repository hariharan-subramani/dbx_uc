import Icon from './Icon';

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><Icon name="shield" size={20} /></div>
        <span>Privacy Center</span>
      </div>
      <nav className="nav" aria-label="Main navigation">
        <p className="nav-label">Workspace</p>
        <a className="nav-item active" href="#">
          <Icon name="home" />
          <span>Overview</span>
        </a>
        <a className="nav-item" href="#">
          <Icon name="catalog" />
          <span>Data Catalogs</span>
        </a>
        <a className="nav-item" href="#">
          <Icon name="shield" />
          <span>Compliance</span>
        </a>
        <a className="nav-item" href="#">
          <Icon name="activity" />
          <span>Audit activity</span>
        </a>
        <p className="nav-label second">Manage</p>
        <a className="nav-item" href="#">
          <Icon name="settings" />
          <span>Settings</span>
        </a>
      </nav>
      <div className="sidebar-footer">
        <div className="workspace-icon">P</div>
        <div>
          <strong>Production</strong>
          <span>Workspace</span>
        </div>
        <Icon name="chevron" size={15} />
      </div>
    </aside>
  );
}

export default Sidebar;