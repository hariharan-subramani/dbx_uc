import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8';

const safeFilePart = (value) => (
  String(value || 'Export')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
);

const exportTimestamp = () => new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
}).format(new Date());

const normalizePrivileges = (privileges) => {
  if (Array.isArray(privileges)) return privileges.join(', ');
  return privileges || '';
};

const detailMapFrom = (details = []) => Object.fromEntries(
  details.map((item) => [item.label, item.value]),
);

const sheetFromRows = (rows, fallbackMessage) => {
  if (!rows || rows.length === 0) {
    return XLSX.utils.aoa_to_sheet([[fallbackMessage]]);
  }

  return XLSX.utils.json_to_sheet(rows);
};

const formatSheet = (worksheet) => {
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
  const widths = [];

  for (let column = range.s.c; column <= range.e.c; column += 1) {
    let maxLength = 12;
    for (let row = range.s.r; row <= range.e.r; row += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
      const value = cell?.v == null ? '' : String(cell.v);
      maxLength = Math.max(maxLength, value.length + 2);
    }
    widths.push({ wch: Math.min(maxLength, 48) });
  }

  worksheet['!cols'] = widths;
  worksheet['!freeze'] = { xSplit: 0, ySplit: 1 };

  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const cellAddress = XLSX.utils.encode_cell({ r: range.s.r, c: column });
    if (worksheet[cellAddress]) {
      worksheet[cellAddress].s = { font: { bold: true } };
    }
  }

  return worksheet;
};

const appendSheet = (workbook, sheetName, worksheet) => {
  XLSX.utils.book_append_sheet(workbook, formatSheet(worksheet), sheetName);
};

const downloadWorkbook = (workbook, filename) => {
  const excelBuffer = XLSX.write(workbook, {
    bookType: 'xlsx',
    type: 'array',
    cellStyles: true,
  });
  const blob = new Blob([excelBuffer], { type: MIME_TYPE });
  saveAs(blob, filename);
};

const createWorkbook = () => XLSX.utils.book_new();

export const toPermissionRows = (permissions = []) => permissions.map((permission) => ({
  Principal: permission.principal || '',
  Type: permission.principal_type || '',
  Privileges: normalizePrivileges(permission.privileges),
}));

export const toCatalogBindingRows = (bindings = []) => bindings.map((binding) => ({
  'Workspace Name': binding.workspace_name || '',
  'Workspace ID': binding.workspace_id || '',
  'Access Level': binding.access_level || '',
}));

export const toSchemaObjectRows = (objects = []) => objects.map((object) => ({
  'Object Name': object.object_name || '',
  'Object Type': object.object_type || '',
  'Created Date': object.created_date || '',
}));

export const toStatisticRows = (statistics = {}) => Object.entries(statistics)
  .filter(([, value]) => value !== undefined && value !== null && value !== '')
  .map(([key, value]) => ({
    'Statistic Name': key
      .replaceAll('_', ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase()),
    Value: value,
  }));

export const exportPermissions = ({
  objectType = 'Catalog',
  objectName,
  permissions,
}) => {
  const workbook = createWorkbook();
  appendSheet(
    workbook,
    'Permissions',
    sheetFromRows(toPermissionRows(permissions), 'No permissions available.'),
  );
  downloadWorkbook(workbook, `${objectType}Permissions_${safeFilePart(objectName)}.xlsx`);
};

export const exportCatalogBinding = ({ catalogName, bindings }) => {
  const workbook = createWorkbook();
  appendSheet(
    workbook,
    'Catalog Binding',
    sheetFromRows(toCatalogBindingRows(bindings), 'No workspace bindings available.'),
  );
  downloadWorkbook(workbook, `CatalogBinding_${safeFilePart(catalogName)}.xlsx`);
};

export const exportSchemaObjects = ({ schemaName, objects }) => {
  const workbook = createWorkbook();
  appendSheet(
    workbook,
    'Schema Objects',
    sheetFromRows(toSchemaObjectRows(objects), 'No schema objects available.'),
  );
  downloadWorkbook(workbook, `SchemaObjects_${safeFilePart(schemaName)}.xlsx`);
};

export const exportTableStatistics = ({ tableName, statistics }) => {
  const workbook = createWorkbook();
  appendSheet(
    workbook,
    'Table Statistics',
    sheetFromRows(toStatisticRows(statistics), 'No table statistics available.'),
  );
  downloadWorkbook(workbook, `TableStatistics_${safeFilePart(tableName)}.xlsx`);
};

export const exportCatalog = ({
  catalogName,
  details,
  permissions,
  bindings,
  workspaceName,
  exportedBy,
}) => {
  const workbook = createWorkbook();
  const detailMap = detailMapFrom(details);
  const catalogDetails = [{
    'Catalog Name': detailMap.Name || catalogName || '',
    Owner: detailMap.Owner || '',
    'Created Date': detailMap['Created Date'] || '',
    Comment: detailMap.Comment || '',
    'Schema Count': detailMap['Schema Count'] || '',
    'Workspace Name': workspaceName || '',
    'Export Date': exportTimestamp(),
    'Exported By': exportedBy || '',
  }];

  appendSheet(workbook, 'Catalog Details', XLSX.utils.json_to_sheet(catalogDetails));
  appendSheet(
    workbook,
    'Permissions',
    sheetFromRows(toPermissionRows(permissions), 'No permissions available.'),
  );
  appendSheet(
    workbook,
    'Catalog Binding',
    sheetFromRows(toCatalogBindingRows(bindings), 'No workspace bindings available.'),
  );

  downloadWorkbook(workbook, `Catalog_${safeFilePart(catalogName)}.xlsx`);
};

export const exportSchema = ({
  schemaName,
  details,
  permissions,
  objects,
  exportedBy,
}) => {
  const workbook = createWorkbook();
  const detailMap = detailMapFrom(details);
  const schemaDetails = [{
    'Schema Name': detailMap.Name || schemaName || '',
    Owner: detailMap.Owner || '',
    Catalog: detailMap.Catalog || '',
    'Created Date': detailMap['Created Date'] || '',
    Comment: detailMap.Comment || '',
    'Table Count': detailMap['Table Count'] || '',
    'Export Date': exportTimestamp(),
    'Exported By': exportedBy || '',
  }];

  appendSheet(workbook, 'Schema Details', XLSX.utils.json_to_sheet(schemaDetails));
  appendSheet(
    workbook,
    'Permissions',
    sheetFromRows(toPermissionRows(permissions), 'No permissions available.'),
  );
  appendSheet(
    workbook,
    'Schema Objects',
    sheetFromRows(toSchemaObjectRows(objects), 'No schema objects available.'),
  );

  downloadWorkbook(workbook, `Schema_${safeFilePart(schemaName)}.xlsx`);
};

export const exportTable = ({
  tableName,
  details,
  permissions,
  statistics,
  exportedBy,
}) => {
  const workbook = createWorkbook();
  const detailMap = detailMapFrom(details);
  const tableDetails = [{
    'Table Name': detailMap.Name || tableName || '',
    Schema: detailMap.Schema || '',
    Catalog: detailMap.Catalog || '',
    Owner: detailMap.Owner || '',
    'Created Date': detailMap['Created Date'] || '',
    Comment: detailMap.Comment || '',
    'Column Count': detailMap['Columns Count'] || detailMap['Column Count'] || '',
    Storage: detailMap.Storage || '',
    'Export Date': exportTimestamp(),
    'Exported By': exportedBy || '',
  }];

  appendSheet(workbook, 'Table Details', XLSX.utils.json_to_sheet(tableDetails));
  appendSheet(
    workbook,
    'Permissions',
    sheetFromRows(toPermissionRows(permissions), 'No permissions available.'),
  );
  appendSheet(
    workbook,
    'Table Statistics',
    sheetFromRows(toStatisticRows(statistics), 'No table statistics available.'),
  );

  downloadWorkbook(workbook, `Table_${safeFilePart(tableName)}.xlsx`);
};

const toAccessRows = (items = []) => items.map((item) => ({
  Name: item.name || '',
  Catalog: item.catalog || '',
  Schema: item.schema || '',
  Table: item.table || '',
  Privileges: normalizePrivileges(item.privileges),
  Source: item.source || '',
  Principal: item.principal || '',
}));

export const exportUserAccess = ({ profile, exportedBy }) => {
  const workbook = createWorkbook();
  const user = profile?.user || {};
  const groups = profile?.groups || [];
  const details = [{
    Name: user.name || '',
    Email: user.email || '',
    Status: user.status || '',
    'Principal Type': user.principal_type || 'User',
    'Export Date': exportTimestamp(),
    'Exported By': exportedBy || '',
  }];

  appendSheet(workbook, 'User Information', XLSX.utils.json_to_sheet(details));
  appendSheet(
    workbook,
    'Groups',
    sheetFromRows(groups.map((group) => ({ Group: group.name || '' })), 'No groups available.'),
  );
  appendSheet(
    workbook,
    'Catalog Access',
    sheetFromRows(toAccessRows(profile?.catalogs), 'No catalog access available.'),
  );
  appendSheet(
    workbook,
    'Schema Access',
    sheetFromRows(toAccessRows(profile?.schemas), 'No schema access available.'),
  );
  appendSheet(
    workbook,
    'Table Access',
    sheetFromRows(toAccessRows(profile?.tables), 'No table access available.'),
  );
  appendSheet(
    workbook,
    'Privileges',
    sheetFromRows((profile?.privileges || []).map((privilege) => ({ Privilege: privilege })), 'No privileges available.'),
  );

  downloadWorkbook(workbook, `UserAccess_${safeFilePart(user.email || user.name)}.xlsx`);
};

const toComparisonRows = (section = {}) => {
  const values = new Set([
    ...(section.user_a || []),
    ...(section.user_b || []),
  ]);

  return [...values].sort().map((value) => ({
    Name: value,
    'User A': section.user_a?.includes(value) ? 'YES' : 'NO',
    'User B': section.user_b?.includes(value) ? 'YES' : 'NO',
    Difference: section.missing_for_user_b?.includes(value)
      ? 'Missing for User B'
      : section.extra_for_user_b?.includes(value)
        ? 'Extra for User B'
        : 'Matched',
  }));
};

export const exportUserComparison = ({ report, exportedBy }) => {
  const workbook = createWorkbook();
  const comparison = report?.comparison || {};
  const userA = report?.user_a?.user || {};
  const userB = report?.user_b?.user || {};

  appendSheet(workbook, 'Summary', XLSX.utils.json_to_sheet([{
    'User A': userA.email || userA.name || '',
    'User B': userB.email || userB.name || '',
    'Export Date': exportTimestamp(),
    'Exported By': exportedBy || '',
  }]));

  appendSheet(workbook, 'Groups', sheetFromRows(toComparisonRows(comparison.groups), 'No group differences.'));
  appendSheet(workbook, 'Catalogs', sheetFromRows(toComparisonRows(comparison.catalogs), 'No catalog differences.'));
  appendSheet(workbook, 'Schemas', sheetFromRows(toComparisonRows(comparison.schemas), 'No schema differences.'));
  appendSheet(workbook, 'Tables', sheetFromRows(toComparisonRows(comparison.tables), 'No table differences.'));
  appendSheet(workbook, 'Privileges', sheetFromRows(toComparisonRows(comparison.privileges), 'No privilege differences.'));
  appendSheet(
    workbook,
    'Recommended Actions',
    sheetFromRows((report?.recommended_actions || []).map((action) => ({ Action: action })), 'No recommended actions.'),
  );

  downloadWorkbook(workbook, `UserComparison_${safeFilePart(userA.email || userA.name)}_${safeFilePart(userB.email || userB.name)}.xlsx`);
};
