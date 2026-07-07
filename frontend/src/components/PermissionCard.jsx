function PermissionCard({ title, permissions }) {
  return (
    <div className="permission-card">
      <h3 className="permission-card-title">{title}</h3>
      <div className="permission-card-content">
        {permissions && permissions.length > 0 ? (
          <div className="permission-list">
            {permissions.map((perm, index) => (
              <div key={index} className="permission-item">
                <div className="permission-header">
                  <span className="permission-principal">{perm.principal}</span>
                  <span className="permission-type">{perm.principal_type}</span>
                </div>
                <div className="permission-actions">
                  {perm.privileges && perm.privileges.map((priv, idx) => (
                    <span key={idx} className="permission-badge">{priv}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="no-permissions">No permissions found</p>
        )}
      </div>
    </div>
  );
}

export default PermissionCard;
