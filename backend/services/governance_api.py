"""Normalized Unity Catalog governance resources for the Governance Explorer."""

from datetime import datetime, timezone
from typing import Any, Dict, List
from urllib.parse import quote

from services.databricks_api import make_request
from services.workspace_auth import workspace_identity


def _date(value: Any) -> str:
    if value in (None, ""):
        return ""
    try:
        number = float(value)
        if number > 10_000_000_000:
            number /= 1000
        return datetime.fromtimestamp(number, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError, OSError):
        return str(value)


def _failure(result: Dict[str, Any], key: str) -> Dict[str, Any]:
    status_code = result.get("status_code")
    unsupported = status_code in {403, 404, 501}
    return {
        "success": unsupported,
        "available": not unsupported,
        key: [],
        "count": 0,
        "message": (
            "This Databricks workspace does not expose this governance resource."
            if unsupported else result.get("error") or f"Unable to load {key.replace('_', ' ')}."
        ),
        "warning": "This Databricks workspace does not expose this governance resource." if unsupported else "",
        "status_code": status_code,
    }


def _paged(endpoint: str, collection_key: str) -> Dict[str, Any]:
    items: List[Dict[str, Any]] = []
    token = None
    while True:
        params = {"max_results": 100}
        if token:
            params["page_token"] = token
        result = make_request("GET", endpoint, params=params)
        if not result.get("success"):
            return result
        payload = result.get("data") or {}
        items.extend(payload.get(collection_key) or [])
        token = payload.get("next_page_token")
        if not token:
            return {"success": True, "data": items}


def _cloud_provider(value: str) -> str:
    value = (value or "").lower()
    if value.startswith(("s3://", "aws")):
        return "AWS"
    if value.startswith(("abfss://", "azure", "wasbs://")):
        return "Azure"
    if value.startswith(("gs://", "gcp")):
        return "GCP"
    return "Unknown"


def _credential_kind(item: Dict[str, Any]) -> tuple[str, str, str]:
    mappings = (
        ("aws_iam_role", "AWS IAM Role", "AWS", "IAM Role"),
        ("azure_managed_identity", "Azure Managed Identity", "Azure", "Managed Identity"),
        ("azure_service_principal", "Azure Service Principal", "Azure", "Service Principal"),
        ("gcp_service_account_key", "GCP Service Account", "GCP", "Service Account Key"),
        ("databricks_gcp_service_account", "Databricks GCP Service Account", "GCP", "Service Account"),
        ("cloudflare_api_token", "Cloudflare API Token", "Cloudflare", "API Token"),
    )
    for key, label, provider, auth in mappings:
        if item.get(key) is not None:
            return label, provider, auth
    purpose = str(item.get("purpose") or "Storage Credential")
    return purpose, "Unknown", purpose


def _metastore_context() -> Dict[str, Any]:
    result = make_request("GET", "/api/2.1/unity-catalog/current-metastore-assignment")
    if not result.get("success"):
        return {}
    assignment = result.get("data") or {}
    metastore_id = assignment.get("metastore_id") or ""
    context = {"metastore_id": metastore_id, "metastore_name": "", "region": ""}
    if metastore_id:
        detail = make_request("GET", f"/api/2.1/unity-catalog/metastores/{quote(str(metastore_id), safe='')}")
        if detail.get("success"):
            data = detail.get("data") or {}
            context.update({"metastore_name": data.get("name") or "", "region": data.get("region") or ""})
    return context


def list_governance_catalogs() -> Dict[str, Any]:
    result = _paged("/api/2.1/unity-catalog/catalogs", "catalogs")
    if not result.get("success"):
        return _failure(result, "catalogs")
    context = _metastore_context()
    catalogs = [{
        "name": item.get("name") or "",
        "owner": item.get("owner") or "",
        "metastore_id": item.get("metastore_id") or context.get("metastore_id", ""),
        "metastore_name": context.get("metastore_name", ""),
        "region": context.get("region", ""),
        "isolation_mode": item.get("isolation_mode") or "OPEN",
        "created_date": _date(item.get("created_at")),
        "comment": item.get("comment") or "",
        "catalog_type": item.get("catalog_type") or "",
        "storage_root": item.get("storage_root") or "",
    } for item in result.get("data", [])]
    return {"success": True, "catalogs": catalogs, "count": len(catalogs)}


def list_storage_credentials() -> Dict[str, Any]:
    result = _paged("/api/2.1/unity-catalog/storage-credentials", "storage_credentials")
    if not result.get("success"):
        return _failure(result, "storage_credentials")
    credentials = []
    for item in result.get("data", []):
        kind, provider, authentication = _credential_kind(item)
        credentials.append({
            "name": item.get("name") or "", "credential_type": kind,
            "cloud_provider": provider, "authentication_type": authentication,
            "owner": item.get("owner") or "", "read_only": bool(item.get("read_only", False)),
            "status": "Read only" if item.get("read_only") else "Active",
            "comment": item.get("comment") or "", "created_date": _date(item.get("created_at")),
        })
    return {"success": True, "storage_credentials": credentials, "count": len(credentials)}


def list_external_locations() -> Dict[str, Any]:
    result = _paged("/api/2.1/unity-catalog/external-locations", "external_locations")
    if not result.get("success"):
        return _failure(result, "external_locations")
    locations = [{
        "name": item.get("name") or "", "url": item.get("url") or "",
        "credential_name": item.get("credential_name") or "",
        "cloud_provider": _cloud_provider(item.get("url") or ""),
        "owner": item.get("owner") or "", "read_only": bool(item.get("read_only", False)),
        "status": "Read only" if item.get("read_only") else "Active",
        "created_date": _date(item.get("created_at")), "comment": item.get("comment") or "",
    } for item in result.get("data", [])]
    return {"success": True, "external_locations": locations, "count": len(locations)}


def list_catalog_bindings() -> Dict[str, Any]:
    catalogs_result = _paged("/api/2.1/unity-catalog/catalogs", "catalogs")
    if not catalogs_result.get("success"):
        return _failure(catalogs_result, "catalog_bindings")
    workspace = workspace_identity()
    bindings = []
    errors = []
    for catalog in catalogs_result.get("data", []):
        name = catalog.get("name") or ""
        result = make_request("GET", f"/api/2.1/unity-catalog/bindings/catalog/{quote(name, safe='')}")
        if not result.get("success"):
            errors.append(name)
            continue
        for binding in (result.get("data") or {}).get("bindings") or []:
            workspace_id = str(binding.get("workspace_id") or "")
            configured_id = str(workspace.get("workspace_id") or "")
            bindings.append({
                "catalog": name,
                "workspace_name": workspace.get("workspace_name", "") if workspace_id == configured_id else "",
                "workspace_id": workspace_id,
                "access_level": binding.get("binding_type") or binding.get("access_level") or "READ_WRITE",
                "status": "Active",
            })
    response = {"success": True, "catalog_bindings": bindings, "count": len(bindings)}
    if errors:
        response["warning"] = f"Bindings could not be read for {len(errors)} catalog(s)."
    return response


def list_audit_history() -> Dict[str, Any]:
    return {"success": True, "available": False, "audit_records": [], "count": 0, "message": "No audit history available."}


def governance_summary() -> Dict[str, Any]:
    """Return independent live counts; an unsupported resource never hides others."""
    catalogs = list_governance_catalogs()
    credentials = list_storage_credentials()
    locations = list_external_locations()
    bindings = list_catalog_bindings()
    catalog_rows = catalogs.get("catalogs") or []
    managed = sum(
        1 for item in catalog_rows
        if str(item.get("catalog_type") or "").upper() == "MANAGED_CATALOG"
        or bool(item.get("storage_root"))
    )
    return {
        "success": True,
        "counts": {
            "unity_catalogs": catalogs.get("count", 0),
            "storage_credentials": credentials.get("count", 0),
            "external_locations": locations.get("count", 0),
            "catalog_bindings": bindings.get("count", 0),
            "managed_catalogs": managed,
        },
        "warnings": {
            key: value.get("warning") or value.get("message")
            for key, value in {
                "unity_catalogs": catalogs,
                "storage_credentials": credentials,
                "external_locations": locations,
                "catalog_bindings": bindings,
            }.items()
            if not value.get("available", True) or not value.get("success")
        },
    }
