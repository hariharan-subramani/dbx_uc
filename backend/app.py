import logging

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from services.databricks_api import (
    get_current_user,
    get_workspace,
    list_catalogs,
    list_schemas,
    list_tables,
    list_volumes,
    preview_table_data,
    get_catalog_metadata,
    get_schema_metadata,
    get_table_metadata,
    get_volume_metadata,
    get_permissions,
    get_catalog_binding,
    get_schema_objects,
    get_table_statistics,
    get_volume_binding,
    list_users,
    get_user_access,
    get_user_groups,
    get_group_members,
    list_groups,
    list_group_summaries,
    get_group_by_id,
    get_group_permissions,
    get_group_access,
    get_group_catalogs,
    get_group_schemas,
    get_group_tables,
    create_group,
    update_group,
    delete_group,
    add_user_to_group,
    remove_user_from_group,
    compare_users,
    get_available_privileges,
    validate_principal_grantability,
    grant_permissions,
    update_principal_permissions,
    remove_principal_permissions,
    get_catalog_governance,
    get_schema_governance,
    get_table_governance,
    get_volume_governance,
)
from services.workspace_auth import WorkspaceAuthError, get_access_token
from services.audit_service import list_permission_audits, record_permission_audit
from services.governance_api import (
    list_audit_history,
    list_catalog_bindings,
    list_external_locations,
    list_governance_catalogs,
    list_storage_credentials,
    governance_summary,
)

app = FastAPI(title="Privacy Control Center API")
logger = logging.getLogger(__name__)


class PermissionMutationRequest(BaseModel):
    principal: str = Field(..., min_length=1)
    principal_type: str = "User"
    privileges: list[str] = Field(default_factory=list)
    action: str = "grant"


class PermissionManagementRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    object_type: str = Field(..., alias="objectType", min_length=1)
    catalog: str = ""
    schema_name: str = Field(default="", alias="schema")
    table: str = ""
    volume: str = ""
    principal_type: str = Field(default="User", alias="principalType")
    principal: str = Field(..., min_length=1)
    privileges: list[str] = Field(default_factory=list)
    administrator: str = ""


class PrincipalValidationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    principal: str = Field(..., min_length=1)
    principal_type: str = Field(default="user", alias="principal_type")
    object_type: str = Field(default="", alias="object_type")
    catalog: str = ""
    schema_name: str = Field(default="", alias="schema")
    table: str = ""
    volume: str = ""


class GroupMutationRequest(BaseModel):
    name: str = Field(default="", min_length=0)
    description: str = ""


class GroupMemberMutationRequest(BaseModel):
    user: str = Field(..., min_length=1)
    role: str = "Member"


def _permission_target(request: PermissionManagementRequest) -> dict:
    object_type = request.object_type.strip().lower()
    catalog = request.catalog.strip()
    schema_name = request.schema_name.strip()
    table = request.table.strip()
    volume = request.volume.strip()

    if object_type == "catalog" and catalog:
        return {"success": True, "securable_type": "catalog", "full_name": catalog}
    if object_type == "schema" and catalog and schema_name:
        return {"success": True, "securable_type": "schema", "full_name": f"{catalog}.{schema_name}"}
    if object_type == "table" and catalog and schema_name and table:
        return {"success": True, "securable_type": "table", "full_name": f"{catalog}.{schema_name}.{table}"}
    if object_type == "volume" and catalog and schema_name and volume:
        return {"success": True, "securable_type": "volume", "full_name": f"{catalog}.{schema_name}.{volume}"}

    return {
        "success": False,
        "message": "Object type and required catalog/schema/table/volume fields are invalid.",
        "status_code": 400,
    }


def _attach_permission_audit(
    result: dict,
    action: str,
    request: PermissionManagementRequest,
    target: dict,
) -> dict:
    if not result.get("success"):
        return result

    result["audit"] = record_permission_audit(
        action=action,
        administrator=request.administrator,
        principal=request.principal,
        principal_type=request.principal_type,
        object_type=target.get("securable_type", request.object_type),
        object_name=target.get("full_name", ""),
        privileges=request.privileges,
    )
    return result

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def verify_databricks_connection():
    try:
        get_access_token()
        logger.info("Databricks workspace OAuth authentication succeeded")
    except WorkspaceAuthError as exc:
        logger.error("Unable to connect to Databricks Workspace: %s", exc)

@app.get("/")
def api_home():
    return {
        "name": "Privacy Control Center API",
        "status": "running",
        "frontend": "http://127.0.0.1:5173",
        "documentation": "http://127.0.0.1:8000/docs",
        "endpoints": {
            "user": "/user",
            "catalogs": "/catalogs",
            "schemas": "/catalogs/{catalog_name}/schemas",
            "tables": "/catalogs/{catalog_name}/schemas/{schema_name}/tables",
            "data_preview": (
                "/catalogs/{catalog_name}/schemas/{schema_name}"
                "/tables/{table_name}/data"
            ),
        },
    }

@app.get("/catalogs")
def catalogs():
    return list_catalogs()

@app.get("/governance/summary")
def governance_summary_endpoint():
    return governance_summary()

@app.get("/governance/unity-catalogs")
@app.get("/governance/catalogs", include_in_schema=False)
def governance_catalogs():
    return list_governance_catalogs()

@app.get("/governance/storage-credentials")
def governance_storage_credentials():
    return list_storage_credentials()

@app.get("/governance/external-locations")
def governance_external_locations():
    return list_external_locations()

@app.get("/governance/catalog-bindings")
def governance_catalog_bindings():
    return list_catalog_bindings()

@app.get("/governance/audit-history")
@app.get("/governance/audit", include_in_schema=False)
def governance_audit():
    return list_audit_history()

@app.get("/catalogs/{catalog_name}/schemas")
def schemas(catalog_name: str):
    return list_schemas(catalog_name)

def _governance_envelope(result: dict, section: str) -> dict:
    """Keep object pages usable when one optional governance subsection fails."""
    failed = not result.get("success")
    section_error = f"{section.replace('-', ' ').title()} unavailable"
    envelope = {
        "success": True,
        "basic_information": result.get("basic_information") or {},
        "permissions": result.get("permissions") or [],
        "storage_information": result.get("storage_information"),
        "external_locations": result.get("external_locations") or [],
        "parent_catalog": result.get("parent_catalog") or {},
        "errors": [section_error] if failed else [],
        **result,
    }
    envelope["success"] = True
    envelope["section_available"] = not failed
    envelope["errors"] = [section_error] if failed else result.get("errors", [])
    if section == "storage" and result.get("information") is not None:
        envelope["storage_information"] = result.get("information")
    if section == "parent-catalog" and result.get("information") is not None:
        envelope["parent_catalog"] = result.get("information")
    return envelope

@app.get("/data-governance/catalogs/{catalog_name}")
def catalog_governance(catalog_name: str, section: str = Query(...)):
    logger.info("Loading catalog governance: catalog=%s section=%s", catalog_name, section)
    return _governance_envelope(get_catalog_governance(catalog_name, section), section)

@app.get("/data-governance/catalogs/{catalog_name}/schemas/{schema_name}")
def schema_governance(catalog_name: str, schema_name: str, section: str = Query(...)):
    logger.info("Loading schema governance: catalog=%s schema=%s section=%s", catalog_name, schema_name, section)
    return _governance_envelope(get_schema_governance(catalog_name, schema_name, section), section)

@app.get("/data-governance/catalogs/{catalog_name}/schemas/{schema_name}/tables/{table_name}")
def table_governance(catalog_name: str, schema_name: str, table_name: str, section: str = Query(...)):
    logger.info("Loading table governance: catalog=%s schema=%s table=%s section=%s", catalog_name, schema_name, table_name, section)
    return _governance_envelope(get_table_governance(catalog_name, schema_name, table_name, section), section)

@app.get("/data-governance/catalogs/{catalog_name}/schemas/{schema_name}/volumes/{volume_name}")
def volume_governance(catalog_name: str, schema_name: str, volume_name: str, section: str = Query(...)):
    logger.info("Loading volume governance: catalog=%s schema=%s volume=%s section=%s", catalog_name, schema_name, volume_name, section)
    return _governance_envelope(get_volume_governance(catalog_name, schema_name, volume_name, section), section)

@app.get("/catalogs/{catalog_name}/schemas/{schema_name}/tables")
def tables(catalog_name: str, schema_name: str):
    return list_tables(catalog_name, schema_name)

@app.get("/catalogs/{catalog_name}/schemas/{schema_name}/volumes")
def volumes(catalog_name: str, schema_name: str):
    return list_volumes(catalog_name, schema_name)

@app.get("/catalogs/{catalog_name}/schemas/{schema_name}/tables/{table_name}/data")
def table_data(
    catalog_name: str,
    schema_name: str,
    table_name: str,
    limit: int = Query(default=25, ge=1, le=50),
):
    return preview_table_data(catalog_name, schema_name, table_name, limit)

@app.get("/user")
def get_user():
    return get_current_user()

@app.get("/users")
def users(search: str = "", fresh: bool = Query(default=False)):
    return list_users(search, fresh=fresh)

@app.get("/users/compare")
def users_compare(user1: str, user2: str, scan: bool = Query(default=False)):
    return compare_users(user1, user2, scan_permissions=scan)

@app.get("/users/{user}/access")
def user_access(user: str, scan: bool = Query(default=True), fresh: bool = Query(default=True)):
    return get_user_access(user, scan_permissions=scan, fresh=fresh)

@app.get("/users/{user}/groups")
def user_groups(user: str, fresh: bool = Query(default=True)):
    return get_user_groups(user, fresh=fresh)

@app.get("/groups")
def groups(search: str = "", fresh: bool = Query(default=False)):
    return list_group_summaries(search, fresh=fresh)

@app.post("/groups")
def group_create(request: GroupMutationRequest):
    return create_group(request.name, request.description)

@app.get("/groups/{group_id}/details")
def group_details(group_id: str):
    return get_group_by_id(group_id)

@app.get("/groups/{group_name}/permissions")
def group_permissions(group_name: str, scan: bool = Query(default=False)):
    return get_group_permissions(group_name, scan_permissions=scan)

@app.get("/groups/{group_name}/access")
def group_access(group_name: str, scan: bool = Query(default=True)):
    return get_group_access(group_name, scan_permissions=scan)

@app.get("/groups/{group_name}/catalogs")
def group_catalogs(group_name: str):
    return get_group_catalogs(group_name)

@app.get("/groups/{group_name}/schemas")
def group_schemas(group_name: str):
    return get_group_schemas(group_name)

@app.get("/groups/{group_name}/tables")
def group_tables(group_name: str):
    return get_group_tables(group_name)

@app.patch("/groups/{group_id}")
def group_update(group_id: str, request: GroupMutationRequest):
    return update_group(group_id, request.name, request.description)

@app.delete("/groups/{group_id}")
def group_delete(group_id: str):
    return delete_group(group_id)

@app.patch("/groups/{group_id}/members")
def group_add_member(group_id: str, request: GroupMemberMutationRequest):
    return add_user_to_group(group_id, request.user, request.role)

@app.delete("/groups/{group_id}/members/{user_id}")
def group_remove_member(group_id: str, user_id: str):
    return remove_user_from_group(group_id, user_id)

@app.get("/groups/{group_name}/members")
def group_members(group_name: str):
    return get_group_members(group_name)

@app.get("/groups/{group_name}")
def group_profile(group_name: str):
    return get_group_access(group_name, scan_permissions=False)

@app.get("/workspace")
def workspace():
    return get_workspace()


@app.get("/catalogs/{catalog_name}/metadata")
def catalog_metadata(catalog_name: str):
    return get_catalog_metadata(catalog_name)

@app.get("/catalogs/{catalog_name}/schemas/{schema_name}/metadata")
def schema_metadata(catalog_name: str, schema_name: str):
    return get_schema_metadata(catalog_name, schema_name)

@app.get("/catalogs/{catalog_name}/schemas/{schema_name}/tables/{table_name}/metadata")
def table_metadata(catalog_name: str, schema_name: str, table_name: str):
    return get_table_metadata(catalog_name, schema_name, table_name)

@app.get("/catalogs/{catalog_name}/schemas/{schema_name}/volumes/{volume_name}/metadata")
def volume_metadata(catalog_name: str, schema_name: str, volume_name: str):
    return get_volume_metadata(catalog_name, schema_name, volume_name)

@app.get("/catalogs/{catalog_name}/permissions")
def catalog_permissions(catalog_name: str):
    return get_permissions("catalog", catalog_name)

@app.patch("/catalogs/{catalog_name}/permissions")
def catalog_permissions_update(catalog_name: str, request: PermissionMutationRequest):
    action = request.action.lower()
    if action == "update":
        return update_principal_permissions(
            "catalog",
            catalog_name,
            request.principal,
            request.privileges,
            request.principal_type,
        )
    if action == "remove":
        return remove_principal_permissions(
            "catalog",
            catalog_name,
            request.principal,
            request.principal_type,
        )
    return grant_permissions(
        "catalog",
        catalog_name,
        request.principal,
        request.privileges,
        request.principal_type,
    )

@app.get("/permissions/{securable_type}/available-privileges")
def available_privileges(securable_type: str):
    logger.info(
        "Available privileges requested",
        extra={
            "securable_type": securable_type,
            "route": f"/permissions/{securable_type}/available-privileges",
            "databricks_api": "none: using backend registry fallback",
        },
    )
    response = get_available_privileges(securable_type)
    logger.info(
        "Available privileges response",
        extra={
            "securable_type": securable_type,
            "success": response.get("success"),
            "source": response.get("source"),
            "group_count": len(response.get("groups", [])),
        },
    )
    return response


@app.post("/permissions/validate-principal")
def validate_principal(request: PrincipalValidationRequest):
    return validate_principal_grantability(
        request.principal,
        request.principal_type,
        request.object_type,
        request.catalog,
        request.schema_name,
        request.table,
        request.volume,
    )


@app.post("/permissions/grant")
def grant_permission(request: PermissionManagementRequest):
    target = _permission_target(request)
    if not target.get("success"):
        return target
    result = grant_permissions(
        target["securable_type"],
        target["full_name"],
        request.principal,
        request.privileges,
        request.principal_type,
    )
    return _attach_permission_audit(result, "Grant", request, target)


@app.patch("/permissions/edit")
def edit_permission(request: PermissionManagementRequest):
    target = _permission_target(request)
    if not target.get("success"):
        return target
    result = update_principal_permissions(
        target["securable_type"],
        target["full_name"],
        request.principal,
        request.privileges,
        request.principal_type,
    )
    return _attach_permission_audit(result, "Edit", request, target)


@app.delete("/permissions/remove")
def remove_permission(request: PermissionManagementRequest):
    target = _permission_target(request)
    if not target.get("success"):
        return target
    result = remove_principal_permissions(
        target["securable_type"],
        target["full_name"],
        request.principal,
        request.principal_type,
    )
    return _attach_permission_audit(result, "Remove", request, target)


@app.get("/permissions/audit")
def permission_audit(limit: int = Query(default=100, ge=1, le=500)):
    return list_permission_audits(limit)


@app.patch("/permissions/{securable_type}/{full_name}/grant")
def grant_securable_permissions(
    securable_type: str,
    full_name: str,
    request: PermissionMutationRequest,
):
    return grant_permissions(
        securable_type,
        full_name,
        request.principal,
        request.privileges,
        request.principal_type,
    )

@app.patch("/permissions/{securable_type}/{full_name}/update")
def update_securable_permissions(
    securable_type: str,
    full_name: str,
    request: PermissionMutationRequest,
):
    return update_principal_permissions(
        securable_type,
        full_name,
        request.principal,
        request.privileges,
        request.principal_type,
    )

@app.patch("/permissions/{securable_type}/{full_name}/remove")
def remove_securable_permissions(
    securable_type: str,
    full_name: str,
    request: PermissionMutationRequest,
):
    return remove_principal_permissions(
        securable_type,
        full_name,
        request.principal,
        request.principal_type,
    )

@app.get("/schemas/{catalog_name}/{schema_name}/permissions")
def schema_permissions(catalog_name: str, schema_name: str):
    return get_permissions("schema", f"{catalog_name}.{schema_name}")

@app.get("/tables/{catalog_name}/{schema_name}/{table_name}/permissions")
def table_permissions(catalog_name: str, schema_name: str, table_name: str):
    return get_permissions("table", f"{catalog_name}.{schema_name}.{table_name}")

@app.get("/volumes/{catalog_name}/{schema_name}/{volume_name}/permissions")
def volume_permissions(catalog_name: str, schema_name: str, volume_name: str):
    return get_permissions("volume", f"{catalog_name}.{schema_name}.{volume_name}")

@app.get("/catalogs/{catalog_name}/bundles")
def catalog_bundles(catalog_name: str):
    return get_catalog_binding(catalog_name)

@app.get("/catalogs/{catalog_name}/schemas/{schema_name}/volumes/{volume_name}/binding")
def volume_binding(catalog_name: str, schema_name: str, volume_name: str):
    return get_volume_binding(catalog_name, schema_name, volume_name)

@app.get("/catalogs/{catalog_name}/schemas/{schema_name}/objects")
def schema_objects(catalog_name: str, schema_name: str):
    return get_schema_objects(catalog_name, schema_name)

@app.get("/catalogs/{catalog_name}/schemas/{schema_name}/tables/{table_name}/statistics")
def table_statistics(catalog_name: str, schema_name: str, table_name: str):
    return get_table_statistics(catalog_name, schema_name, table_name)
