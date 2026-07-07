function PermissionTable({ permissions, userSearch, groupSearch, emptyMessage }) {
  if (!permissions || permissions.length === 0) {
    return (
      <div className="permission-table-empty">
        <p>{emptyMessage || 'No permissions found'}</p>
      </div>
    );
  }

  // Filter permissions based on search
  const filteredPermissions = permissions.filter((perm) => {
    const principal = perm.principal || '';
    const principalType = perm.principal_type || '';
    const userMatches = Boolean(userSearch)
      && principalType.toLowerCase() === 'user'
      && principal.toLowerCase().includes(userSearch.toLowerCase());
    const groupMatches = Boolean(groupSearch)
      && principalType.toLowerCase() === 'group'
      && principal.toLowerCase().includes(groupSearch.toLowerCase());

    // If both searches are empty, show all
    if (!userSearch && !groupSearch) {
      return true;
    }

    return userMatches || groupMatches;
  });

  // Determine which message to show
  const getEmptyMessage = () => {
    if (userSearch && groupSearch) {
      return 'No matching users or groups found';
    } else if (userSearch) {
      return 'No matching users found';
    } else if (groupSearch) {
      return 'No matching groups found';
    }
    return 'No permissions found';
  };

  if (filteredPermissions.length === 0) {
    return (
      <div className="permission-table-empty">
        <p>{getEmptyMessage()}</p>
      </div>
    );
  }

  return (
    <div className="permission-table-wrapper">
      <table className="permission-table">
        <thead>
          <tr>
            <th>Principal</th>
            <th>Type</th>
            <th>Privileges</th>
          </tr>
        </thead>
        <tbody>
          {filteredPermissions.map((perm, index) => (
            <tr key={index}>
              <td className="principal-cell">
                <div className="principal-info">
                  <span className="principal-name">{perm.principal}</span>
                </div>
              </td>
              <td>
                <span className={`principal-type type-${perm.principal_type?.toLowerCase()}`}>
                  {perm.principal_type}
                </span>
              </td>
              <td className="privileges-cell">
                <div className="privileges-list">
                  {perm.privileges && perm.privileges.map((priv, idx) => (
                    <span key={idx} className="privilege-badge">
                      {priv}
                    </span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default PermissionTable;
