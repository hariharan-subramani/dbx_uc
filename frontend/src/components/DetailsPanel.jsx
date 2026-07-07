import Icon from './Icon';
import ObjectDetailsCard from './ObjectDetailsCard';

function DetailsPanel({
  selectedObject,
  objectDetails,
  permissions,
  permissionsMessage,
  loadingPermissions,
  loadingDetails,
  exportedBy,
}) {
  if (!selectedObject) {
    return (
      <div className="details-panel">
        <div className="details-empty">
          <Icon name="catalog" size={48} />
          <h3>No Object Selected</h3>
          <p>Select a workspace, catalog, schema, or table from the left panel to view details and permissions.</p>
        </div>
      </div>
    );
  }

  if (loadingDetails) {
    return (
      <div className="details-panel">
        <div className="details-loading">
          <div className="loading-spinner"></div>
          <p>Loading details...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="details-panel">
      <ObjectDetailsCard
        selectedObject={selectedObject}
        objectDetails={objectDetails}
        permissions={permissions}
        permissionsMessage={permissionsMessage}
        loadingPermissions={loadingPermissions}
        exportedBy={exportedBy}
      />
    </div>
  );
}

export default DetailsPanel;
