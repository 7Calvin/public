"""
Audit service.

An HTTP middleware records mutating actions (create/update/delete, config
changes, MFA/password, updates) automatically — mapping method+path to a
friendly action, resolving the actor from the JWT, and never breaking requests.
Login is instrumented explicitly in the auth route (no token yet at that point).
"""
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import delete, select

from app.core.security import decode_token
from app.db.session import AsyncSessionLocal
from app.models.audit_log import AuditLog
from app.models.user import User

logger = logging.getLogger(__name__)

_P = "/api/v1"

# (method, path-regex, resource_type, friendly label)
_RULES = [
    ("POST", rf"^{_P}/users/?$", "users", "Usuário criado"),
    ("PUT", rf"^{_P}/users/[^/]+/?$", "users", "Usuário alterado"),
    ("PATCH", rf"^{_P}/users/[^/]+/?$", "users", "Usuário alterado"),
    ("DELETE", rf"^{_P}/users/[^/]+/?$", "users", "Usuário removido"),
    ("POST", rf"^{_P}/users/[^/]+/reset-password/?$", "users", "Senha de usuário redefinida"),
    ("PUT", rf"^{_P}/vpn/server/config/?$", "config", "Configuração do servidor VPN alterada"),
    ("POST", rf"^{_P}/vpn/certificate/regenerate/?$", "config", "Certificado do OpenVPN regenerado"),
    ("POST", rf"^{_P}/ipsec/connections/?$", "ipsec", "Conexão IPsec criada"),
    ("PUT", rf"^{_P}/ipsec/connections/[^/]+/?$", "ipsec", "Conexão IPsec alterada"),
    ("DELETE", rf"^{_P}/ipsec/connections/[^/]+/?$", "ipsec", "Conexão IPsec removida"),
    ("POST", rf"^{_P}/ipsec/connections/[^/]+/(start|restart|stop)/?$", "ipsec", "Ação em túnel IPsec"),
    ("POST", rf"^{_P}/ipsec/restart/?$", "ipsec", "StrongSwan reiniciado"),
    ("POST", rf"^{_P}/proxy/routes/?$", "config", "Rota de proxy criada"),
    ("PUT", rf"^{_P}/proxy/routes/[^/]+/?$", "config", "Rota de proxy alterada"),
    ("DELETE", rf"^{_P}/proxy/routes/[^/]+/?$", "config", "Rota de proxy removida"),
    ("PUT", rf"^{_P}/proxy/management-domain/?$", "config", "Domínio do painel alterado"),
    ("POST", rf"^{_P}/proxy/certificates/[^/]+/renew/?$", "config", "Certificado reemitido"),
    ("POST", rf"^{_P}/firewall/rules/?$", "config", "Regra de firewall criada"),
    ("PUT", rf"^{_P}/firewall/rules/[^/]+/?$", "config", "Regra de firewall alterada"),
    ("DELETE", rf"^{_P}/firewall/rules/[^/]+/?$", "config", "Regra de firewall removida"),
    ("POST", rf"^{_P}/firewall/quick-rules/[^/]+/?$", "config", "Regra rápida de firewall alterada"),
    ("POST", rf"^{_P}/firewall/apply/?$", "config", "Firewall aplicado"),
    ("POST", rf"^{_P}/auth/logout/?$", "auth", "Logout"),
    ("POST", rf"^{_P}/auth/password/change/?$", "auth", "Senha alterada"),
    ("POST", rf"^{_P}/auth/mfa/verify/?$", "auth", "MFA ativado"),
    ("POST", rf"^{_P}/auth/mfa/disable/?$", "auth", "MFA desativado"),
    ("POST", rf"^{_P}/system/update/?$", "system", "Atualização iniciada"),
]
_COMPILED = [(m, re.compile(rx), rt, lbl) for (m, rx, rt, lbl) in _RULES]
_UUID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")

# Categories usable as filters in the read API / UI.
CATEGORIES = ["auth", "users", "vpn", "ipsec", "config", "system"]


def _match(method: str, path: str):
    for m, rx, rt, lbl in _COMPILED:
        if m == method and rx.match(path):
            return rt, lbl
    return None


def _last_uuid(path: str) -> Optional[uuid.UUID]:
    found = _UUID_RE.findall(path)
    if found:
        try:
            return uuid.UUID(found[-1])
        except ValueError:
            return None
    return None


def _client_ip(request) -> Optional[str]:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else None


def _actor_id(request) -> Optional[uuid.UUID]:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    payload = decode_token(auth.split(" ", 1)[1])
    if not payload or payload.get("mfa_pending"):
        return None
    sub = payload.get("sub")
    try:
        return uuid.UUID(str(sub))
    except (ValueError, TypeError):
        return None


async def _resolve_target(path: str) -> Optional[str]:
    """Best-effort display name of the resource in the path (users/ipsec/proxy/
    firewall). Resolved BEFORE the action so deletes still find the row."""
    rid = _last_uuid(path)
    if not rid:
        return None
    try:
        if re.search(rf"^{_P}/users/", path):
            from app.models.user import User
            model, field = User, User.username
        elif "/ipsec/connections/" in path:
            from app.models.ipsec import IPsecConnection
            model, field = IPsecConnection, IPsecConnection.name
        elif "/proxy/routes/" in path:
            from app.models.proxy_route import ProxyRoute
            model, field = ProxyRoute, ProxyRoute.name
        elif "/firewall/rules/" in path:
            from app.models.firewall import FirewallRule
            model, field = FirewallRule, FirewallRule.name
        else:
            return None
        async with AsyncSessionLocal() as db:
            return (await db.execute(select(field).where(model.id == rid))).scalar_one_or_none()
    except Exception:  # noqa: BLE001
        return None


async def pre_audit(request) -> Optional[dict]:
    """Runs BEFORE the handler: for any audited action that targets a specific
    resource (delete, edit, reset-password, tunnel start/stop…), capture the
    target's display name while the row still exists. Returns a context or None.
    Only issues a read query, so it is safe to run before call_next."""
    if not _match(request.method, request.url.path):
        return None
    name = await _resolve_target(request.url.path)
    return {"target": name} if name else None


async def record_event(
    *, action: str, resource_type: str = None, resource_id: uuid.UUID = None,
    user_id: uuid.UUID = None, username: str = None, ip: str = None,
    user_agent: str = None, details: dict = None, severity: str = "info",
):
    """Persist one audit entry. Never raises — auditing must not break the app."""
    try:
        async with AsyncSessionLocal() as db:
            uname = username
            if user_id and not uname:
                uname = (await db.execute(select(User.username).where(User.id == user_id))).scalar_one_or_none()
            AuditLog.log_action(
                db, user_id=user_id, username=uname or "sistema", action=action,
                resource_type=resource_type, resource_id=resource_id, details=details,
                ip_address=ip, user_agent=user_agent, severity=severity,
            )
            await db.commit()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"audit write failed: {e}")


async def record_request(request, status_code: int, ctx: Optional[dict] = None):
    """Middleware hook: log a mutating request if it maps to an audited action."""
    matched = _match(request.method, request.url.path)
    if not matched:
        return
    resource_type, label = matched
    target = (ctx or {}).get("target")
    if target:
        label = f"{label}: {target}"
    if status_code >= 400:
        label = f"{label} (falhou)"
    severity = "info" if status_code < 400 else ("warning" if status_code < 500 else "error")
    details = {"method": request.method, "path": request.url.path, "status": status_code}
    if target:
        details["target"] = target
    await record_event(
        action=label, resource_type=resource_type, resource_id=_last_uuid(request.url.path),
        user_id=_actor_id(request), ip=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        details=details, severity=severity,
    )


async def prune_old(days: int) -> int:
    """Delete audit entries older than `days`. Returns rows deleted (best effort)."""
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, days))
        async with AsyncSessionLocal() as db:
            r = await db.execute(delete(AuditLog).where(AuditLog.created_at < cutoff))
            await db.commit()
            return r.rowcount or 0
    except Exception as e:  # noqa: BLE001
        logger.warning(f"audit prune failed: {e}")
        return 0
