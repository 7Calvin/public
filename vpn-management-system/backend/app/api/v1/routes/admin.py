"""
Admin Routes - System Administration
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.user import User
from app.dependencies.auth import require_admin
from app.schemas.common import MessageResponse

router = APIRouter()


@router.get("/dashboard")
async def get_admin_dashboard(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get admin dashboard summary"""
    # TODO: Implement dashboard aggregation
    return {
        "message": "Admin dashboard - to be implemented",
        "sections": [
            "user_stats",
            "connection_stats",
            "bandwidth_stats",
            "system_health"
        ]
    }


@router.get("/audit-logs")
async def get_audit_logs(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    page: int = 1,
    page_size: int = 50,
    category: Optional[str] = None,
    severity: Optional[str] = None,
    search: Optional[str] = None,
    since: Optional[str] = None,
):
    """Audit trail (admin only) with filters + pagination."""
    from datetime import datetime
    from sqlalchemy import select, func, or_, desc
    from app.models.audit_log import AuditLog

    page = max(1, page)
    page_size = min(200, max(1, page_size))

    conds = []
    if category:
        conds.append(AuditLog.resource_type == category)
    if severity:
        conds.append(AuditLog.severity == severity)
    if search:
        s = f"%{search}%"
        conds.append(or_(AuditLog.action.ilike(s), AuditLog.username.ilike(s)))
    if since:
        try:
            conds.append(AuditLog.created_at >= datetime.fromisoformat(since))
        except ValueError:
            pass

    base = select(AuditLog)
    if conds:
        base = base.where(*conds)

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    rows = (
        await db.execute(
            base.order_by(desc(AuditLog.created_at)).offset((page - 1) * page_size).limit(page_size)
        )
    ).scalars().all()

    def ser(r: AuditLog) -> dict:
        return {
            "id": str(r.id),
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "username": r.username,
            "action": r.action,
            "resource_type": r.resource_type,
            "ip_address": str(r.ip_address) if r.ip_address else None,
            "severity": r.severity,
            "details": r.details,
        }

    return {"items": [ser(r) for r in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/system/health")
async def get_system_health(
    admin: User = Depends(require_admin)
):
    """Get system health status"""
    # TODO: Implement comprehensive health check
    return {
        "status": "healthy",
        "services": {
            "database": "ok",
            "redis": "ok",
            "openvpn": "unknown",
            "firewall": "unknown"
        }
    }


@router.get("/system/config")
async def get_system_config(
    admin: User = Depends(require_admin)
):
    """Get current system configuration (sanitized)"""
    from app.core.config import settings

    # Return only safe configuration values
    return {
        "project_name": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT,
        "features": {
            "allow_registration": settings.FEATURE_ALLOW_USER_REGISTRATION,
            "enable_2fa": settings.FEATURE_ENABLE_2FA,
            "enable_api_keys": settings.FEATURE_ENABLE_API_KEYS,
            "enable_ldap": settings.FEATURE_ENABLE_LDAP,
        },
        "limits": {
            "max_users": settings.MAX_USERS,
            "max_service_accounts": settings.MAX_SERVICE_ACCOUNTS,
            "max_connections_per_user": settings.MAX_CONCURRENT_CONNECTIONS_PER_USER,
            "max_firewall_rules_per_user": settings.MAX_FIREWALL_RULES_PER_USER,
        },
        "vpn": {
            "network": settings.OPENVPN_NETWORK,
            "netmask": settings.OPENVPN_NETMASK,
            "protocol": settings.OPENVPN_PROTOCOL,
            "port": settings.OPENVPN_PORT,
        }
    }


@router.post("/system/maintenance")
async def toggle_maintenance_mode(
    enabled: bool,
    admin: User = Depends(require_admin)
):
    """Toggle maintenance mode (admin only)"""
    # TODO: Implement maintenance mode
    return {"message": f"Maintenance mode {'enabled' if enabled else 'disabled'} - to be implemented"}


@router.get("/ip-pools")
async def list_ip_pools(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """List IP address pools"""
    # TODO: Implement IP pool listing
    return {"message": "IP pools - to be implemented"}


@router.post("/ip-pools")
async def create_ip_pool(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Create a new IP pool"""
    # TODO: Implement IP pool creation
    return {"message": "IP pool creation - to be implemented"}


@router.get("/network-routes")
async def list_network_routes(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """List network routes"""
    # TODO: Implement network routes listing
    return {"message": "Network routes - to be implemented"}


@router.post("/backup")
async def create_backup(
    admin: User = Depends(require_admin)
):
    """Create system backup"""
    # TODO: Implement backup functionality
    return {"message": "Backup creation - to be implemented"}


@router.get("/backups")
async def list_backups(
    admin: User = Depends(require_admin)
):
    """List available backups"""
    # TODO: Implement backup listing
    return {"message": "Backup list - to be implemented"}
