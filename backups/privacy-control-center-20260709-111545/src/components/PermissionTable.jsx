function PermissionTable({
  permissions,
  userSearch,
  groupSearch,
  emptyMessage,
  selectedObject,
  onGrantMissingPrincipal,
  onEditPermission,
  onRemovePermission,
}) {
  const normalizedGrantableGroups = new Set(
    [
      'account users',
      ...(permissions || [])
        .filter((permission) => String(permission.principal_type || '').toLowerCase() === 'group')
        .map((permission) => String(permission.principal || '').toLowerCase()),
    ],
  );

  if ((!permissions || permissions.length === 0) && !userSearch && !groupSearch) {
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
    const searchedUser = userSearch?.trim() || '';
    const searchedGroup = groupSearch?.trim() || '';
    const canGrantUser = Boolean(
      searchedUser
      && selectedObject?.type === 'catalog'
      && !(permissions || []).some((permission) => (
        String(permission.principal_type || '').toLowerCase() === 'user'
        && String(permission.principal || '').toLowerCase() === searchedUser.toLowerCase()
      ))
    );
    const canGrantGroup = Boolean(
      searchedGroup
      && selectedObject?.type === 'catalog'
      && normalizedGrantableGroups.has(searchedGroup.toLowerCase())
      && !(permissions || []).some((permission) => (
        String(permission.principal_type || '').toLowerCase() === 'group'
        && String(permission.principal || '').toLowerCase() === searchedGroup.toLowerCase()
      ))
    );

    return (
      <div className="permission-table-empty">
        <p>{getEmptyMessage()}</p>
        {canGrantUser && (
          <>
            <span>This user currently does not have access to this Catalog.</span>
            <button
              type="button"
              className="primary-button permission-empty-action"
              onClick={() => onGrantMissingPrincipal(searchedUser, 'User')}
            >
              Grant Access
            </button>
          </>
        )}
        {canGrantGroup && (
          <>
            <span>This group currently does not have access to this Catalog.</span>
            <button
              type="button"
              className="primary-button permission-empty-action"
              onClick={() => onGrantMissingPrincipal(searchedGroup, 'Group')}
            >
              Grant Group Access
            </button>
          </>
        )}
        {searchedGroup && selectedObject?.type === 'catalog' && !canGrantGroup && (
          <span>
            This workspace group is not available as a Unity Catalog grant principal.
          </span>
        )}
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
            <th>Actions</th>
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
              <td className="permission-actions-cell">
                <button type="button" className="table-action-button" onClick={() => onEditPermission(perm)}>
                  Edit
                </button>
                <button type="button" className="table-action-button danger" onClick={() => onRemovePermission(perm)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default PermissionTable;
