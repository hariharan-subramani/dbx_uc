import os
import requests
import logging
from typing import Optional, Dict, Any, List
from dotenv import load_dotenv
from functools import lru_cache
from datetime import datetime, timedelta
from urllib.parse import quote, urlparse

load_dotenv()

# Configure logging
logger = logging.getLogger(__name__)

# Databricks configuration
DATABRICKS_HOST = os.getenv("DATABRICKS_HOST", "").rstrip("/")
DATABRICKS_TOKEN = os.getenv("DATABRICKS_TOKEN", "")

# Simple in-memory cache for API responses
_cache = {}
CACHE_DURATION = timedelta(minutes=5)


def get_auth_headers() -> Dict[str, str]:
    """
    Get authentication headers for Databricks REST API requests.
    
    Returns:
        Dict with Authorization and Content-Type headers
    """
    return {
        "Authorization": f"Bearer {DATABRICKS_TOKEN}",
        "Content-Type": "application/json"
    }


def make_request(
    method: str,
    endpoint: str,
    params: Optional[Dict[str, Any]] = None,
    json_data: Optional[Dict[str, Any]] = None,
    timeout: int = 30
) -> Dict[str, Any]:
    """
    Make an authenticated request to the Databricks REST API.
    
    Args:
        method: HTTP method (GET, POST, etc.)
        endpoint: API endpoint path (e.g., '/api/2.0/me')
        params: Query parameters
        json_data: JSON body for POST requests
        timeout: Request timeout in seconds
    
    Returns:
        Dict with success status, data/error, and status code
    """
    url = f"{DATABRICKS_HOST}{endpoint}"
    
    try:
        logger.info(f"Making {method} request to: {url}")
        
        response = requests.request(
            method=method,
            url=url,
            headers=get_auth_headers(),
            params=params,
            json=json_data,
            timeout=timeout
        )
        
        logger.info(f"Response status: {response.status_code}")
        
        # Handle successful responses
        if response.status_code in [200, 201]:
            return {
                "success": True,
                "data": response.json(),
                "status_code": response.status_code
            }
        
        # Handle error responses
        error_msg = f"HTTP {response.status_code}"
        try:
            error_detail = response.json()
            if "message" in error_detail:
                error_msg = error_detail["message"]
            elif "error_code" in error_detail:
                error_msg = error_detail.get("error_code", error_msg)
        except:
            error_msg = response.text or error_msg
        
        logger.error(f"API error: {error_msg}")
        
        return {
            "success": False,
            "error": error_msg,
            "status_code": response.status_code
        }
    
    except requests.exceptions.Timeout:
        error_msg = f"Request timeout after {timeout}s"
        logger.error(error_msg)
        return {
            "success": False,
            "error": error_msg,
            "status_code": 408
        }
    
    except requests.exceptions.ConnectionError:
        error_msg = "Failed to connect to Databricks workspace"
        logger.error(error_msg)
        return {
            "success": False,
            "error": error_msg,
            "status_code": 503
        }
    
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Unexpected error: {error_msg}")
        return {
            "success": False,
            "error": error_msg,
            "status_code": 500
        }


def get_current_user() -> Dict[str, Any]:
    """
    Get current user information from Databricks.
    
    Returns:
        Dict with user information
    """
    result = make_request("GET", "/api/2.0/me")
    
    if result["success"]:
        user_data = result["data"]
        return {
            "user": user_data.get("userName", "unknown"),
            "display_name": user_data.get("displayName"),
            "active": True
        }
    
    # Log the error but return a valid response so frontend can load
    logger.warning(f"Failed to get user info: {result.get('error')}")
    
    # Try alternative endpoint for SCIM API
    result2 = make_request("GET", "/api/2.0/preview/scim/v2/Me")
    if result2["success"]:
        user_data = result2["data"]
        return {
            "user": user_data.get("userName", "workspace_user"),
            "display_name": user_data.get("displayName"),
            "active": True
        }
    
    # Return default user if all API calls fail
    logger.warning("Using fallback user information")
    return {
        "user": "hariharansubramani325@gmail.com",
        "display_name": "Workspace User",
        "active": True
    }


def get_workspace() -> Dict[str, Any]:
    """
    Return the configured Databricks workspace identity for the frontend selector.
    """
    parsed_host = urlparse(DATABRICKS_HOST)
    workspace_host = parsed_host.netloc or parsed_host.path

    return {
        "success": True,
        "workspaces": [
            {
                "name": os.getenv("DATABRICKS_WORKSPACE_NAME", "Databricks Workspace"),
                "display_name": os.getenv("DATABRICKS_WORKSPACE_NAME", "Databricks Workspace"),
                "host": DATABRICKS_HOST,
                "workspace_id": os.getenv("DATABRICKS_WORKSPACE_ID", workspace_host or ""),
            }
        ],
    }


def _identity_from_scim_user(user_data: Dict[str, Any]) -> Dict[str, Any]:
    emails = user_data.get("emails") or []
    email = ""
    if emails and isinstance(emails[0], dict):
        email = emails[0].get("value") or ""

    return {
        "id": user_data.get("id"),
        "name": user_data.get("displayName") or user_data.get("userName") or email,
        "email": user_data.get("userName") or email,
        "status": "Active" if user_data.get("active", True) else "Inactive",
        "principal_type": "User",
    }


def list_users(search: str = "") -> Dict[str, Any]:
    """
    Search workspace users through Databricks SCIM.
    """
    cache_key = "scim_users"
    if cache_key in _cache and datetime.now() - _cache[cache_key][1] < CACHE_DURATION:
        users = _cache[cache_key][0]
    else:
        params = {"count": 100}
        result = make_request("GET", "/api/2.0/preview/scim/v2/Users", params=params)

        if not result["success"]:
            return {
                "success": False,
                "users": [],
                "message": "User search is not available for this Databricks workspace.",
                "error": result.get("error"),
                "status_code": result.get("status_code"),
            }

        resources = result["data"].get("Resources", [])
        users = [_identity_from_scim_user(user) for user in resources]
        _cache[cache_key] = (users, datetime.now())

    if users is not None:
        if search:
            normalized = search.lower()
            users = [
                user for user in users
                if normalized in str(user.get("name") or "").lower()
                or normalized in str(user.get("email") or "").lower()
            ]
        return {
            "success": True,
            "users": users,
        }

    return {"success": True, "users": []}


def list_groups() -> Dict[str, Any]:
    """
    Return SCIM groups with short caching to keep user comparison responsive.
    """
    cache_key = "scim_groups"
    if cache_key in _cache and datetime.now() - _cache[cache_key][1] < CACHE_DURATION:
        return {
            "success": True,
            "groups": _cache[cache_key][0],
        }

    result = make_request("GET", "/api/2.0/preview/scim/v2/Groups", params={"count": 100})
    if not result["success"]:
        return {
            "success": False,
            "groups": [],
            "message": "Group membership is not available for this Databricks workspace.",
            "error": result.get("error"),
        }

    groups = result["data"].get("Resources", [])
    _cache[cache_key] = (groups, datetime.now())
    return {
        "success": True,
        "groups": groups,
    }


def _find_user(user: str) -> Dict[str, Any]:
    users_result = list_users(user)
    if not users_result.get("success"):
        return users_result

    normalized = user.lower()
    users = users_result.get("users", [])
    exact = next(
        (
            item for item in users
            if item.get("email", "").lower() == normalized
            or item.get("name", "").lower() == normalized
        ),
        None,
    )

    return {
        "success": True,
        "user": exact or (users[0] if users else None),
    }


def get_user_groups(user: str) -> Dict[str, Any]:
    """
    Return groups containing the requested user using Databricks SCIM.
    """
    user_result = _find_user(user)
    if not user_result.get("success"):
        return {
            "success": False,
            "groups": [],
            "message": user_result.get("message", "Unable to search users."),
        }

    user_info = user_result.get("user")
    if not user_info:
        return {
            "success": False,
            "groups": [],
            "message": "User was not found in this Databricks workspace.",
        }

    groups_result = list_groups()
    if not groups_result["success"]:
        return {
            "success": False,
            "groups": [],
            "message": groups_result.get("message", "Group membership is not available for this Databricks workspace."),
            "error": groups_result.get("error"),
            "user": user_info,
        }

    target_values = {
        str(user_info.get("id") or "").lower(),
        str(user_info.get("email") or "").lower(),
        str(user_info.get("name") or "").lower(),
    }
    groups = []
    for group in groups_result.get("groups", []):
        members = group.get("members") or []
        if any(
            str(member.get("value") or member.get("display") or "").lower() in target_values
            for member in members
            if isinstance(member, dict)
        ):
            groups.append({
                "id": group.get("id"),
                "name": group.get("displayName") or group.get("name"),
            })

    return {
        "success": True,
        "user": user_info,
        "groups": groups,
    }


def _principal_matches(permission: Dict[str, Any], user_info: Dict[str, Any], groups: List[Dict[str, Any]]) -> bool:
    principal = str(permission.get("principal") or "").lower()
    principal_type = str(permission.get("principal_type") or "").lower()
    user_names = {
        str(user_info.get("email") or "").lower(),
        str(user_info.get("name") or "").lower(),
    }
    group_names = {str(group.get("name") or "").lower() for group in groups}

    return (
        (principal_type == "user" and principal in user_names)
        or (principal_type == "group" and principal in group_names)
    )


def _permission_source(permission: Dict[str, Any]) -> str:
    return "Inherited from Group" if str(permission.get("principal_type", "")).lower() == "group" else "Direct"


def _append_access(access: Dict[str, List[Dict[str, Any]]], category: str, item: Dict[str, Any]) -> None:
    access[category].append(item)
    for privilege in item.get("privileges", []):
        if privilege and privilege not in access["privileges"]:
            access["privileges"].append(privilege)


def get_user_access(user: str, scan_permissions: bool = True) -> Dict[str, Any]:
    """
    Build an access profile by matching direct and group permissions across Unity Catalog objects.
    """
    groups_result = get_user_groups(user)
    if not groups_result.get("success"):
        return {
            "success": False,
            "message": groups_result.get("message", "Unable to load user access."),
            "user": groups_result.get("user"),
            "groups": groups_result.get("groups", []),
            "catalogs": [],
            "schemas": [],
            "tables": [],
            "workspaces": [],
            "privileges": [],
        }

    user_info = groups_result.get("user")
    groups = groups_result.get("groups", [])
    access = {
        "catalogs": [],
        "schemas": [],
        "tables": [],
        "workspaces": get_workspace().get("workspaces", []),
        "privileges": [],
    }

    if not scan_permissions:
        return {
            "success": True,
            "scan_complete": False,
            "message": "User profile loaded. Detailed access scan is still pending.",
            "user": user_info,
            "groups": groups,
            **access,
        }

    catalogs_result = list_catalogs()
    if not catalogs_result.get("success"):
        return {
            "success": False,
            "message": "Catalog access could not be scanned for this workspace.",
            "user": user_info,
            "groups": groups,
            **access,
        }

    for catalog_name in catalogs_result.get("catalogs", []):
        catalog_permissions = get_permissions("catalog", catalog_name)
        for permission in catalog_permissions.get("permissions", []):
            if _principal_matches(permission, user_info, groups):
                _append_access(access, "catalogs", {
                    "name": catalog_name,
                    "privileges": permission.get("privileges", []),
                    "source": _permission_source(permission),
                    "principal": permission.get("principal"),
                })

        schemas_result = list_schemas(catalog_name)
        for schema in schemas_result.get("schemas", []):
            schema_name = schema.get("name")
            if not schema_name:
                continue
            full_schema = f"{catalog_name}.{schema_name}"
            schema_permissions = get_permissions("schema", full_schema)
            for permission in schema_permissions.get("permissions", []):
                if _principal_matches(permission, user_info, groups):
                    _append_access(access, "schemas", {
                        "name": full_schema,
                        "catalog": catalog_name,
                        "schema": schema_name,
                        "privileges": permission.get("privileges", []),
                        "source": _permission_source(permission),
                        "principal": permission.get("principal"),
                    })

            tables_result = list_tables(catalog_name, schema_name)
            for table in tables_result.get("tables", []):
                table_name = table.get("name")
                if not table_name:
                    continue
                full_table = f"{catalog_name}.{schema_name}.{table_name}"
                table_permissions = get_permissions("table", full_table)
                for permission in table_permissions.get("permissions", []):
                    if _principal_matches(permission, user_info, groups):
                        _append_access(access, "tables", {
                            "name": full_table,
                            "catalog": catalog_name,
                            "schema": schema_name,
                            "table": table_name,
                            "privileges": permission.get("privileges", []),
                            "source": _permission_source(permission),
                            "principal": permission.get("principal"),
                        })

    access["privileges"] = sorted(access["privileges"])
    return {
        "success": True,
        "scan_complete": True,
        "user": user_info,
        "groups": groups,
        **access,
    }


def _names(values: List[Dict[str, Any]]) -> List[str]:
    return sorted({item.get("name") for item in values if item.get("name")})


def _missing(source: List[str], target: List[str]) -> List[str]:
    return [item for item in source if item not in set(target)]


def compare_users(user1: str, user2: str, scan_permissions: bool = False) -> Dict[str, Any]:
    """
    Compare two users' access profiles and recommend actions to align User B to User A.
    """
    first = get_user_access(user1, scan_permissions=scan_permissions)
    second = get_user_access(user2, scan_permissions=scan_permissions)

    if not first.get("success") or not second.get("success"):
        return {
            "success": False,
            "message": "Unable to compare users because one or both access profiles could not be loaded.",
            "user_a": first,
            "user_b": second,
        }

    comparison = {}
    for category in ("groups", "catalogs", "schemas", "tables"):
        a_values = _names(first.get(category, []))
        b_values = _names(second.get(category, []))
        comparison[category] = {
            "user_a": a_values,
            "user_b": b_values,
            "missing_for_user_b": _missing(a_values, b_values),
            "extra_for_user_b": _missing(b_values, a_values),
        }

    a_privileges = sorted(set(first.get("privileges", [])))
    b_privileges = sorted(set(second.get("privileges", [])))
    comparison["privileges"] = {
        "user_a": a_privileges,
        "user_b": b_privileges,
        "missing_for_user_b": _missing(a_privileges, b_privileges),
        "extra_for_user_b": _missing(b_privileges, a_privileges),
    }

    summary = []
    recommendations = []
    for group in comparison["groups"]["missing_for_user_b"]:
        summary.append(f"{group} group")
        recommendations.append(f"Add User B to {group}")
    for category in ("catalogs", "schemas", "tables"):
        label = category[:-1]
        for item in comparison[category]["missing_for_user_b"]:
            summary.append(f"{item} {label}")
    for privilege in comparison["privileges"]["missing_for_user_b"]:
        summary.append(f"{privilege} privilege")
        recommendations.append(f"Grant {privilege}")

    return {
        "success": True,
        "scan_complete": scan_permissions,
        "user_a": first,
        "user_b": second,
        "comparison": comparison,
        "difference_summary": summary,
        "recommended_actions": recommendations,
    }


def format_api_unavailable_message(error: str = "") -> str:
    """
    Return a user-friendly permissions message for unsupported Databricks editions.
    """
    normalized = (error or "").lower()
    if any(
        marker in normalized
        for marker in (
            "no api found",
            "not found",
            "not supported",
            "feature disabled",
            "permission_denied",
            "not available",
        )
    ):
        return "Permissions are not available for this Databricks edition."

    return "Unable to load permissions."


def infer_principal_type(principal_name: str, principal_data: Any = None) -> str:
    """
    Databricks permissions responses often return principal as a string.
    Keep object-provided type when available and otherwise use conservative hints.
    """
    if isinstance(principal_data, dict):
        explicit_type = (
            principal_data.get("principal_type")
            or principal_data.get("type")
            or principal_data.get("kind")
        )
        if explicit_type:
            return str(explicit_type).title()
        if principal_data.get("user_name") or principal_data.get("userName"):
            return "User"
        if principal_data.get("group_name") or principal_data.get("groupName"):
            return "Group"

    normalized = (principal_name or "").lower()
    if "@" in normalized:
        return "User"
    if normalized in {"account users", "users", "admins", "administrators"}:
        return "Group"

    return "User"


def list_catalogs() -> Dict[str, Any]:
    """
    List all catalogs in the Databricks workspace.
    
    Returns:
        Dict with success status and list of catalog names
    """
    # Check cache first
    cache_key = "catalogs"
    if cache_key in _cache:
        cached_data, cached_time = _cache[cache_key]
        if datetime.now() - cached_time < CACHE_DURATION:
            logger.info("Returning cached catalogs")
            return cached_data
    
    result = make_request("GET", "/api/2.1/unity-catalog/catalogs")
    
    if result["success"]:
        catalogs_data = result["data"]
        # Extract catalog names from the response
        catalogs = [catalog.get("name") for catalog in catalogs_data.get("catalogs", [])]
        
        response_data = {
            "success": True,
            "catalogs": catalogs
        }
        
        # Cache the result
        _cache[cache_key] = (response_data, datetime.now())
        
        return response_data
    
    return {
        "success": False,
        "error": result.get("error", "Failed to list catalogs"),
        "status_code": result.get("status_code")
    }


def list_schemas(catalog_name: str) -> Dict[str, Any]:
    """
    List all schemas in a catalog.
    
    Args:
        catalog_name: Name of the catalog
    
    Returns:
        Dict with success status and list of schemas
    """
    # Check cache first
    cache_key = f"schemas_{catalog_name}"
    if cache_key in _cache:
        cached_data, cached_time = _cache[cache_key]
        if datetime.now() - cached_time < CACHE_DURATION:
            logger.info(f"Returning cached schemas for {catalog_name}")
            return cached_data
    
    params = {"catalog_name": catalog_name}
    result = make_request("GET", "/api/2.1/unity-catalog/schemas", params=params)
    
    if result["success"]:
        schemas_data = result["data"]
        schemas = [
            {
                "name": schema.get("name"),
                "catalog_name": schema.get("catalog_name"),
                "comment": schema.get("comment"),
            }
            for schema in schemas_data.get("schemas", [])
        ]
        
        response_data = {
            "success": True,
            "catalog": catalog_name,
            "schemas": schemas,
        }
        
        # Cache the result
        _cache[cache_key] = (response_data, datetime.now())
        
        return response_data
    
    return {
        "success": False,
        "error": result.get("error", f"Failed to list schemas for catalog {catalog_name}"),
        "status_code": result.get("status_code")
    }


def list_tables(catalog_name: str, schema_name: str) -> Dict[str, Any]:
    """
    List all tables in a schema.
    
    Args:
        catalog_name: Name of the catalog
        schema_name: Name of the schema
    
    Returns:
        Dict with success status and list of tables
    """
    # Check cache first
    cache_key = f"tables_{catalog_name}_{schema_name}"
    if cache_key in _cache:
        cached_data, cached_time = _cache[cache_key]
        if datetime.now() - cached_time < CACHE_DURATION:
            logger.info(f"Returning cached tables for {catalog_name}.{schema_name}")
            return cached_data
    
    params = {
        "catalog_name": catalog_name,
        "schema_name": schema_name
    }
    result = make_request("GET", "/api/2.1/unity-catalog/tables", params=params)
    
    if result["success"]:
        tables_data = result["data"]
        tables = [
            {
                "name": table.get("name"),
                "catalog_name": table.get("catalog_name"),
                "schema_name": table.get("schema_name"),
                "table_type": table.get("table_type", "TABLE"),
                "comment": table.get("comment"),
            }
            for table in tables_data.get("tables", [])
        ]
        
        response_data = {
            "success": True,
            "catalog": catalog_name,
            "schema": schema_name,
            "tables": tables,
        }
        
        # Cache the result
        _cache[cache_key] = (response_data, datetime.now())
        
        return response_data
    
    return {
        "success": False,
        "error": result.get("error", f"Failed to list tables for {catalog_name}.{schema_name}"),
        "status_code": result.get("status_code")
    }


def get_catalog_metadata(catalog_name: str) -> Dict[str, Any]:
    """
    Get detailed metadata for a catalog.
    
    Args:
        catalog_name: Name of the catalog
    
    Returns:
        Dict with catalog metadata
    """
    result = make_request("GET", f"/api/2.1/unity-catalog/catalogs/{quote(catalog_name)}")
    
    if result["success"]:
        catalog_data = result["data"]
        return {
            "success": True,
            "metadata": {
                "name": catalog_data.get("name"),
                "owner": catalog_data.get("owner"),
                "comment": catalog_data.get("comment"),
                "created_at": catalog_data.get("created_at"),
                "updated_at": catalog_data.get("updated_at"),
            }
        }
    
    return {
        "success": False,
        "error": result.get("error", f"Failed to get catalog metadata for {catalog_name}"),
        "status_code": result.get("status_code")
    }


def get_schema_metadata(catalog_name: str, schema_name: str) -> Dict[str, Any]:
    """
    Get detailed metadata for a schema.
    
    Args:
        catalog_name: Name of the catalog
        schema_name: Name of the schema
    
    Returns:
        Dict with schema metadata
    """
    result = make_request("GET", f"/api/2.1/unity-catalog/schemas/{quote(catalog_name)}/{quote(schema_name)}")
    
    if result["success"]:
        schema_data = result["data"]
        return {
            "success": True,
            "metadata": {
                "name": schema_data.get("name"),
                "catalog_name": schema_data.get("catalog_name"),
                "owner": schema_data.get("owner"),
                "comment": schema_data.get("comment"),
                "created_at": schema_data.get("created_at"),
                "updated_at": schema_data.get("updated_at"),
            }
        }
    
    return {
        "success": False,
        "error": result.get("error", f"Failed to get schema metadata for {catalog_name}.{schema_name}"),
        "status_code": result.get("status_code")
    }


def get_table_metadata(catalog_name: str, schema_name: str, table_name: str) -> Dict[str, Any]:
    """
    Get detailed metadata for a table.
    
    Args:
        catalog_name: Name of the catalog
        schema_name: Name of the schema
        table_name: Name of the table
    
    Returns:
        Dict with table metadata
    """
    result = make_request("GET", f"/api/2.1/unity-catalog/tables/{quote(catalog_name)}/{quote(schema_name)}/{quote(table_name)}")
    
    if result["success"]:
        table_data = result["data"]
        return {
            "success": True,
            "metadata": {
                "name": table_data.get("name"),
                "catalog_name": table_data.get("catalog_name"),
                "schema_name": table_data.get("schema_name"),
                "owner": table_data.get("owner"),
                "comment": table_data.get("comment"),
                "table_type": table_data.get("table_type"),
                "created_at": table_data.get("created_at"),
                "updated_at": table_data.get("updated_at"),
                "storage_location": table_data.get("storage_location"),
                "data_source_format": table_data.get("data_source_format"),
                "columns": table_data.get("columns", []),
                "properties": table_data.get("properties", {}),
            }
        }
    
    return {
        "success": False,
        "error": result.get("error", f"Failed to get table metadata for {catalog_name}.{schema_name}.{table_name}"),
        "status_code": result.get("status_code")
    }


def get_permissions(object_type: str, object_name: str) -> Dict[str, Any]:
    """
    Get permissions for a Unity Catalog object.
    
    Args:
        object_type: Type of object (catalogs, schemas, tables)
        object_name: Full name of the object (e.g., "catalog.schema.table")
    
    Returns:
        Dict with permissions list
    """
    result = make_request("GET", f"/api/2.1/unity-catalog/permissions/{object_type}/{quote(object_name)}")
    
    if result["success"]:
        permissions_data = result["data"]
        permissions = []
        raw_assignments = (
            permissions_data.get("permission_assignments")
            or permissions_data.get("privilege_assignments")
            or []
        )

        for perm in raw_assignments:
            principal = perm.get("principal")
            if isinstance(principal, dict):
                principal_name = (
                    principal.get("display_name")
                    or principal.get("user_name")
                    or principal.get("userName")
                    or principal.get("group_name")
                    or principal.get("groupName")
                    or principal.get("name")
                    or "unknown"
                )
            else:
                principal_name = principal or "unknown"
            principal_type = (
                perm.get("principal_type")
                or infer_principal_type(principal_name, principal)
            )

            privileges = []
            raw_privileges = perm.get("privileges") or perm.get("all_permissions") or []
            for privilege in raw_privileges:
                if isinstance(privilege, dict):
                    privileges.append(
                        privilege.get("privilege")
                        or privilege.get("name")
                        or privilege.get("permission")
                        or str(privilege)
                    )
                else:
                    privileges.append(privilege)

            permissions.append({
                "principal": principal_name,
                "principal_type": principal_type,
                "privileges": privileges,
            })
        
        return {
            "success": True,
            "permissions": permissions
        }
    
    return {
        "success": False,
        "error": result.get("error", f"Failed to get permissions for {object_name}"),
        "message": format_api_unavailable_message(result.get("error", "")),
        "status_code": result.get("status_code")
    }


def get_catalog_binding(catalog_name: str) -> Dict[str, Any]:
    """
    Get workspace access information for a catalog.
    
    Args:
        catalog_name: Name of the catalog
    
    Returns:
        Dict with workspace access information
    """
    binding_endpoints = [
        f"/api/2.1/unity-catalog/bindings/catalog/{quote(catalog_name)}",
        f"/api/2.1/unity-catalog/workspace-bindings/catalog/{quote(catalog_name)}",
        f"/api/2.1/unity-catalog/workspace-bindings/catalogs/{quote(catalog_name)}/bindings",
    ]
    result = None
    for endpoint in binding_endpoints:
        result = make_request("GET", endpoint)
        if result["success"]:
            break

    if result and result["success"]:
        bindings_data = result["data"]
        raw_bindings = (
            bindings_data.get("bindings")
            or bindings_data.get("workspace_bindings")
            or []
        )
        bindings = [
            {
                "workspace_name": (
                    binding.get("workspace_name")
                    or binding.get("workspace_id")
                    or "Workspace"
                ),
                "workspace_id": binding.get("workspace_id"),
                "access_level": (
                    binding.get("binding_type")
                    or binding.get("access_level")
                    or binding.get("permissions")
                    or "AVAILABLE"
                ),
            }
            for binding in raw_bindings
        ]

        return {
            "success": True,
            "bindings": bindings,
            "bundles": bindings,
        }

    return {
        "success": False,
        "error": (result or {}).get("error", f"Failed to get workspace access for {catalog_name}"),
        "status_code": (result or {}).get("status_code")
    }


def get_schema_objects(catalog_name: str, schema_name: str) -> Dict[str, Any]:
    """
    Get objects in a schema.
    
    Args:
        catalog_name: Name of the catalog
        schema_name: Name of the schema
    
    Returns:
        Dict with list of objects
    """
    result = make_request("GET", f"/api/2.1/unity-catalog/tables", params={
        "catalog_name": catalog_name,
        "schema_name": schema_name
    })
    
    if result["success"]:
        tables_data = result["data"]
        objects = []
        for table in tables_data.get("tables", []):
            objects.append({
                "object_name": table.get("name"),
                "object_type": table.get("table_type", "TABLE"),
                "created_date": table.get("created_at"),
            })
        
        return {
            "success": True,
            "objects": objects
        }
    
    return {
        "success": False,
        "error": result.get("error", f"Failed to get objects for {catalog_name}.{schema_name}"),
        "status_code": result.get("status_code")
    }


def get_table_statistics(catalog_name: str, schema_name: str, table_name: str) -> Dict[str, Any]:
    """
    Get statistics for a table.
    
    Args:
        catalog_name: Name of the catalog
        schema_name: Name of the schema
        table_name: Name of the table
    
    Returns:
        Dict with table statistics
    """
    metadata_result = get_table_metadata(catalog_name, schema_name, table_name)

    if metadata_result.get("success"):
        metadata = metadata_result.get("metadata", {})
        columns = metadata.get("columns") or []
        properties = metadata.get("properties") or {}

        total_rows = (
            properties.get("numRows")
            or properties.get("delta.numRecords")
            or properties.get("spark.sql.statistics.numRows")
        )
        size_bytes = (
            properties.get("totalSize")
            or properties.get("delta.sizeInBytes")
            or properties.get("spark.sql.statistics.totalSize")
        )

        try:
            size_in_mb = round(float(size_bytes) / (1024 * 1024), 2) if size_bytes else None
        except (TypeError, ValueError):
            size_in_mb = None

        return {
            "success": True,
            "statistics": {
                "total_rows": int(total_rows) if str(total_rows or "").isdigit() else total_rows,
                "total_columns": len(columns) if columns else None,
                "storage_format": metadata.get("data_source_format"),
                "table_type": metadata.get("table_type"),
                "last_modified": metadata.get("updated_at"),
                "size_in_mb": size_in_mb,
            }
        }

    return {
        "success": False,
        "error": metadata_result.get(
            "error",
            f"Failed to get statistics for {catalog_name}.{schema_name}.{table_name}"
        ),
        "status_code": metadata_result.get("status_code")
    }


def preview_table_data(
    catalog_name: str,
    schema_name: str,
    table_name: str,
    limit: int = 25
) -> Dict[str, Any]:
    """
    Preview data from a table using SQL warehouse.
    
    Args:
        catalog_name: Name of the catalog
        schema_name: Name of the schema
        table_name: Name of the table
        limit: Maximum number of rows to return
    
    Returns:
        Dict with success status, columns, and rows
    """
    # First, get available warehouses
    warehouses_result = make_request("GET", "/api/2.0/sql/warehouses")
    
    if not warehouses_result["success"]:
        return {
            "success": False,
            "error": "Failed to retrieve SQL warehouses",
            "status_code": warehouses_result.get("status_code")
        }
    
    warehouses = warehouses_result["data"].get("warehouses", [])
    if not warehouses:
        return {
            "success": False,
            "error": "No SQL warehouse is available in this workspace."
        }
    
    # Find a running warehouse or use the first one
    running = next(
        (w for w in warehouses if w.get("state", "").upper().endswith("RUNNING")),
        None
    )
    warehouse = running or warehouses[0]
    warehouse_id = warehouse.get("id")
    
    # Quote identifiers for SQL
    def quote_identifier(value: str) -> str:
        return f"`{value.replace('`', '``')}`"
    
    full_table_name = ".".join(
        quote_identifier(value)
        for value in (catalog_name, schema_name, table_name)
    )
    
    # Execute SQL statement
    sql_statement = f"SELECT * FROM {full_table_name} LIMIT {limit}"
    statement_payload = {
        "statement": sql_statement,
        "warehouse_id": warehouse_id,
        "wait_timeout": "30s"
    }
    
    result = make_request(
        "POST",
        "/api/2.0/sql/statements",
        json_data=statement_payload
    )
    
    if not result["success"]:
        return {
            "success": False,
            "error": result.get("error", "Failed to execute query"),
            "status_code": result.get("status_code")
        }
    
    statement_data = result["data"]
    status = statement_data.get("status", {})
    state = status.get("state", "")
    
    if state != "SUCCEEDED":
        error_message = status.get("error", {}).get("message", f"Query did not complete successfully ({state})")
        return {
            "success": False,
            "error": error_message
        }
    
    # Extract columns and rows
    manifest = statement_data.get("manifest", {})
    schema = manifest.get("schema", {})
    columns = [
        {
            "name": col.get("name"),
            "type": col.get("type_text") or str(col.get("type_name", ""))
        }
        for col in schema.get("columns", [])
    ]
    
    rows = statement_data.get("result", {}).get("data_array", [])
    
    return {
        "success": True,
        "catalog": catalog_name,
        "schema": schema_name,
        "table": table_name,
        "warehouse_id": warehouse_id,
        "columns": columns,
        "rows": rows or [],
        "limit": limit,
    }
