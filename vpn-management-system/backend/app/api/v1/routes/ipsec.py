"""
IPsec Routes - StrongSwan Site-to-Site VPN Management
"""
from typing import Optional
from uuid import UUID
import logging
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.user import User
from app.models.ipsec import IPsecStatus
from app.services.ipsec_service import IPsecService
from app.dependencies.auth import require_admin
from app.schemas.ipsec import (
    IPsecConnectionCreate,
    IPsecConnectionUpdate,
    IPsecConnectionResponse,
    IPsecConnectionListResponse,
    IPsecGlobalStatus,
    IPsecConfigPreview,
    IPsecReloadResponse,
)
from app.schemas.common import MessageResponse, PaginatedResponse

logger = logging.getLogger(__name__)

router = APIRouter()


# ==================== Connection CRUD ====================

@router.get("/connections", response_model=PaginatedResponse[IPsecConnectionListResponse])
async def list_ipsec_connections(
    is_enabled: Optional[bool] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    List all IPsec connections (admin only).

    - Filter by is_enabled to see only active/inactive connections
    """
    service = IPsecService(db)

    connections, total = await service.list_connections(
        is_enabled=is_enabled,
        skip=(page - 1) * per_page,
        limit=per_page
    )

    return PaginatedResponse.create(
        items=[IPsecConnectionListResponse.model_validate(c) for c in connections],
        total=total,
        page=page,
        per_page=per_page
    )


@router.post("/connections", response_model=IPsecConnectionResponse, status_code=status.HTTP_201_CREATED)
async def create_ipsec_connection(
    data: IPsecConnectionCreate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new IPsec connection (admin only).

    The connection will be saved to the database but not applied until
    you call the /apply endpoint.
    """
    service = IPsecService(db)

    connection, error = await service.create_connection(data, admin)

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    # Push the config to StrongSwan right away (mirrors the Firewall auto-apply).
    # Don't fail the request if the agent is down — the connection is already saved.
    applied, apply_err = await service.apply_config()
    if not applied:
        logger.warning(f"Connection created but config not applied: {apply_err}")

    # Refresh NAT gateway so this tunnel's remote subnet is auto-excluded from masquerade.
    from app.api.v1.routes.firewall import apply_gateway_via_agent
    await apply_gateway_via_agent()

    return connection


@router.get("/connections/{connection_id}", response_model=IPsecConnectionResponse)
async def get_ipsec_connection(
    connection_id: UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get IPsec connection details (admin only)"""
    service = IPsecService(db)

    connection = await service.get_connection_by_id(connection_id)

    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="IPsec connection not found"
        )

    return connection


@router.put("/connections/{connection_id}", response_model=IPsecConnectionResponse)
async def update_ipsec_connection(
    connection_id: UUID,
    data: IPsecConnectionUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Update IPsec connection (admin only).

    After updating, call /apply to write the new configuration.
    """
    service = IPsecService(db)

    connection = await service.get_connection_by_id(connection_id)

    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="IPsec connection not found"
        )

    updated_connection, error = await service.update_connection(connection, data, admin)

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    # Regenerate and apply so /etc/ipsec.conf reflects the change without a manual
    # Apply click. Don't fail the request if the agent is down — it's already saved.
    applied, apply_err = await service.apply_config()
    if not applied:
        logger.warning(f"Connection updated but config not applied: {apply_err}")

    # Refresh NAT gateway so any changed remote subnet stays auto-excluded from masquerade.
    from app.api.v1.routes.firewall import apply_gateway_via_agent
    await apply_gateway_via_agent()

    # If the tunnel is live, restart it to renegotiate with the new proposal
    # (e.g. a changed Phase 2 / esp_cipher). A reload alone won't renegotiate.
    if updated_connection.is_enabled and updated_connection.status == IPsecStatus.ACTIVE:
        await service.restart_connection(updated_connection.name)

    return updated_connection


@router.delete("/connections/{connection_id}", response_model=MessageResponse)
async def delete_ipsec_connection(
    connection_id: UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Delete IPsec connection (admin only).

    If the connection is active, it will be stopped first.
    After deleting, call /apply to update the configuration.
    """
    service = IPsecService(db)

    connection = await service.get_connection_by_id(connection_id)

    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="IPsec connection not found"
        )

    success, error = await service.delete_connection(connection, admin)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    # Refresh NAT gateway so the removed tunnel's subnet is no longer excluded.
    from app.api.v1.routes.firewall import apply_gateway_via_agent
    await apply_gateway_via_agent()

    return MessageResponse(message="IPsec connection deleted")


# ==================== Connection Control ====================

@router.post("/connections/{connection_id}/start")
async def start_ipsec_connection(
    connection_id: UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Start/initiate an IPsec tunnel (admin only).

    Runs 'ipsec up <connection_name>' to establish the tunnel.
    """
    service = IPsecService(db)

    connection = await service.get_connection_by_id(connection_id)

    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="IPsec connection not found"
        )

    success, output = await service.start_connection(connection.name)

    if not success:
        # Determine error type for better feedback
        error_info = {
            "success": False,
            "connection": connection.name,
            "error": output,
            "error_type": "unknown"
        }

        output_lower = output.lower()
        if "not found" in output_lower or "not installed" in output_lower:
            error_info["error_type"] = "strongswan_not_installed"
            error_info["suggestion"] = "StrongSwan is not installed or not accessible. Install with: apt install strongswan"
        elif "no config" in output_lower or "unknown connection" in output_lower:
            error_info["error_type"] = "config_not_applied"
            error_info["suggestion"] = "Configuration not applied. Click 'Apply Config' first."
        elif "authentication" in output_lower or "auth" in output_lower:
            error_info["error_type"] = "authentication_failed"
            error_info["suggestion"] = "Authentication failed. Check PSK matches on both sides."
        elif "timeout" in output_lower or "timed out" in output_lower:
            error_info["error_type"] = "connection_timeout"
            error_info["suggestion"] = "Connection timed out. Check remote peer is reachable and firewall allows UDP 500/4500."
        elif "peer not responding" in output_lower:
            error_info["error_type"] = "peer_unreachable"
            error_info["suggestion"] = "Remote peer not responding. Verify IP address and that peer's IPsec is running."

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_info
        )

    return {"success": True, "message": f"Connection '{connection.name}' started successfully"}


@router.post("/connections/{connection_id}/stop", response_model=MessageResponse)
async def stop_ipsec_connection(
    connection_id: UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Stop/terminate an IPsec tunnel (admin only).

    Runs 'ipsec down <connection_name>' to close the tunnel.
    """
    service = IPsecService(db)

    connection = await service.get_connection_by_id(connection_id)

    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="IPsec connection not found"
        )

    success, output = await service.stop_connection(connection.name)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to stop connection: {output}"
        )

    return MessageResponse(message=f"Connection '{connection.name}' stopped")


@router.post("/connections/{connection_id}/restart", response_model=MessageResponse)
async def restart_ipsec_connection(
    connection_id: UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Restart an IPsec tunnel (admin only).

    Stops and then starts the tunnel.
    """
    service = IPsecService(db)

    connection = await service.get_connection_by_id(connection_id)

    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="IPsec connection not found"
        )

    success, output = await service.restart_connection(connection.name)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to restart connection: {output}"
        )

    return MessageResponse(message=f"Connection '{connection.name}' restarted")


# ==================== Global Status & Control ====================

@router.get("/status", response_model=IPsecGlobalStatus)
async def get_ipsec_status(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Get global IPsec status (admin only).

    Returns StrongSwan status including all tunnel statuses.
    """
    service = IPsecService(db)

    status_data = await service.get_status()

    return IPsecGlobalStatus(**status_data)


@router.get("/status/{connection_name}")
async def get_connection_status(
    connection_name: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get status of a specific IPsec connection (admin only)"""
    service = IPsecService(db)

    # Verify connection exists
    connection = await service.get_connection_by_name(connection_name)
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="IPsec connection not found"
        )

    status_data = await service.get_status(connection_name)

    return status_data


@router.post("/reload", response_model=IPsecReloadResponse)
async def reload_ipsec_config(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Reload StrongSwan configuration (admin only).

    Runs 'ipsec reload' to reload the configuration without
    disrupting established tunnels.
    """
    service = IPsecService(db)

    success, output = await service.reload_all()

    return IPsecReloadResponse(
        success=success,
        message="Configuration reloaded" if success else "Failed to reload",
        output=output
    )


@router.post("/apply", response_model=IPsecReloadResponse)
async def apply_ipsec_config(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Apply IPsec configuration (admin only).

    Generates ipsec.conf and ipsec.secrets from database
    and reloads StrongSwan.
    """
    service = IPsecService(db)

    success, error = await service.apply_config()

    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=error or "Failed to apply configuration"
        )

    return IPsecReloadResponse(
        success=True,
        message="Configuration applied successfully"
    )


@router.post("/restart", response_model=IPsecReloadResponse)
async def restart_strongswan(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Restart StrongSwan service (admin only).

    This will disconnect all active tunnels temporarily.
    """
    service = IPsecService(db)

    success, output = await service.restart_strongswan()

    return IPsecReloadResponse(
        success=success,
        message="StrongSwan restarted" if success else "Failed to restart",
        output=output
    )


# ==================== Config Preview ====================

@router.get("/config/preview", response_model=IPsecConfigPreview)
async def preview_ipsec_config(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Preview generated IPsec configuration (admin only).

    Shows what will be written to ipsec.conf and ipsec.secrets
    without applying.
    """
    service = IPsecService(db)

    preview = await service.get_preview()

    return IPsecConfigPreview(**preview)


@router.get("/config/ipsec.conf", response_class=PlainTextResponse)
async def get_ipsec_conf(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get generated ipsec.conf content (admin only)"""
    service = IPsecService(db)

    config = await service.generate_ipsec_conf()

    return PlainTextResponse(content=config)


@router.get("/config/ipsec.secrets", response_class=PlainTextResponse)
async def get_ipsec_secrets(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Get generated ipsec.secrets content (admin only).

    WARNING: Contains sensitive PSK values.
    """
    service = IPsecService(db)

    secrets = await service.generate_ipsec_secrets()

    return PlainTextResponse(content=secrets)


# ==================== Utility Endpoints ====================

@router.get("/version")
async def get_strongswan_version(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get StrongSwan version (admin only)"""
    service = IPsecService(db)

    version = await service.get_strongswan_version()
    installed = await service.check_strongswan_installed()

    return {
        "installed": installed,
        "version": version
    }


@router.get("/statusall")
async def get_detailed_status(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Get detailed IPsec status (admin only).

    Returns the raw output of 'ipsec statusall' command,
    similar to what you see on Endian Firewall or other IPsec managers.
    """
    service = IPsecService(db)
    return await service.get_detailed_status()


@router.get("/logs")
async def get_ipsec_logs(
    lines: int = Query(100, ge=10, le=1000),
    connection: Optional[str] = Query(None, description="Filter logs by connection name"),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Get recent IPsec/StrongSwan logs (admin only).

    Returns the last N lines of StrongSwan logs.
    Optionally filter by connection name.
    """
    service = IPsecService(db)
    return await service.get_logs(lines, connection)


@router.post("/sync-status", response_model=MessageResponse)
async def sync_connection_statuses(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Sync connection statuses from StrongSwan (admin only).

    Updates the database status for all connections based on
    actual StrongSwan status.
    """
    service = IPsecService(db)

    await service.update_connection_statuses()

    return MessageResponse(message="Connection statuses synchronized")


@router.get("/server-info")
async def get_server_network_info(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Get server network information for IPsec configuration (admin only).

    Returns:
    - private_ip: Server's private/internal IP address
    - public_ip: Server's public IP address (from AWS metadata or external service)
    - local_subnet: Local network subnet in CIDR notation
    - interface: Primary network interface name
    """
    service = IPsecService(db)

    return service.get_server_network_info()
