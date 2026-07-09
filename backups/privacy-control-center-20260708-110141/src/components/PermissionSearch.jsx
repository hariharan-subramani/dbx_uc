import { useState } from 'react';

function PermissionSearch({ onFilterChange }) {
  const [userSearch, setUserSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');

  const updateUserSearch = (value) => {
    setUserSearch(value);
    onFilterChange({ userSearch: value, groupSearch });
  };

  const updateGroupSearch = (value) => {
    setGroupSearch(value);
    onFilterChange({ userSearch, groupSearch: value });
  };

  return (
    <div className="permission-search">
      <div className="search-field">
        <label htmlFor="user-search" className="search-label">Search User</label>
        <input
          id="user-search"
          type="text"
          className="search-input"
          placeholder="Filter by user..."
          value={userSearch}
          onChange={(e) => updateUserSearch(e.target.value)}
        />
      </div>
      <div className="search-field">
        <label htmlFor="group-search" className="search-label">Search Group</label>
        <input
          id="group-search"
          type="text"
          className="search-input"
          placeholder="Filter by group..."
          value={groupSearch}
          onChange={(e) => updateGroupSearch(e.target.value)}
        />
      </div>
    </div>
  );
}

export default PermissionSearch;
