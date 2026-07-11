import Icon from './Icon';

function WorkspaceSelector({ workspaces, selectedWorkspace, onSelectWorkspace, loading }) {
  const handleChange = (e) => {
    const value = e.target.value;
    onSelectWorkspace(value);
  };

  return (
    <div className="selector-section">
      <label className="selector-label">
        <Icon name="home" size={16} />
        Workspace
      </label>
      <div className="selector-dropdown">
        <select
          value={selectedWorkspace}
          onChange={handleChange}
          disabled={loading || workspaces.length === 0}
          className="selector-select"
        >
          <option value="">Select workspace</option>
          {workspaces.map((workspace) => (
            <option key={workspace.value} value={workspace.value}>
              {workspace.label}
            </option>
          ))}
        </select>
        <Icon name="chevron" size={16} className="selector-chevron" />
      </div>
    </div>
  );
}

export default WorkspaceSelector;
