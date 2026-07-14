"""Run a safe live OAuth and workspace API connection check."""

from services.workspace_auth import WorkspaceAuthError, get_access_token, workspace_identity
from services.databricks_api import get_workspace


try:
    get_access_token(force_refresh=True)
    result = get_workspace()
    if not result.get("success"):
        raise WorkspaceAuthError(result.get("message", "Workspace verification failed"))
    workspace = result["workspaces"][0]
    print(f"Connected to: {workspace.get('display_name') or workspace_identity()['deployment_name']}")
except WorkspaceAuthError as exc:
    print(f"Unable to connect to Databricks Workspace: {exc}")
    raise SystemExit(1)
