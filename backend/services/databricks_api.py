import os
import requests
import logging
from typing import Optional, Dict, Any, List
from dotenv import load_dotenv
from functools import lru_cache
from datetime import datetime, timedelta
from urllib.parse import quote
from services.workspace_auth import (
    WorkspaceAuthError,
    get_workspace_credentials,
    refresh_workspace_credentials,
    workspace_identity,
)

load_dotenv()

# Configure logging
logger = logging.getLogger(__name__)

# Simple in-memory cache for API responses
_cache = {}
# Governance views should reflect the connected workspace on every request.
CACHE_DURATION = timedelta(seconds=0)
LIVE_SCAN_MAX_SECONDS = int(os.getenv("USER_ACCESS_SCAN_MAX_SECONDS", "60"))
LIVE_SCAN_REQUEST_TIMEOUT = int(os.getenv("USER_ACCESS_SCAN_REQUEST_TIMEOUT", "10"))
LIVE_SCAN_MAX_OBJECTS = int(os.getenv("USER_ACCESS_SCAN_MAX_OBJECTS", "1000"))


def get_auth_headers(token: str) -> Dict[str, str]:
    """
    Get authentication headers for Databricks REST API requests.
    
    Returns:
        Dict with Authorization and Content-Type headers
    """
    return {
        "Authorization": f"Bearer {token}",
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
    try:
        workspace_host, token = get_workspace_credentials()
        url = f"{workspace_host}{endpoint}"
        logger.info(f"Making {method} request to: {url}")
        
        response = requests.request(
            method=method,
            url=url,
            headers=get_auth_headers(token),
            params=params,
            json=json_data,
            timeout=timeout
        )
        
        logger.info(f"Response status: {response.status_code}")

        # A token can be revoked before its advertised expiry. Refresh once and
        # retry transparently so callers never need to restart the application.
        if response.status_code == 401:
            workspace_host, token = refresh_workspace_credentials()
            url = f"{workspace_host}{endpoint}"
            response = requests.request(
                method=method,
                url=url,
                headers=get_auth_headers(token),
                params=params,
                json=json_data,
                timeout=timeout,
            )
            logger.info("Retry response status: %s", response.status_code)

        try:
            parsed_response = response.json()
            logger.info("Parsed Databricks response for %s: %s", endpoint, parsed_response)
        except ValueError:
            logger.info("Databricks response for %s was not JSON: %s", endpoint, response.text[:1000])
        
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
        
        logger.error(
            "Databricks REST request failed: endpoint=%s status=%s error=%s",
            endpoint,
            response.status_code,
            error_msg,
        )
        
        return {
            "success": False,
            "error": error_msg,
            "details": error_detail if "error_detail" in locals() else None,
            "status_code": response.status_code
        }
    
    except WorkspaceAuthError as exc:
        return {"success": False, "error": str(exc), "status_code": 409}

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
    
    logger.warning("Unable to retrieve the authenticated Databricks identity")
    return {
        "success": False,
        "user": "",
        "display_name": "",
        "active": False,
        "message": "Unable to connect to Databricks Workspace.",
    }


def get_workspace() -> Dict[str, Any]:
    """
    Return the configured Databricks workspace identity for the frontend selector.
    """
    verification = make_request("GET", "/api/2.0/workspace/get-status", params={"path": "/"})
    if not verification.get("success"):
        return {
            "success": False,
            "message": "Unable to connect to Databricks Workspace.",
            "error": verification.get("error"),
            "workspaces": [],
        }
    workspace = workspace_identity()
    return {"success": True, "connected": True, "workspaces": [{
        **workspace,
        "name": workspace["workspace_name"],
        "display_name": workspace["workspace_name"],
        "host": workspace["workspace_url"],
    }]}


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
        "grantable": True,
        "grantability_reason": "User",
        "grantability_label": "User",
    }


def _classify_group_grantability(group: Dict[str, Any]) -> Dict[str, Any]:
    name = group.get("displayName") or group.get("name") or ""
    normalized_name = str(name).lower()
    resource_type = str((group.get("meta") or {}).get("resourceType") or "").lower()

    if normalized_name == "account users":
        return {
            "grantable": True,
            "reason": "Account Group",
            "label": "Account Group",
            "message": "This account group can receive Unity Catalog permissions.",
        }

    if resource_type == "workspacegroup":
        return {
            "grantable": False,
            "reason": "Workspace Group",
            "label": "Workspace Group",
            "message": "This group exists only in the workspace and cannot receive Unity Catalog permissions.",
        }

    return {
        "grantable": True,
        "reason": "Account Group",
        "label": "Account Group",
        "message": "This principal can receive Unity Catalog permissions.",
    }


def _normalize_group(group: Dict[str, Any]) -> Dict[str, Any]:
    members = group.get("members") or []
    grantability = _classify_group_grantability(group)
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
        "resource_type": (group.get("meta") or {}).get("resourceType"),
        "grantable": grantability["grantable"],
        "grantability_reason": grantability["reason"],
        "grantability_label": grantability["label"],
        "grantability_message": grantability["message"],
    }


def list_users(search: str = "", fresh: bool = False) -> Dict[str, Any]:
    """
    Search workspace users through Databricks SCIM.
    """
    cache_key = "scim_users"
    if not fresh and cache_key in _cache and datetime.now() - _cache[cache_key][1] < CACHE_DURATION:
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


def list_groups(search: str = "", fresh: bool = False) -> Dict[str, Any]:
    """
    Return SCIM groups with short caching to keep user comparison responsive.
    """
    cache_key = "scim_groups"
    if not fresh and cache_key in _cache and datetime.now() - _cache[cache_key][1] < CACHE_DURATION:
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


def list_group_summaries(search: str = "", fresh: bool = False) -> Dict[str, Any]:
    result = list_groups(search, fresh=fresh)
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


def _find_user(user: str, fresh: bool = False) -> Dict[str, Any]:
    users_result = list_users(user, fresh=fresh)
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


def _find_group(group: str, fresh: bool = False) -> Dict[str, Any]:
    groups_result = list_groups(group, fresh=fresh)
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
    if exact:
        return {
            "success": True,
            "group": exact,
            "matches": groups,
        }

    if len(groups) == 1:
        return {
            "success": True,
            "group": groups[0],
            "matches": groups,
            "matched_by": "partial",
        }

    return {
        "success": True,
        "group": None,
        "matches": groups,
    }


def list_service_principals(search: str = "") -> Dict[str, Any]:
    params = {"count": 100}
    result = make_request("GET", "/api/2.0/preview/scim/v2/ServicePrincipals", params=params)
    if not result.get("success"):
        return {
            "success": False,
            "service_principals": [],
            "message": "Service principal search is not available for this Databricks workspace.",
            "error": result.get("error"),
            "status_code": result.get("status_code"),
        }

    principals = result.get("data", {}).get("Resources", [])
    normalized = []
    for item in principals:
        name = item.get("displayName") or item.get("applicationId") or item.get("userName") or item.get("id")
        record = {
            "id": item.get("id"),
            "name": name,
            "application_id": item.get("applicationId"),
            "principal_type": "Service Principal",
            "grantable": True,
            "grantability_reason": "Service Principal",
            "grantability_label": "Service Principal",
        }
        if not search or search.lower() in str(name or "").lower() or search.lower() in str(record.get("application_id") or "").lower():
            normalized.append(record)

    return {
        "success": True,
        "service_principals": normalized,
    }


def validate_principal_grantability(
    principal: str,
    principal_type: str,
    object_type: str = "",
    catalog: str = "",
    schema_name: str = "",
    table: str = "",
    volume: str = "",
) -> Dict[str, Any]:
    normalized_type = str(principal_type or "").strip().lower().replace("_", " ")
    normalized_principal = str(principal or "").strip()
    if not normalized_principal:
        return {
            "success": False,
            "grantable": False,
            "reason": "Missing Principal",
            "message": "Principal is required.",
            "status_code": 400,
        }

    if normalized_type == "group":
        if normalized_principal.lower() == "account users":
            return {
                "success": True,
                "grantable": True,
                "principal": "account users",
                "principal_type": "group",
                "principal_class": "Account-level Group",
                "reason": "Account Group",
                "message": "This principal can receive Unity Catalog permissions.",
                "object_type": object_type,
                "catalog": catalog,
            }

        group_result = _find_group(normalized_principal)
        if not group_result.get("success"):
            return {
                "success": False,
                "grantable": False,
                "principal": normalized_principal,
                "principal_type": "group",
                "reason": "Group Lookup Failed",
                "message": group_result.get("message", "Unable to validate this Databricks group."),
                "status_code": group_result.get("status_code", 503),
            }

        group = group_result.get("group")
        if not group:
            matches = [
                item.get("displayName") or item.get("name")
                for item in group_result.get("matches", [])
                if item.get("displayName") or item.get("name")
            ]
            if matches:
                return {
                    "success": True,
                    "grantable": False,
                    "principal": normalized_principal,
                    "principal_type": "group",
                    "reason": "Ambiguous Group",
                    "message": f"Multiple groups match '{normalized_principal}'. Select one of: {', '.join(matches[:5])}.",
                    "matches": matches,
                    "status_code": 409,
                }
            return {
                "success": True,
                "grantable": False,
                "principal": normalized_principal,
                "principal_type": "group",
                "reason": "Principal Not Found",
                "message": "Principal was not found in this Databricks workspace.",
                "status_code": 404,
            }

        grantability = _classify_group_grantability(group)
        resolved_name = group.get("displayName") or group.get("name") or normalized_principal
        return {
            "success": True,
            "grantable": grantability["grantable"],
            "principal": resolved_name,
            "principal_type": "group",
            "principal_class": grantability["reason"],
            "reason": grantability["reason"],
            "message": grantability["message"],
            "resource_type": (group.get("meta") or {}).get("resourceType"),
            "group": _normalize_group(group),
            "object_type": object_type,
            "catalog": catalog,
        }

    if normalized_type in {"service principal", "serviceprincipal", "application"}:
        result = list_service_principals(normalized_principal)
        if not result.get("success"):
            return {
                "success": False,
                "grantable": False,
                "principal": normalized_principal,
                "principal_type": "service_principal",
                "reason": "Service Principal Lookup Failed",
                "message": result.get("message", "Unable to validate this service principal."),
                "status_code": result.get("status_code", 503),
            }
        principal_record = next(
            (
                item for item in result.get("service_principals", [])
                if str(item.get("name") or "").lower() == normalized_principal.lower()
                or str(item.get("application_id") or "").lower() == normalized_principal.lower()
            ),
            None,
        )
        if not principal_record and len(result.get("service_principals", [])) == 1:
            principal_record = result["service_principals"][0]
        return {
            "success": True,
            "grantable": bool(principal_record),
            "principal": principal_record.get("name") if principal_record else normalized_principal,
            "principal_type": "service_principal",
            "principal_class": "Service Principal" if principal_record else "Principal Not Found",
            "reason": "Service Principal" if principal_record else "Principal Not Found",
            "message": (
                "This principal can receive Unity Catalog permissions."
                if principal_record else
                "Principal was not found in this Databricks workspace."
            ),
            "service_principal": principal_record,
            "status_code": 200 if principal_record else 404,
        }

    user_result = _find_user(normalized_principal)
    if not user_result.get("success"):
        return {
            "success": False,
            "grantable": False,
            "principal": normalized_principal,
            "principal_type": "user",
            "reason": "User Lookup Failed",
            "message": user_result.get("message", "Unable to validate this Databricks user."),
            "status_code": user_result.get("status_code", 503),
        }

    user = user_result.get("user")
    if not user:
        return {
            "success": True,
            "grantable": False,
            "principal": normalized_principal,
            "principal_type": "user",
            "reason": "Principal Not Found",
            "message": "Principal was not found in this Databricks workspace.",
            "status_code": 404,
        }

    return {
        "success": True,
        "grantable": True,
        "principal": user.get("email") or user.get("name") or normalized_principal,
        "principal_type": "user",
        "principal_class": "User",
        "reason": "User",
        "message": "This principal can receive Unity Catalog permissions.",
        "user": user,
        "object_type": object_type,
        "catalog": catalog,
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
        matches = [
            item.get("displayName") or item.get("name")
            for item in group_result.get("matches", [])
            if item.get("displayName") or item.get("name")
        ]
        if matches:
            return {
                "success": False,
                "message": f"Multiple groups match '{principal}'. Select one of: {', '.join(matches[:5])}.",
                "status_code": 409,
            }
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


def get_user_groups(user: str, fresh: bool = False) -> Dict[str, Any]:
    """
    Return groups containing the requested user using Databricks SCIM.
    """
    user_result = _find_user(user, fresh=fresh)
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

    groups_result = list_groups(fresh=fresh)
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

    # Every account identity assigned to a workspace is a member of the
    # Databricks built-in `account users` principal. It is not always returned
    # in the user's SCIM group memberships, so account for it explicitly.
    built_in_account_user = principal_type == "group" and principal == "account users"
    return (
        (principal_type == "user" and principal in user_names)
        or (principal_type == "group" and principal in group_names)
        or built_in_account_user
    )


def _permission_source(permission: Dict[str, Any]) -> str:
    return "Inherited from Group" if str(permission.get("principal_type", "")).lower() == "group" else "Direct"


def _append_access(access: Dict[str, List[Dict[str, Any]]], category: str, item: Dict[str, Any]) -> None:
    item_name = str(item.get("name") or "").lower()
    for existing in access.get(category, []):
        if str(existing.get("name") or "").lower() == item_name:
            existing["privileges"] = sorted(set(existing.get("privileges", [])) | set(item.get("privileges", [])))
            sources = set(str(existing.get("source") or "").split(" + ")) | {str(item.get("source") or "")}
            existing["source"] = " + ".join(sorted(source for source in sources if source))
            principals = set(str(existing.get("principal") or "").split(", ")) | {str(item.get("principal") or "")}
            existing["principal"] = ", ".join(sorted(principal for principal in principals if principal))
            for privilege in item.get("privileges", []):
                if privilege and privilege not in access["privileges"]:
                    access["privileges"].append(privilege)
            return

    access[category].append(item)
    for privilege in item.get("privileges", []):
        if privilege and privilege not in access["privileges"]:
            access["privileges"].append(privilege)


def _append_permission_target_access(
    access: Dict[str, List[Dict[str, Any]]],
    object_type: str,
    full_name: str,
    permission: Dict[str, Any],
) -> None:
    normalized_type = str(object_type or "").lower()
    parts = str(full_name or "").split(".")
    if normalized_type == "catalog":
        _append_access(access, "catalogs", {
            "name": full_name,
            "privileges": permission.get("privileges", []),
            "source": _permission_source(permission),
            "principal": permission.get("principal"),
        })
    elif normalized_type == "schema":
        _append_access(access, "schemas", {
            "name": full_name,
            "catalog": parts[0] if len(parts) > 0 else "",
            "schema": parts[1] if len(parts) > 1 else "",
            "privileges": permission.get("privileges", []),
            "source": _permission_source(permission),
            "principal": permission.get("principal"),
        })
    elif normalized_type == "table":
        _append_access(access, "tables", {
            "name": full_name,
            "catalog": parts[0] if len(parts) > 0 else "",
            "schema": parts[1] if len(parts) > 1 else "",
            "table": parts[2] if len(parts) > 2 else "",
            "privileges": permission.get("privileges", []),
            "source": _permission_source(permission),
            "principal": permission.get("principal"),
        })
    elif normalized_type == "volume":
        _append_access(access, "volumes", {
            "name": full_name,
            "catalog": parts[0] if len(parts) > 0 else "",
            "schema": parts[1] if len(parts) > 1 else "",
            "volume": parts[2] if len(parts) > 2 else "",
            "privileges": permission.get("privileges", []),
            "source": _permission_source(permission),
            "principal": permission.get("principal"),
        })


def _scan_recent_permission_targets_for_user(
    access: Dict[str, List[Dict[str, Any]]],
    user_info: Dict[str, Any],
    groups: List[Dict[str, Any]],
    scan_warnings: List[str],
) -> int:
    """
    Check recently changed app-managed permission targets first.

    The audit log is only used to discover which Databricks securables should be
    checked early; the actual access values still come from Databricks
    permissions endpoints.
    """
    try:
        from services.audit_service import list_permission_audits
    except Exception:
        return 0

    events = list_permission_audits(50).get("events", [])
    scanned = 0
    seen = set()
    for event in events:
        if str(event.get("action") or "").lower() == "remove":
            continue
        object_type = str(event.get("object_type") or "").lower()
        full_name = str(event.get("object") or "")
        if object_type not in {"catalog", "schema", "table", "volume"} or not full_name:
            continue
        key = (object_type, full_name.lower())
        if key in seen:
            continue
        seen.add(key)
        permissions = get_permissions(object_type, full_name, timeout=LIVE_SCAN_REQUEST_TIMEOUT)
        scanned += 1
        if not permissions.get("success"):
            scan_warnings.append(f"Recent {object_type} permissions unavailable for {full_name}.")
            continue
        for permission in permissions.get("permissions", []):
            if _principal_matches(permission, user_info, groups):
                _append_permission_target_access(access, object_type, full_name, permission)

    return scanned


def get_user_access(user: str, scan_permissions: bool = True, fresh: bool = True) -> Dict[str, Any]:
    """
    Build an access profile by matching direct and group permissions across Unity Catalog objects.
    """
    groups_result = get_user_groups(user, fresh=fresh)
    if not groups_result.get("success"):
        return {
            "success": False,
            "message": groups_result.get("message", "Unable to load user access."),
            "user": groups_result.get("user"),
            "groups": groups_result.get("groups", []),
            "catalogs": [],
            "schemas": [],
            "tables": [],
            "volumes": [],
            "workspaces": [],
            "privileges": [],
        }

    user_info = groups_result.get("user")
    groups = groups_result.get("groups", [])
    scan_started = datetime.now()
    scanned_objects = 0
    scan_warnings: List[str] = []
    scan_complete = True
    access = {
        "catalogs": [],
        "schemas": [],
        "tables": [],
        "volumes": [],
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

    scanned_objects += _scan_recent_permission_targets_for_user(access, user_info, groups, scan_warnings)

    def should_stop_scan() -> bool:
        return (
            (datetime.now() - scan_started).total_seconds() >= LIVE_SCAN_MAX_SECONDS
            or scanned_objects >= LIVE_SCAN_MAX_OBJECTS
        )

    catalogs_result = list_catalogs(fresh=fresh, timeout=LIVE_SCAN_REQUEST_TIMEOUT)
    if not catalogs_result.get("success"):
        return {
            "success": False,
            "message": "Catalog access could not be scanned for this workspace.",
            "user": user_info,
            "groups": groups,
            **access,
        }

    catalog_names = catalogs_result.get("catalogs", [])

    # Scan every catalog before descending into schemas and tables. Previously,
    # a large first catalog could consume the entire time budget and make later
    # directly granted catalogs incorrectly appear as zero access.
    for catalog_name in catalog_names:
        scanned_objects += 1
        catalog_permissions = get_permissions("catalog", catalog_name, timeout=LIVE_SCAN_REQUEST_TIMEOUT)
        if not catalog_permissions.get("success"):
            scan_warnings.append(f"Catalog permissions unavailable for {catalog_name}.")
            continue
        for permission in catalog_permissions.get("permissions", []):
            if _principal_matches(permission, user_info, groups):
                _append_access(access, "catalogs", {
                    "name": catalog_name,
                    "privileges": permission.get("privileges", []),
                    "source": _permission_source(permission),
                    "principal": permission.get("principal"),
                })

    for catalog_name in catalog_names:
        if should_stop_scan():
            scan_complete = False
            break
        schemas_result = list_schemas(catalog_name, fresh=fresh, timeout=LIVE_SCAN_REQUEST_TIMEOUT)
        if not schemas_result.get("success"):
            scan_warnings.append(f"Schemas unavailable for {catalog_name}.")
        for schema in schemas_result.get("schemas", []):
            if should_stop_scan():
                scan_complete = False
                break
            schema_name = schema.get("name")
            if not schema_name:
                continue
            full_schema = f"{catalog_name}.{schema_name}"
            scanned_objects += 1
            schema_permissions = get_permissions("schema", full_schema, timeout=LIVE_SCAN_REQUEST_TIMEOUT)
            if not schema_permissions.get("success"):
                scan_warnings.append(f"Schema permissions unavailable for {full_schema}.")
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

            tables_result = list_tables(catalog_name, schema_name, fresh=fresh, timeout=LIVE_SCAN_REQUEST_TIMEOUT)
            if not tables_result.get("success"):
                scan_warnings.append(f"Tables unavailable for {full_schema}.")
            ordered_tables = sorted(
                tables_result.get("tables", []),
                key=lambda item: str(item.get("name") or "").lower(),
                reverse=True,
            )
            for table in ordered_tables:
                if should_stop_scan():
                    scan_complete = False
                    break
                table_name = table.get("name")
                if not table_name:
                    continue
                full_table = f"{catalog_name}.{schema_name}.{table_name}"
                scanned_objects += 1
                table_permissions = get_permissions("table", full_table, timeout=LIVE_SCAN_REQUEST_TIMEOUT)
                if not table_permissions.get("success"):
                    scan_warnings.append(f"Table permissions unavailable for {full_table}.")
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

            volumes_result = list_volumes(catalog_name, schema_name, fresh=fresh, timeout=LIVE_SCAN_REQUEST_TIMEOUT)
            if not volumes_result.get("success"):
                scan_warnings.append(f"Volumes unavailable for {full_schema}.")
            for volume in volumes_result.get("volumes", []):
                if should_stop_scan():
                    scan_complete = False
                    break
                volume_name = volume.get("name")
                if not volume_name:
                    continue
                full_volume = f"{catalog_name}.{schema_name}.{volume_name}"
                scanned_objects += 1
                volume_permissions = get_permissions("volume", full_volume, timeout=LIVE_SCAN_REQUEST_TIMEOUT)
                if not volume_permissions.get("success"):
                    scan_warnings.append(f"Volume permissions unavailable for {full_volume}.")
                for permission in volume_permissions.get("permissions", []):
                    if _principal_matches(permission, user_info, groups):
                        _append_access(access, "volumes", {
                            "name": full_volume,
                            "catalog": catalog_name,
                            "schema": schema_name,
                            "volume": volume_name,
                            "privileges": permission.get("privileges", []),
                            "source": _permission_source(permission),
                            "principal": permission.get("principal"),
                        })
            if not scan_complete:
                break
        if not scan_complete:
            break

    access["privileges"] = sorted(access["privileges"])
    if not scan_complete:
        scan_warnings.append(
            "Live scan reached the configured time or object limit. Results shown are fresh but partial."
        )
    return {
        "success": True,
        "scan_complete": scan_complete,
        "generated_at": datetime.now().isoformat(),
        "fresh": fresh,
        "scanned_objects": scanned_objects,
        "warnings": scan_warnings[:12],
        "message": "" if scan_complete else "Live access scan returned partial results because Databricks took too long.",
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


def get_group_access(group_name: str, scan_permissions: bool = True) -> Dict[str, Any]:
    """
    Build a read-only access profile for a Databricks SCIM group.
    """
    group_name = (group_name or "").strip()
    if not group_name:
        return {"success": False, "message": "Group name is required.", "status_code": 400}

    group_result = _find_group(group_name)
    if not group_result.get("success"):
        return {
            "success": False,
            "message": group_result.get("message", "Unable to search groups."),
            "error": group_result.get("error"),
            "status_code": group_result.get("status_code"),
        }

    raw_group = group_result.get("group")
    if not raw_group:
        return {
            "success": False,
            "message": "Group was not found in this Databricks workspace.",
            "status_code": 404,
        }

    group = _normalize_group(raw_group)
    members = []
    for member in raw_group.get("members") or []:
        if not isinstance(member, dict):
            continue
        display = member.get("display") or member.get("$ref") or member.get("value")
        members.append({
            "id": member.get("value"),
            "name": display,
            "email": display if "@" in str(display or "") else "",
            "type": member.get("type") or "User",
        })

    workspace_result = get_workspace()
    workspaces = workspace_result.get("workspaces", []) if workspace_result.get("success") else []

    if not scan_permissions:
        return {
            "success": True,
            "scan_complete": False,
            "message": "Group profile loaded. Detailed access scan is still pending.",
            "group": group,
            "members": members,
            "workspaces": workspaces,
            "catalogs": [],
            "schemas": [],
            "tables": [],
            "permissions": [],
            "privileges": [],
        }

    permissions_result = get_group_permissions(group.get("name") or group_name, scan_permissions=True)
    if not permissions_result.get("success"):
        return {
            "success": False,
            "message": permissions_result.get("message", "Group permissions could not be scanned."),
            "group": group,
            "members": members,
            "workspaces": workspaces,
            "catalogs": [],
            "schemas": [],
            "tables": [],
            "permissions": [],
            "privileges": [],
            "error": permissions_result.get("error"),
            "status_code": permissions_result.get("status_code"),
        }

    permissions = permissions_result.get("permissions", [])
    catalogs = [item for item in permissions if item.get("object_type") == "Catalog"]
    schemas = [item for item in permissions if item.get("object_type") == "Schema"]
    tables = [item for item in permissions if item.get("object_type") == "Table"]
    privileges = sorted({
        privilege
        for item in permissions
        for privilege in item.get("privileges", [])
        if privilege
    })

    return {
        "success": True,
        "scan_complete": True,
        "group": group,
        "members": members,
        "workspaces": workspaces,
        "catalogs": catalogs,
        "schemas": schemas,
        "tables": tables,
        "permissions": permissions,
        "privileges": privileges,
    }


def get_group_catalogs(group_name: str) -> Dict[str, Any]:
    access = get_group_access(group_name, scan_permissions=True)
    if not access.get("success"):
        return access
    return {"success": True, "group": access.get("group"), "catalogs": access.get("catalogs", [])}


def get_group_schemas(group_name: str) -> Dict[str, Any]:
    access = get_group_access(group_name, scan_permissions=True)
    if not access.get("success"):
        return access
    return {"success": True, "group": access.get("group"), "schemas": access.get("schemas", [])}


def get_group_tables(group_name: str) -> Dict[str, Any]:
    access = get_group_access(group_name, scan_permissions=True)
    if not access.get("success"):
        return access
    return {"success": True, "group": access.get("group"), "tables": access.get("tables", [])}


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
    "volume": [
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
                {"name": "READ_VOLUME", "description": "Read files from this volume."},
            ],
        },
        {
            "group": "Edit",
            "privileges": [
                {"name": "WRITE_VOLUME", "description": "Write files to this volume."},
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
    current = get_permissions(securable_type, full_name)
    if current.get("success"):
        existing = next(
            (
                item for item in current.get("permissions", [])
                if str(item.get("principal") or "").lower() == str(resolved_principal).lower()
            ),
            None,
        )
        existing_privileges = set(existing.get("privileges", [])) if existing else set()
        requested_privileges = set(privileges)
        duplicate_privileges = sorted(requested_privileges & existing_privileges)
        privileges = sorted(requested_privileges - existing_privileges)
        if duplicate_privileges and not privileges:
            return {
                "success": False,
                "message": "Selected privileges are already assigned to this principal.",
                "permissions": current.get("permissions", []),
                "duplicate_privileges": duplicate_privileges,
                "status_code": 409,
            }

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


def list_catalogs(fresh: bool = False, timeout: int = 30) -> Dict[str, Any]:
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
    
    result = make_request("GET", "/api/2.1/unity-catalog/catalogs", timeout=timeout)
    
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


def list_schemas(catalog_name: str, fresh: bool = False, timeout: int = 30) -> Dict[str, Any]:
    """
    List all schemas in a catalog.
    
    Args:
        catalog_name: Name of the catalog
    
    Returns:
        Dict with success status and list of schemas
    """
    # Check cache first
    cache_key = f"schemas_{catalog_name}"
    if not fresh and cache_key in _cache:
        cached_data, cached_time = _cache[cache_key]
        if datetime.now() - cached_time < CACHE_DURATION:
            logger.info(f"Returning cached schemas for {catalog_name}")
            return cached_data
    
    params = {"catalog_name": catalog_name}
    result = make_request("GET", "/api/2.1/unity-catalog/schemas", params=params, timeout=timeout)
    
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


def list_tables(catalog_name: str, schema_name: str, fresh: bool = False, timeout: int = 30) -> Dict[str, Any]:
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
    if not fresh and cache_key in _cache:
        cached_data, cached_time = _cache[cache_key]
        if datetime.now() - cached_time < CACHE_DURATION:
            logger.info(f"Returning cached tables for {catalog_name}.{schema_name}")
            return cached_data
    
    params = {
        "catalog_name": catalog_name,
        "schema_name": schema_name
    }
    result = make_request("GET", "/api/2.1/unity-catalog/tables", params=params, timeout=timeout)
    
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


def _normalize_volume(volume: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "name": volume.get("name"),
        "catalog_name": volume.get("catalog_name"),
        "schema_name": volume.get("schema_name"),
        "volume_type": volume.get("volume_type"),
        "owner": volume.get("owner"),
        "comment": volume.get("comment"),
        "created_at": volume.get("created_at"),
        "storage_location": volume.get("storage_location"),
        "storage_credential": volume.get("storage_credential_name") or volume.get("credential_name"),
        "external_location": volume.get("external_location_name"),
        "read_only": volume.get("read_only"),
    }


def list_volumes(catalog_name: str, schema_name: str, fresh: bool = False, timeout: int = 30) -> Dict[str, Any]:
    """
    List Unity Catalog volumes in a schema.
    """
    cache_key = f"volumes_{catalog_name}_{schema_name}"
    if not fresh and cache_key in _cache:
        cached_data, cached_time = _cache[cache_key]
        if datetime.now() - cached_time < CACHE_DURATION:
            logger.info(f"Returning cached volumes for {catalog_name}.{schema_name}")
            return cached_data

    params = {
        "catalog_name": catalog_name,
        "schema_name": schema_name,
    }
    result = make_request("GET", "/api/2.1/unity-catalog/volumes", params=params, timeout=timeout)

    if result["success"]:
        volumes = [_normalize_volume(volume) for volume in result["data"].get("volumes", [])]
        response_data = {
            "success": True,
            "catalog": catalog_name,
            "schema": schema_name,
            "volumes": volumes,
        }
        _cache[cache_key] = (response_data, datetime.now())
        return response_data

    return {
        "success": False,
        "volumes": [],
        "message": "Volumes are not available for this schema or Databricks edition.",
        "error": result.get("error", f"Failed to list volumes for {catalog_name}.{schema_name}"),
        "status_code": result.get("status_code"),
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
                "storage_location": catalog_data.get("storage_root") or catalog_data.get("storage_location"),
                "storage_root": catalog_data.get("storage_root") or catalog_data.get("storage_location"),
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
    full_name = f"{catalog_name}.{schema_name}"
    result = make_request("GET", f"/api/2.1/unity-catalog/schemas/{quote(full_name, safe='')}")
    
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
                "storage_location": schema_data.get("storage_root") or schema_data.get("storage_location"),
                "storage_type": "External" if schema_data.get("storage_root") else "Managed",
                "storage_credential": schema_data.get("storage_credential_name") or schema_data.get("credential_name"),
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
    full_name = f"{catalog_name}.{schema_name}.{table_name}"
    result = make_request("GET", f"/api/2.1/unity-catalog/tables/{quote(full_name, safe='')}")
    
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


def get_volume_metadata(catalog_name: str, schema_name: str, volume_name: str) -> Dict[str, Any]:
    """
    Get detailed metadata for a Unity Catalog volume.
    """
    full_name = f"{catalog_name}.{schema_name}.{volume_name}"
    result = make_request("GET", f"/api/2.1/unity-catalog/volumes/{quote(full_name, safe='')}")

    if result["success"]:
        return {
            "success": True,
            "metadata": _normalize_volume(result["data"]),
        }

    return {
        "success": False,
        "error": result.get("error", f"Failed to get volume metadata for {full_name}"),
        "status_code": result.get("status_code"),
    }


def get_permissions(object_type: str, object_name: str, timeout: int = 30) -> Dict[str, Any]:
    """
    Get permissions for a Unity Catalog object.
    
    Args:
        object_type: Type of object (catalogs, schemas, tables)
        object_name: Full name of the object (e.g., "catalog.schema.table")
    
    Returns:
        Dict with permissions list
    """
    result = make_request(
        "GET",
        f"/api/2.1/unity-catalog/permissions/{object_type}/{quote(object_name, safe='')}",
        timeout=timeout,
    )
    
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


def get_volume_binding(catalog_name: str, schema_name: str, volume_name: str) -> Dict[str, Any]:
    """
    Return volume binding information when Databricks exposes it.
    """
    full_name = f"{catalog_name}.{schema_name}.{volume_name}"
    binding_endpoints = [
        f"/api/2.1/unity-catalog/bindings/volume/{quote(full_name, safe='')}",
        f"/api/2.1/unity-catalog/workspace-bindings/volume/{quote(full_name, safe='')}",
        f"/api/2.1/unity-catalog/workspace-bindings/volumes/{quote(full_name, safe='')}/bindings",
    ]
    result = None
    for endpoint in binding_endpoints:
        result = make_request("GET", endpoint)
        if result["success"]:
            break

    if result and result["success"]:
        raw_bindings = (
            result["data"].get("bindings")
            or result["data"].get("workspace_bindings")
            or []
        )
        bindings = [
            {
                "workspace_name": binding.get("workspace_name") or binding.get("workspace_id") or "Workspace",
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
        }

    return {
        "success": True,
        "bindings": [],
        "message": "Volume binding is not exposed by this Databricks workspace.",
        "status_code": (result or {}).get("status_code"),
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
                "owner": table.get("owner"),
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
                "created_time": metadata.get("created_at"),
                "size_in_mb": size_in_mb,
                "table_size": f"{size_in_mb} MB" if size_in_mb is not None else None,
                "number_of_files": properties.get("numFiles") or properties.get("delta.numFiles"),
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


def _unavailable(value: Any) -> Any:
    return value if value not in (None, "", []) else "Unavailable"


def _governance_error(result: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "success": False,
        "message": "Unable to load governance information.",
        "status_code": result.get("status_code"),
    }


def _list_uc_resource(endpoint: str, key: str) -> Dict[str, Any]:
    result = make_request("GET", endpoint, params={"max_results": 100})
    if not result.get("success"):
        return _governance_error(result)
    return {"success": True, "items": (result.get("data") or {}).get(key) or []}


def _normalized_storage_path(value: Any) -> str:
    return str(value or "").strip().rstrip("/").lower()


def _external_location_matches(storage_path: Any) -> Dict[str, Any]:
    """Match external locations that are parents of one object's storage path."""
    normalized_path = _normalized_storage_path(storage_path)
    if not normalized_path:
        return {"success": True, "external_locations": []}
    result = _list_uc_resource("/api/2.1/unity-catalog/external-locations", "external_locations")
    if not result.get("success"):
        return result
    matches = []
    for item in result.get("items", []):
        normalized_url = _normalized_storage_path(item.get("url"))
        if normalized_url and (
            normalized_path == normalized_url
            or normalized_path.startswith(f"{normalized_url}/")
        ):
            matches.append({
                "external_location": _unavailable(item.get("name")),
                "url": _unavailable(item.get("url")),
                "storage_credential": _unavailable(item.get("credential_name")),
                "owner": _unavailable(item.get("owner")),
                "read_only": bool(item.get("read_only", False)),
            })
    matches.sort(key=lambda item: len(_normalized_storage_path(item.get("url"))), reverse=True)
    return {"success": True, "external_locations": matches}


def _credential_type(item: Dict[str, Any]) -> tuple[str, str]:
    credential_type = next((key for key in (
        "aws_iam_role", "azure_managed_identity", "azure_service_principal",
        "gcp_service_account_key", "databricks_gcp_service_account",
    ) if item.get(key) is not None), item.get("purpose"))
    value = str(credential_type or "")
    provider = "AWS" if value.startswith("aws") else "Azure" if value.startswith("azure") else "GCP" if "gcp" in value else "Unavailable"
    return _unavailable(credential_type), provider


def _credentials_for_locations(locations: List[Dict[str, Any]]) -> Dict[str, Any]:
    credentials = []
    names = sorted({
        str(item.get("storage_credential") or "").strip()
        for item in locations
        if item.get("storage_credential") not in (None, "", "Unavailable")
    })
    for name in names:
        result = make_request("GET", f"/api/2.1/unity-catalog/storage-credentials/{quote(name, safe='')}")
        if not result.get("success"):
            credentials.append({"credential_name": name, "owner": "Unavailable", "credential_type": "Unavailable", "cloud_provider": "Unavailable", "read_only": "Unavailable", "comment": "Unavailable"})
            continue
        item = result.get("data") or {}
        credential_type, provider = _credential_type(item)
        credentials.append({
            "credential_name": name, "owner": _unavailable(item.get("owner")),
            "credential_type": credential_type, "cloud_provider": provider,
            "read_only": bool(item.get("read_only", False)), "comment": _unavailable(item.get("comment")),
        })
    return {"success": True, "credentials": credentials}


def get_catalog_governance(catalog_name: str, section: str) -> Dict[str, Any]:
    """Lazily retrieve one normalized governance section for a catalog."""
    if section == "unity-catalog":
        catalog = make_request("GET", f"/api/2.1/unity-catalog/catalogs/{quote(catalog_name, safe='')}")
        if not catalog.get("success"):
            return _governance_error(catalog)
        data = catalog.get("data") or {}
        assignment = make_request("GET", "/api/2.1/unity-catalog/current-metastore-assignment")
        assignment_data = assignment.get("data") or {} if assignment.get("success") else {}
        metastore_id = data.get("metastore_id") or assignment_data.get("metastore_id")
        metastore = {}
        if metastore_id:
            detail = make_request("GET", f"/api/2.1/unity-catalog/metastores/{quote(str(metastore_id), safe='')}")
            if detail.get("success"):
                metastore = detail.get("data") or {}
        return {"success": True, "information": {
            "unity_catalog_name": _unavailable(data.get("name")),
            "metastore_name": _unavailable(metastore.get("name")),
            "metastore_id": _unavailable(metastore_id),
            "region": _unavailable(metastore.get("region")),
            "isolation_mode": _unavailable(data.get("isolation_mode")),
            "default_catalog": _unavailable(assignment_data.get("default_catalog_name")),
            "owner": _unavailable(data.get("owner")),
        }}
    if section == "storage-credentials":
        metadata = get_catalog_metadata(catalog_name)
        if not metadata.get("success"):
            return _governance_error(metadata)
        matches = _external_location_matches((metadata.get("metadata") or {}).get("storage_location"))
        if not matches.get("success"):
            return matches
        return _credentials_for_locations(matches.get("external_locations", []))
    if section == "external-locations":
        metadata = get_catalog_metadata(catalog_name)
        if not metadata.get("success"):
            return _governance_error(metadata)
        return _external_location_matches((metadata.get("metadata") or {}).get("storage_location"))
    if section in {"attached-workspaces", "catalog-binding"}:
        result = get_catalog_binding(catalog_name)
        if not result.get("success"):
            return _governance_error(result)
        return {"success": True, "workspaces": [{
            **item, "binding_type": item.get("access_level") or "Unavailable",
        } for item in result.get("bindings", [])]}
    return {"success": False, "message": "Unknown governance section.", "status_code": 400}


def get_schema_governance(catalog_name: str, schema_name: str, section: str) -> Dict[str, Any]:
    if section == "objects":
        result = get_schema_objects(catalog_name, schema_name)
        if not result.get("success"):
            return _governance_error(result)
        return {"success": True, "objects": result.get("objects", [])}
    if section == "parent-catalog":
        return {"success": True, "information": {
            "parent_catalog": _unavailable(catalog_name),
        }}
    metadata = get_schema_metadata(catalog_name, schema_name)
    if not metadata.get("success"):
        return _governance_error(metadata)
    data = metadata.get("metadata") or {}
    if section == "storage":
        matches = _external_location_matches(data.get("storage_location"))
        locations = matches.get("external_locations", []) if matches.get("success") else []
        return {"success": True, "information": {
            "storage_location": _unavailable(data.get("storage_location")),
            "storage_type": _unavailable(data.get("storage_type")),
            "storage_credential": _unavailable(locations[0].get("storage_credential") if locations else data.get("storage_credential")),
            "external_location": _unavailable(locations[0].get("external_location") if locations else None),
            "parent_catalog": _unavailable(data.get("catalog_name") or catalog_name),
        }}
    if section == "external-locations":
        return _external_location_matches(data.get("storage_location"))
    return {"success": False, "message": "Unknown governance section.", "status_code": 400}


def get_table_governance(catalog_name: str, schema_name: str, table_name: str, section: str) -> Dict[str, Any]:
    metadata = get_table_metadata(catalog_name, schema_name, table_name)
    if not metadata.get("success"):
        return _governance_error(metadata)
    data = metadata.get("metadata") or {}
    if section == "storage":
        matches = _external_location_matches(data.get("storage_location"))
        locations = matches.get("external_locations", []) if matches.get("success") else []
        return {"success": True, "information": {
            "storage_location": _unavailable(data.get("storage_location")),
            "storage_type": _unavailable(data.get("table_type")),
            "format": _unavailable(data.get("data_source_format")),
            "storage_credential": _unavailable(locations[0].get("storage_credential") if locations else None),
            "external_location": _unavailable(locations[0].get("external_location") if locations else None),
        }}
    if section == "external-locations":
        return _external_location_matches(data.get("storage_location"))
    if section == "columns":
        return {"success": True, "columns": [{
            "column_name": _unavailable(item.get("name")),
            "data_type": _unavailable(item.get("type_text") or item.get("type_name")),
            "nullable": item.get("nullable") if item.get("nullable") is not None else "Unavailable",
            "default": _unavailable(
                item.get("default_value")
                or ((item.get("type_json") or {}).get("default") if isinstance(item.get("type_json"), dict) else None)
            ),
            "comment": _unavailable(item.get("comment")),
        } for item in data.get("columns", [])]}
    if section == "statistics":
        result = get_table_statistics(catalog_name, schema_name, table_name)
        return result if result.get("success") else _governance_error(result)
    return {"success": False, "message": "Unknown governance section.", "status_code": 400}


def get_volume_governance(catalog_name: str, schema_name: str, volume_name: str, section: str) -> Dict[str, Any]:
    if section == "attached-workspaces":
        result = get_volume_binding(catalog_name, schema_name, volume_name)
        return {"success": True, "workspaces": result.get("bindings", [])}
    metadata = get_volume_metadata(catalog_name, schema_name, volume_name)
    if not metadata.get("success"):
        return _governance_error(metadata)
    data = metadata.get("metadata") or {}
    if section == "storage":
        url = data.get("storage_location") or data.get("storage_url")
        matches = _external_location_matches(url)
        locations = matches.get("external_locations", []) if matches.get("success") else []
        provider = "AWS" if str(url).startswith("s3://") else "Azure" if str(url).startswith(("abfss://", "wasbs://")) else "GCP" if str(url).startswith("gs://") else "Unavailable"
        return {"success": True, "information": {
            "storage_credential": _unavailable(locations[0].get("storage_credential") if locations else data.get("storage_credential")),
            "external_location": _unavailable(locations[0].get("external_location") if locations else data.get("external_location")),
            "storage_url": _unavailable(url), "cloud_provider": provider,
            "read_only": data.get("read_only") if data.get("read_only") is not None else "Unavailable",
        }}
    if section == "external-locations":
        return _external_location_matches(data.get("storage_location") or data.get("storage_url"))
    return {"success": False, "message": "Unknown governance section.", "status_code": 400}


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
