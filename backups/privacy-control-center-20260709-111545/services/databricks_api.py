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
            "details": error_detail if "error_detail" in locals() else None,
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


def _normalize_group(group: Dict[str, Any]) -> Dict[str, Any]:
    members = group.get("members") or []
    return {
        "id": group.get("id"),
        "name": group.get("displayName") or group.get("name"),
        "displayName": group.get("displayName") or group.get("name"),
        "description": group.get("description") or group.get("externalId") or "",
        "created_at": (group.get("meta") or {}).get("created"),
        "updated_at": (group.get("meta") or {}).get("lastModified"),
        "member_count": len(members),
        "members": members,
        "group_type": "System" if str(group.get("displayName") or "").lower() in {"account users", "admins", "users"} else "Custom",
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


def list_groups(search: str = "") -> Dict[str, Any]:
    """
    Return SCIM groups with short caching to keep user comparison responsive.
    """
    cache_key = "scim_groups"
    if cache_key in _cache and datetime.now() - _cache[cache_key][1] < CACHE_DURATION:
        groups = _cache[cache_key][0]
        if search:
            normalized = search.lower()
            groups = [
                group for group in groups
                if normalized in str(group.get("displayName") or group.get("name") or "").lower()
            ]
        return {
            "success": True,
            "groups": groups,
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
    if search:
        normalized = search.lower()
        groups = [
            group for group in groups
            if normalized in str(group.get("displayName") or group.get("name") or "").lower()
        ]
    return {
        "success": True,
        "groups": groups,
    }


def list_group_summaries(search: str = "") -> Dict[str, Any]:
    result = list_groups(search)
    if not result.get("success"):
        return result
    return {
        "success": True,
        "groups": [_normalize_group(group) for group in result.get("groups", [])],
        "capabilities": {
            "read": True,
            "create": True,
            "rename": True,
            "delete": True,
            "membership": True,
            "description": False,
            "member_roles": False,
        },
    }


def get_group_by_id(group_id: str) -> Dict[str, Any]:
    result = make_request("GET", f"/api/2.0/preview/scim/v2/Groups/{quote(group_id)}")
    if result.get("success"):
        return {
            "success": True,
            "group": _normalize_group(result.get("data", {})),
        }
    return {
        "success": False,
        "message": _format_group_management_error(result),
        "error": result.get("error"),
        "status_code": result.get("status_code"),
    }


def _format_group_management_error(result: Dict[str, Any]) -> str:
    status_code = result.get("status_code")
    details = result.get("details") or {}
    error = str(result.get("error") or details.get("message") or "")
    normalized = f"{details.get('error_code', '')} {error}".lower()

    if status_code == 400:
        return "The group request is invalid."
    if status_code == 401:
        return "Databricks authentication failed. Check the configured token."
    if status_code == 403:
        return "Group management is not supported by the connected Databricks workspace or your identity lacks permission."
    if status_code == 404:
        return "Group or user was not found in the connected Databricks workspace."
    if status_code == 409 or "already" in normalized:
        return "A group with this name already exists."
    if status_code == 501:
        return "Group management is not supported by the connected Databricks workspace."
    if status_code and status_code >= 500:
        return "Databricks returned a server error while managing the group."
    return error or "Unable to manage this group."


def create_group(display_name: str, description: str = "") -> Dict[str, Any]:
    display_name = (display_name or "").strip()
    if not display_name:
        return {"success": False, "message": "Group name is required.", "status_code": 400}

    existing = list_group_summaries(display_name)
    if existing.get("success") and any(
        str(group.get("name") or "").lower() == display_name.lower()
        for group in existing.get("groups", [])
    ):
        return {"success": False, "message": "A group with this name already exists.", "status_code": 409}

    payload = {
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        "displayName": display_name,
    }
    if description:
        payload["externalId"] = description

    result = make_request("POST", "/api/2.0/preview/scim/v2/Groups", json_data=payload)
    if result.get("success"):
        _cache.pop("scim_groups", None)
        return {
            "success": True,
            "message": "Group created successfully.",
            "group": _normalize_group(result.get("data", {})),
            "status_code": result.get("status_code"),
        }
    return {
        "success": False,
        "message": _format_group_management_error(result),
        "error": result.get("error"),
        "status_code": result.get("status_code"),
    }


def update_group(group_id: str, display_name: str, description: str = "") -> Dict[str, Any]:
    if not group_id:
        return {"success": False, "message": "Group id is required.", "status_code": 400}
    if not display_name:
        return {"success": False, "message": "Group name is required.", "status_code": 400}

    operations = [{"op": "replace", "path": "displayName", "value": display_name}]
    if description:
        operations.append({"op": "replace", "path": "externalId", "value": description})

    payload = {
        "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        "Operations": operations,
    }
    result = make_request("PATCH", f"/api/2.0/preview/scim/v2/Groups/{quote(group_id)}", json_data=payload)
    if result.get("success"):
        _cache.pop("scim_groups", None)
        return {
            "success": True,
            "message": "Group updated successfully.",
            "group": _normalize_group(result.get("data", {})),
            "status_code": result.get("status_code"),
        }
    return {
        "success": False,
        "message": _format_group_management_error(result),
        "error": result.get("error"),
        "status_code": result.get("status_code"),
    }


def delete_group(group_id: str) -> Dict[str, Any]:
    result = make_request("DELETE", f"/api/2.0/preview/scim/v2/Groups/{quote(group_id)}")
    if result.get("success") or result.get("status_code") == 204:
        _cache.pop("scim_groups", None)
        return {"success": True, "message": "Group deleted successfully.", "status_code": result.get("status_code")}
    return {
        "success": False,
        "message": _format_group_management_error(result),
        "error": result.get("error"),
        "status_code": result.get("status_code"),
    }


def add_user_to_group(group_id: str, user: str, role: str = "Member") -> Dict[str, Any]:
    if role and role.lower() != "member":
        return {
            "success": False,
            "message": "Databricks SCIM groups do not support per-member roles. Add the user as Member.",
            "status_code": 400,
        }

    user_result = _find_user(user)
    user_info = user_result.get("user") if user_result.get("success") else None
    if not user_info:
        return {"success": False, "message": "User was not found in this Databricks workspace.", "status_code": 404}

    payload = {
        "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        "Operations": [{
            "op": "add",
            "path": "members",
            "value": [{
                "value": user_info.get("id"),
                "display": user_info.get("email") or user_info.get("name"),
            }],
        }],
    }
    result = make_request("PATCH", f"/api/2.0/preview/scim/v2/Groups/{quote(group_id)}", json_data=payload)
    if result.get("success"):
        _cache.pop("scim_groups", None)
        return {
            "success": True,
            "message": "User added to group successfully.",
            "group": _normalize_group(result.get("data", {})),
            "status_code": result.get("status_code"),
        }
    return {
        "success": False,
        "message": _format_group_management_error(result),
        "error": result.get("error"),
        "status_code": result.get("status_code"),
    }


def remove_user_from_group(group_id: str, user_id: str) -> Dict[str, Any]:
    payload = {
        "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        "Operations": [{
            "op": "remove",
            "path": f'members[value eq "{user_id}"]',
        }],
    }
    result = make_request("PATCH", f"/api/2.0/preview/scim/v2/Groups/{quote(group_id)}", json_data=payload)
    if result.get("success"):
        _cache.pop("scim_groups", None)
        return {
            "success": True,
            "message": "User removed from group successfully.",
            "group": _normalize_group(result.get("data", {})),
            "status_code": result.get("status_code"),
        }
    return {
        "success": False,
        "message": _format_group_management_error(result),
        "error": result.get("error"),
        "status_code": result.get("status_code"),
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


def _find_group(group: str) -> Dict[str, Any]:
    groups_result = list_groups(group)
    if not groups_result.get("success"):
        return groups_result

    normalized = group.lower()
    groups = groups_result.get("groups", [])
    exact = next(
        (
            item for item in groups
            if str(item.get("displayName") or item.get("name") or "").lower() == normalized
        ),
        None,
    )

    return {
        "success": True,
        "group": exact,
    }


def _resolve_permission_principal(principal: str, principal_type: Optional[str] = None) -> Dict[str, Any]:
    if str(principal_type or "").lower() != "group":
        return {
            "success": True,
            "principal": principal,
        }

    if principal.strip().lower() in {"account users"}:
        return {
            "success": True,
            "principal": principal.strip(),
            "principal_source": "unity_catalog_builtin",
        }

    group_result = _find_group(principal)
    if not group_result.get("success"):
        return {
            "success": False,
            "message": group_result.get("message", "Unable to validate this Databricks group."),
            "error": group_result.get("error"),
            "status_code": group_result.get("status_code", 503),
        }

    group_info = group_result.get("group")
    if not group_info:
        return {
            "success": False,
            "message": f"Group '{principal}' was not found in this Databricks workspace.",
            "status_code": 404,
        }

    return {
        "success": True,
        "principal": group_info.get("displayName") or group_info.get("name") or principal,
        "group": _normalize_group(group_info),
        "principal_source": "workspace_scim",
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


def get_group_members(group_name: str) -> Dict[str, Any]:
    """
    Return members for a Databricks SCIM group.
    """
    groups_result = list_groups()
    if not groups_result.get("success"):
        return {
            "success": False,
            "group": group_name,
            "members": [],
            "message": groups_result.get(
                "message",
                "This information is not available in the current Databricks edition.",
            ),
        }

    normalized = group_name.lower()
    groups = groups_result.get("groups", [])
    group = next(
        (
            item for item in groups
            if str(item.get("displayName") or item.get("name") or "").lower() == normalized
        ),
        None,
    ) or next(
        (
            item for item in groups
            if normalized in str(item.get("displayName") or item.get("name") or "").lower()
        ),
        None,
    )

    if not group:
        return {
            "success": False,
            "group": group_name,
            "members": [],
            "message": "Group was not found in this Databricks workspace.",
        }

    members = []
    for member in group.get("members") or []:
        if not isinstance(member, dict):
            continue
        members.append({
            "id": member.get("value"),
            "name": member.get("display") or member.get("$ref") or member.get("value"),
            "email": member.get("display") or member.get("value"),
        })

    return {
        "success": True,
        "group": group.get("displayName") or group.get("name") or group_name,
        "members": members,
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


def _group_permission_matches(permission: Dict[str, Any], group_name: str) -> bool:
    return (
        str(permission.get("principal_type", "")).lower() == "group"
        and str(permission.get("principal", "")).lower() == group_name.lower()
    )


def get_group_permissions(group_name: str, scan_permissions: bool = False) -> Dict[str, Any]:
    """
    Scan Unity Catalog permissions that are granted directly to a SCIM group.
    """
    group_name = (group_name or "").strip()
    if not group_name:
        return {
            "success": False,
            "message": "Group name is required.",
            "permissions": [],
            "status_code": 400,
        }

    if not scan_permissions:
        return {
            "success": True,
            "scan_complete": False,
            "message": "Group permissions scan is available with scan=true.",
            "group": group_name,
            "permissions": [],
        }

    permissions = []
    catalogs_result = list_catalogs()
    if not catalogs_result.get("success"):
        return {
            "success": False,
            "message": "Group permissions could not be scanned for this workspace.",
            "permissions": [],
            "status_code": catalogs_result.get("status_code"),
            "error": catalogs_result.get("error"),
        }

    for catalog_name in catalogs_result.get("catalogs", []):
        catalog_permissions = get_permissions("catalog", catalog_name)
        for permission in catalog_permissions.get("permissions", []):
            if _group_permission_matches(permission, group_name):
                permissions.append({
                    "object_type": "Catalog",
                    "name": catalog_name,
                    "catalog": catalog_name,
                    "schema": "",
                    "table": "",
                    "privileges": permission.get("privileges", []),
                    "source": "Direct",
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
                if _group_permission_matches(permission, group_name):
                    permissions.append({
                        "object_type": "Schema",
                        "name": full_schema,
                        "catalog": catalog_name,
                        "schema": schema_name,
                        "table": "",
                        "privileges": permission.get("privileges", []),
                        "source": "Direct",
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
                    if _group_permission_matches(permission, group_name):
                        permissions.append({
                            "object_type": "Table",
                            "name": full_table,
                            "catalog": catalog_name,
                            "schema": schema_name,
                            "table": table_name,
                            "privileges": permission.get("privileges", []),
                            "source": "Direct",
                            "principal": permission.get("principal"),
                        })

    return {
        "success": True,
        "scan_complete": True,
        "group": group_name,
        "permissions": permissions,
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


UC_PRIVILEGE_REGISTRY = {
    "catalog": [
        {
            "group": "Prerequisite",
            "privileges": [
                {"name": "USE_CATALOG", "description": "Use the catalog and discover child objects when paired with child privileges."},
            ],
        },
        {
            "group": "Metadata",
            "privileges": [
                {"name": "BROWSE", "description": "Browse metadata in Catalog Explorer."},
                {"name": "READ_METADATA", "description": "Read metadata where supported by the workspace."},
            ],
        },
        {
            "group": "Create",
            "privileges": [
                {"name": "CREATE_SCHEMA", "description": "Create schemas in this catalog."},
                {"name": "CREATE_TABLE", "description": "Create tables where applicable."},
                {"name": "CREATE_VIEW", "description": "Create views where applicable."},
                {"name": "CREATE_FUNCTION", "description": "Create functions where applicable."},
                {"name": "CREATE_MODEL", "description": "Create models where applicable."},
                {"name": "CREATE_VOLUME", "description": "Create volumes where applicable."},
                {"name": "CREATE_FOREIGN_SECURABLE", "description": "Create foreign securables where applicable."},
            ],
        },
        {
            "group": "Edit",
            "privileges": [
                {"name": "APPLY_TAG", "description": "Apply governed tags."},
                {"name": "MANAGE", "description": "Manage grants on this securable."},
                {"name": "ALL_PRIVILEGES", "description": "Grant all current and future privileges except excluded sensitive privileges."},
            ],
        },
    ],
    "schema": [
        {
            "group": "Prerequisite",
            "privileges": [
                {"name": "USE_SCHEMA", "description": "Use the schema and discover child objects when paired with child privileges."},
            ],
        },
        {
            "group": "Metadata",
            "privileges": [
                {"name": "BROWSE", "description": "Browse metadata in Catalog Explorer."},
                {"name": "READ_METADATA", "description": "Read metadata where supported by the workspace."},
            ],
        },
        {
            "group": "Read",
            "privileges": [
                {"name": "SELECT", "description": "Read rows from tables and views."},
                {"name": "EXECUTE", "description": "Execute functions."},
                {"name": "READ_VOLUME", "description": "Read volume files."},
            ],
        },
        {
            "group": "Edit",
            "privileges": [
                {"name": "MODIFY", "description": "Modify table data."},
                {"name": "REFRESH", "description": "Refresh materialized views or streaming tables where applicable."},
                {"name": "WRITE_VOLUME", "description": "Write volume files."},
                {"name": "APPLY_TAG", "description": "Apply governed tags."},
                {"name": "MANAGE", "description": "Manage grants on this securable."},
                {"name": "ALL_PRIVILEGES", "description": "Grant all current and future privileges except excluded sensitive privileges."},
            ],
        },
        {
            "group": "Create",
            "privileges": [
                {"name": "CREATE_TABLE", "description": "Create tables."},
                {"name": "CREATE_VIEW", "description": "Create views."},
                {"name": "CREATE_FUNCTION", "description": "Create functions."},
                {"name": "CREATE_MODEL", "description": "Create models."},
                {"name": "CREATE_VOLUME", "description": "Create volumes."},
            ],
        },
    ],
    "table": [
        {
            "group": "Metadata",
            "privileges": [
                {"name": "BROWSE", "description": "Browse metadata in Catalog Explorer."},
                {"name": "READ_METADATA", "description": "Read metadata where supported by the workspace."},
            ],
        },
        {
            "group": "Read",
            "privileges": [
                {"name": "SELECT", "description": "Read rows from this table or view."},
            ],
        },
        {
            "group": "Edit",
            "privileges": [
                {"name": "MODIFY", "description": "Modify table data."},
                {"name": "REFRESH", "description": "Refresh materialized views or streaming tables where applicable."},
                {"name": "APPLY_TAG", "description": "Apply governed tags."},
                {"name": "MANAGE", "description": "Manage grants on this securable."},
                {"name": "ALL_PRIVILEGES", "description": "Grant all current and future privileges except excluded sensitive privileges."},
            ],
        },
    ],
}


def get_available_privileges(securable_type: str) -> Dict[str, Any]:
    """
    Return grouped Unity Catalog privileges for the requested securable.

    Databricks Grants API exposes get/update permissions, but it does not expose
    a workspace endpoint that lists valid privilege levels for Unity Catalog
    securables. Keep this registry centralized in the backend so the frontend
    never hardcodes privilege lists.
    """
    normalized = (securable_type or "").lower()
    logger.info(
        "Resolving available Unity Catalog privileges for securable_type=%s",
        normalized,
    )
    groups = UC_PRIVILEGE_REGISTRY.get(normalized)
    if not groups:
        logger.warning(
            "Unsupported Unity Catalog privilege registry request: securable_type=%s",
            securable_type,
        )
        return {
            "success": False,
            "message": f"Unsupported securable type: {securable_type}",
            "groups": [],
        }

    logger.info(
        "Returning %s privilege groups for securable_type=%s from backend registry",
        len(groups),
        normalized,
    )
    return {
        "success": True,
        "securable_type": normalized,
        "source": "backend_registry",
        "source_reason": (
            "The current Databricks Unity Catalog Grants REST API does not expose "
            "an available-privileges endpoint for securables."
        ),
        "groups": groups,
    }


def _normalize_permissions_response(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    permissions = []
    raw_assignments = (
        data.get("permission_assignments")
        or data.get("privilege_assignments")
        or []
    )
    for perm in raw_assignments:
        principal = perm.get("principal")
        principal_name = principal if not isinstance(principal, dict) else (
            principal.get("display_name")
            or principal.get("user_name")
            or principal.get("userName")
            or principal.get("group_name")
            or principal.get("groupName")
            or principal.get("name")
            or "unknown"
        )
        raw_privileges = perm.get("privileges") or perm.get("all_permissions") or []
        privileges = []
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
            "principal_type": perm.get("principal_type") or infer_principal_type(principal_name, principal),
            "privileges": privileges,
        })
    return permissions


def _format_permission_write_error(
    result: Dict[str, Any],
    principal: str = "",
    principal_type: Optional[str] = None,
    principal_source: str = "",
) -> str:
    status_code = result.get("status_code")
    details = result.get("details") or {}
    error = str(result.get("error") or details.get("message") or "")
    error_code = str(details.get("error_code") or "").upper()
    normalized = f"{error_code} {error}".lower()

    if status_code == 400:
        if "principal" in normalized:
            return "Principal not found or is not valid for this workspace."
        if "privilege" in normalized:
            return "Invalid privilege for the selected securable."
        return "The permission request is invalid."
    if status_code == 401:
        return "Databricks authentication failed. Check the configured token."
    if status_code == 403:
        return "Permission denied. Your Databricks identity cannot manage grants for this securable."
    if status_code == 404:
        if str(principal_type or "").lower() == "group" and principal_source == "workspace_scim":
            return (
                f"Group '{principal}' exists as a workspace group, but Databricks Unity Catalog "
                "did not recognize it as a grantable principal. Use an account-level group or "
                "a group that already appears in Unity Catalog permissions."
            )
        if "principal" in normalized or "group" in normalized or "user" in normalized:
            return "Principal was not found in this Databricks workspace."
        if "feature" in normalized or "disabled" in normalized:
            return "Unity Catalog permission management is not enabled for this workspace."
        return "Catalog object not found or the permissions API is unavailable."
    if status_code == 409:
        return "Permission already exists or conflicts with the current Databricks state."
    if status_code == 501:
        return "Unity Catalog permission writes are not supported in this Databricks workspace."
    if status_code and status_code >= 500:
        return "Databricks returned a server error while updating permissions."

    return error or "Unable to update permissions."


def _update_permissions(
    securable_type: str,
    full_name: str,
    changes: List[Dict[str, Any]],
    principal_type: Optional[str] = None,
    principal_source: str = "",
) -> Dict[str, Any]:
    payload = {
        "changes": changes,
        "omit_permissions_in_response": False,
    }
    endpoint = f"/api/2.1/unity-catalog/permissions/{quote(securable_type)}/{quote(full_name, safe='')}"
    result = make_request("PATCH", endpoint, json_data=payload)

    if result.get("success"):
        _cache.clear()
        return {
            "success": True,
            "message": "Permissions updated successfully.",
            "permissions": _normalize_permissions_response(result.get("data", {})),
            "raw": result.get("data", {}),
            "status_code": result.get("status_code"),
        }

    return {
        "success": False,
        "message": _format_permission_write_error(
            result,
            changes[0].get("principal", "") if changes else "",
            principal_type,
            principal_source,
        ),
        "error": result.get("error"),
        "details": result.get("details"),
        "status_code": result.get("status_code"),
    }


def grant_permissions(
    securable_type: str,
    full_name: str,
    principal: str,
    privileges: List[str],
    principal_type: Optional[str] = None,
) -> Dict[str, Any]:
    privileges = sorted({privilege for privilege in privileges if privilege})
    if not principal or not privileges:
        return {"success": False, "message": "Principal and at least one privilege are required.", "status_code": 400}

    resolved = _resolve_permission_principal(principal, principal_type)
    if not resolved.get("success"):
        return resolved

    resolved_principal = resolved.get("principal", principal)
    return _update_permissions(securable_type, full_name, [{
        "principal": resolved_principal,
        "add": privileges,
    }], principal_type, resolved.get("principal_source", ""))


def update_principal_permissions(
    securable_type: str,
    full_name: str,
    principal: str,
    privileges: List[str],
    principal_type: Optional[str] = None,
) -> Dict[str, Any]:
    current = get_permissions(securable_type, full_name)
    if not current.get("success"):
        return current

    existing_principal = next(
        (
            item.get("principal")
            for item in current.get("permissions", [])
            if str(item.get("principal_type") or "").lower() == str(principal_type or "").lower()
            and str(item.get("principal") or "").lower() == principal.lower()
        ),
        None,
    )
    resolved = {"success": True, "principal": existing_principal, "principal_source": "existing_permission"} if existing_principal else _resolve_permission_principal(principal, principal_type)
    if not resolved.get("success"):
        return resolved
    principal = resolved.get("principal", principal)

    existing = next(
        (
            item for item in current.get("permissions", [])
            if str(item.get("principal") or "").lower() == principal.lower()
        ),
        None,
    )
    current_privileges = set(existing.get("privileges", [])) if existing else set()
    requested_privileges = {privilege for privilege in privileges if privilege}
    to_add = sorted(requested_privileges - current_privileges)
    to_remove = sorted(current_privileges - requested_privileges)

    if not to_add and not to_remove:
        return {
            "success": True,
            "message": "Permissions are already up to date.",
            "permissions": current.get("permissions", []),
            "added": [],
            "removed": [],
            "status_code": 200,
        }

    change = {"principal": principal}
    if to_add:
        change["add"] = to_add
    if to_remove:
        change["remove"] = to_remove

    result = _update_permissions(
        securable_type,
        full_name,
        [change],
        principal_type,
        resolved.get("principal_source", ""),
    )
    result["added"] = to_add
    result["removed"] = to_remove
    return result


def remove_principal_permissions(
    securable_type: str,
    full_name: str,
    principal: str,
    principal_type: Optional[str] = None,
) -> Dict[str, Any]:
    current = get_permissions(securable_type, full_name)
    if not current.get("success"):
        return current

    existing_principal = next(
        (
            item.get("principal")
            for item in current.get("permissions", [])
            if str(item.get("principal_type") or "").lower() == str(principal_type or "").lower()
            and str(item.get("principal") or "").lower() == principal.lower()
        ),
        None,
    )
    resolved = {"success": True, "principal": existing_principal, "principal_source": "existing_permission"} if existing_principal else _resolve_permission_principal(principal, principal_type)
    if not resolved.get("success"):
        return resolved
    principal = resolved.get("principal", principal)

    existing = next(
        (
            item for item in current.get("permissions", [])
            if str(item.get("principal") or "").lower() == principal.lower()
        ),
        None,
    )
    privileges = sorted(set(existing.get("privileges", []))) if existing else []
    if not privileges:
        return {
            "success": True,
            "message": "Access is already removed.",
            "permissions": current.get("permissions", []),
            "removed": [],
            "status_code": 200,
        }

    result = _update_permissions(securable_type, full_name, [{
        "principal": principal,
        "remove": privileges,
    }], principal_type, resolved.get("principal_source", ""))
    result["removed"] = privileges
    return result


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
