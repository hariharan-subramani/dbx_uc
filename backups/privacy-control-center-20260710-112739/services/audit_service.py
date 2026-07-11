from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


_permission_audit_events: List[Dict[str, Any]] = []


def record_permission_audit(
    *,
    action: str,
    administrator: Optional[str],
    principal: str,
    principal_type: str,
    object_type: str,
    object_name: str,
    privileges: List[str],
) -> Dict[str, Any]:
    event = {
        "id": len(_permission_audit_events) + 1,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "administrator": administrator or "Current Databricks administrator",
        "principal": principal,
        "principal_type": principal_type,
        "object_type": object_type,
        "object": object_name,
        "privileges": privileges,
        "action": action,
    }
    _permission_audit_events.insert(0, event)
    return event


def list_permission_audits(limit: int = 100) -> Dict[str, Any]:
    safe_limit = max(1, min(limit, 500))
    return {
        "success": True,
        "events": _permission_audit_events[:safe_limit],
    }
