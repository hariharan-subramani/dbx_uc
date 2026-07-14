"""OAuth client-credentials authentication for one Databricks workspace."""

import os
import threading
import time
from typing import Tuple
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv

load_dotenv()

WORKSPACE_HOST = os.getenv("DATABRICKS_HOST", "").strip().rstrip("/")
CLIENT_ID = os.getenv("DATABRICKS_CLIENT_ID", "").strip()
CLIENT_SECRET = os.getenv("DATABRICKS_CLIENT_SECRET", "").strip()
CONFIGURED_WORKSPACE_NAME = os.getenv("DATABRICKS_WORKSPACE_NAME", "").strip()

_lock = threading.RLock()
_access_token = ""
_token_expires_at = 0.0


class WorkspaceAuthError(RuntimeError):
    """Raised when workspace configuration or OAuth authentication fails."""


def validate_configuration() -> None:
    missing = [
        name
        for name, value in (
            ("DATABRICKS_HOST", WORKSPACE_HOST),
            ("DATABRICKS_CLIENT_ID", CLIENT_ID),
            ("DATABRICKS_CLIENT_SECRET", CLIENT_SECRET),
        )
        if not value
    ]
    if missing:
        raise WorkspaceAuthError(f"Missing Databricks configuration: {', '.join(missing)}")
    parsed = urlparse(WORKSPACE_HOST)
    if parsed.scheme != "https" or not parsed.netloc:
        raise WorkspaceAuthError("DATABRICKS_HOST must be a valid HTTPS workspace URL")


def get_access_token(force_refresh: bool = False) -> str:
    """Return a cached OAuth token, refreshing it before expiration."""
    global _access_token, _token_expires_at
    validate_configuration()
    with _lock:
        if not force_refresh and _access_token and time.time() < _token_expires_at - 60:
            return _access_token

        try:
            response = requests.post(
                f"{WORKSPACE_HOST}/oidc/v1/token",
                auth=(CLIENT_ID, CLIENT_SECRET),
                data={"grant_type": "client_credentials", "scope": "all-apis"},
                timeout=30,
            )
        except requests.RequestException as exc:
            raise WorkspaceAuthError(f"Unable to reach Databricks OAuth endpoint: {exc}") from exc
        if not response.ok:
            raise WorkspaceAuthError(
                f"Databricks OAuth failed ({response.status_code}): {response.text[:500]}"
            )
        payload = response.json()
        token = payload.get("access_token")
        if not token:
            raise WorkspaceAuthError("Databricks OAuth response did not include an access token")
        _access_token = token
        _token_expires_at = time.time() + int(payload.get("expires_in", 3600))
        return token


def get_workspace_credentials() -> Tuple[str, str]:
    return WORKSPACE_HOST, get_access_token()


def refresh_workspace_credentials() -> Tuple[str, str]:
    return WORKSPACE_HOST, get_access_token(force_refresh=True)


def workspace_identity() -> dict:
    """Return a stable identity derived from the configured real workspace."""
    deployment = urlparse(WORKSPACE_HOST).netloc.split(".")[0]
    return {
        "workspace_id": deployment,
        "workspace_name": CONFIGURED_WORKSPACE_NAME or deployment,
        "workspace_url": WORKSPACE_HOST,
        "deployment_name": deployment,
    }
