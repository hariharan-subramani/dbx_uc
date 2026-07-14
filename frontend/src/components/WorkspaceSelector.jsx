import Icon from './Icon';

function WorkspaceSelector({ workspaces, selectedWorkspace, loading }) {
  return (
    <div className="selector-section">
      <label className="selector-label">
        <Icon name="home" size={16} />
        Workspace
      </label>
      <div className="selector-dropdown">
        <select
          value={selectedWorkspace}
          onChange={() => {}}
          disabled
          className="selector-select"
          aria-label={loading ? 'Connecting to Databricks workspace' : 'Connected Databricks workspace'}
        >
          {!selectedWorkspace && (
            <option value="">{loading ? 'Connecting...' : 'Workspace unavailable'}</option>
          )}
          {workspaces.map((workspace) => (
            <option key={workspace.value} value={workspace.value}>
              {workspace.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default WorkspaceSelector;
