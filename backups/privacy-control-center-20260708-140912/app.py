from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
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
    compare_users,
)

app = FastAPI(title="Privacy Control Center API")

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
    data = list_groups(search)
    if not data.get("success"):
        return data
    return {
        "success": True,
        "groups": [
            {
                "id": group.get("id"),
                "name": group.get("displayName") or group.get("name"),
            }
            for group in data.get("groups", [])
        ],
    }

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
