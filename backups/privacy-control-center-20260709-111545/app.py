import logging

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from services.databricks_api import (
    get_current_user,
    get_workspace,
    list_catalogs,
    list_schemas,
    list_tables,
    preview_table_data,
    get_catalog_metadata,
    get_schema_metadata,
    get_table_metadata,
    get_permissions,
    get_catalog_binding,
    get_schema_objects,
    get_table_statistics,
    list_users,
    get_user_access,
    get_user_groups,
    get_group_members,
    list_groups,
    list_group_summaries,
    get_group_by_id,
    get_group_permissions,
    create_group,
    update_group,
    delete_group,
    add_user_to_group,
    remove_user_from_group,
    compare_users,
    get_available_privileges,
    grant_permissions,
    update_principal_permissions,
    remove_principal_permissions,
)

app = FastAPI(title="Privacy Control Center API")
logger = logging.getLogger(__name__)


class PermissionMutationRequest(BaseModel):
    principal: str = Field(..., min_length=1)
    principal_type: str = "User"
    privileges: list[str] = Field(default_factory=list)
    action: str = "grant"


class GroupMutationRequest(BaseModel):
    name: str = Field(default="", min_length=0)
    description: str = ""


class GroupMemberMutationRequest(BaseModel):
    user: str = Field(..., min_length=1)
    role: str = "Member"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

@app.get("/catalogs/{catalog_name}/schemas")
def schemas(catalog_name: str):
    return list_schemas(catalog_name)

@app.get("/catalogs/{catalog_name}/schemas/{schema_name}/tables")
def tables(catalog_name: str, schema_name: str):
    return list_tables(catalog_name, schema_name)

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
def users(search: str = ""):
    return list_users(search)

@app.get("/users/compare")
def users_compare(user1: str, user2: str, scan: bool = Query(default=False)):
    return compare_users(user1, user2, scan_permissions=scan)

@app.get("/users/{user}/access")
def user_access(user: str, scan: bool = Query(default=False)):
    return get_user_access(user, scan_permissions=scan)

@app.get("/users/{user}/groups")
def user_groups(user: str):
    return get_user_groups(user)

@app.get("/groups")
def groups(search: str = ""):
    return list_group_summaries(search)

@app.post("/groups")
def group_create(request: GroupMutationRequest):
    return create_group(request.name, request.description)

@app.get("/groups/{group_id}/details")
def group_details(group_id: str):
    return get_group_by_id(group_id)

@app.get("/groups/{group_name}/permissions")
def group_permissions(group_name: str, scan: bool = Query(default=False)):
    return get_group_permissions(group_name, scan_permissions=scan)

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

@app.get("/catalogs/{catalog_name}/bundles")
def catalog_bundles(catalog_name: str):
    return get_catalog_binding(catalog_name)

@app.get("/catalogs/{catalog_name}/schemas/{schema_name}/objects")
def schema_objects(catalog_name: str, schema_name: str):
    return get_schema_objects(catalog_name, schema_name)

@app.get("/catalogs/{catalog_name}/schemas/{schema_name}/tables/{table_name}/statistics")
def table_statistics(catalog_name: str, schema_name: str, table_name: str):
    return get_table_statistics(catalog_name, schema_name, table_name)
