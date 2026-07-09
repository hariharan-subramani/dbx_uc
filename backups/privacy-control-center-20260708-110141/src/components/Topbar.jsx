import Icon from './Icon';

function Topbar({ user }) {
  const initials = user ? user.split(/[\s.@_-]/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() : "U";

  return (
    <header className="topbar">
      <div className="search">
        <Icon name="search" size={17} />
        <span>Search privacy assets</span>
        <kbd>⌘ K</kbd>
      </div>
      <div className="top-actions">
        <button className="icon-button" aria-label="Notifications">
          <Icon name="bell" />
        </button>
        <span className="divider" />
        <div className="avatar">{initials}</div>
        <div className="user-summary">
          <strong>{user || "Workspace user"}</strong>
          <span>Administrator</span>
        </div>
      </div>
    </header>
  );
}

export default Topbar;