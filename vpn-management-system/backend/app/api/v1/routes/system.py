"""
System Routes - Version info and full-system update orchestration.

The actual update runs in the host update-agent (see UpdateService). These
endpoints let the UI show the running version, check for a newer one, and kick
off an update. Progress is streamed by the frontend polling the agent directly
through Traefik (`/update-agent/status`), because the backend itself restarts
mid-update and cannot be relied upon to report its own progress.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.core.config import settings
from app.dependencies.auth import get_current_active_user, require_admin
from app.models.user import User
from app.services.update_service import update_service

router = APIRouter()


class UpdateRequest(BaseModel):
    ref: str | None = None          # tag/branch to update to (default: latest tag)
    backup: bool = True             # dump DB + PKI before applying
    run_migrations: bool = True     # run alembic upgrade head after rebuild


@router.get("/version")
async def get_version(user: User = Depends(get_current_active_user)):
    """Running version for the UI badge. Any authenticated user."""
    return await update_service.get_version()


@router.get("/update/check")
async def check_for_update(admin: User = Depends(require_admin)):
    """Fetch upstream and report whether a newer version is available."""
    ok, data = await update_service.check_latest()
    if not ok:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=data)
    return data


@router.post("/update")
async def start_update(payload: UpdateRequest, admin: User = Depends(require_admin)):
    """Kick off a full-system update. Returns a job id immediately; poll the
    update-agent (via `/update-agent/status`) for live progress."""
    ok, data = await update_service.start_update(
        ref=payload.ref, backup=payload.backup, run_migrations=payload.run_migrations
    )
    if not ok:
        # Lock held / agent unreachable / bad ref -> 409 so the UI can distinguish
        # "already running" from a hard failure.
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=data)
    return data


@router.get("/update/status")
async def get_update_status(admin: User = Depends(require_admin)):
    """Proxied status. Prefer polling the agent directly for resilience; this is
    a convenience endpoint for when the backend is up."""
    ok, data = await update_service.get_status()
    if not ok:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=data)
    return data


@router.post("/openvpn/regenerate-config")
async def regenerate_openvpn_config(admin: User = Depends(require_admin)):
    """Regenerate OpenVPN server.conf from the current template, PRESERVING all
    PKI/certs. Explicit action — updates never touch server.conf automatically."""
    ok, data = await update_service.regenerate_openvpn_config()
    if not ok:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=data)
    return data
