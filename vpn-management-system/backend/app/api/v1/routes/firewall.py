"""
Firewall Routes - Rules Management
"""
from typing import Optional
from uuid import UUID
import httpx
import logging
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.user import User
from app.services.firewall_service import FirewallService
from app.dependencies.auth import get_current_active_user, require_admin
from app.schemas.firewall import (
    FirewallRuleCreate,
    FirewallRuleUpdate,
    FirewallRuleResponse,
    FirewallRuleListResponse,
    FirewallStatus,
    NATRuleCreate,
    NATRuleUpdate,
    NATRuleResponse,
)
from app.schemas.common import MessageResponse, PaginatedResponse
from app.core.config import settings

logger = logging.getLogger(__name__)


async def apply_nat_rules_via_agent() -> dict:
    """Call NAT agent to apply rules"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{settings.NAT_AGENT_URL}/apply",
                headers={"X-Api-Token": settings.NAT_AGENT_TOKEN}
            )
            if response.status_code == 200:
                result = response.json()
                logger.info(f"NAT rules applied: {result}")
                return result
            else:
                logger.error(f"NAT agent error: {response.status_code} - {response.text}")
                return {"success": False, "error": f"HTTP {response.status_code}"}
    except httpx.ConnectError:
        logger.warning("NAT agent not available - rules saved but not applied")
        return {"success": False, "error": "NAT agent not available"}
    except Exception as e:
        logger.error(f"Failed to call NAT agent: {e}")
        return {"success": False, "error": str(e)}

router = APIRouter()


# Quick rule definitions
QUICK_RULES = {
    "block-client-to-client": {
        "name": "block-client-to-client",
        "description": "Block VPN clients from communicating with each other",
        "action": "drop",
        "protocol": "all",
        "priority": 5,
        "applies_to_human_users": True,
        "applies_to_service_accounts": True,
    },
    "allow-internal-network": {
        "name": "allow-internal-network",
        "description": "Allow access to internal network (from push routes)",
        "action": "accept",
        "protocol": "all",
        "destination_network": "192.168.0.0/16",
        "priority": 50,
        "applies_to_human_users": True,
        "applies_to_service_accounts": True,
    },
}


@router.get("/rules", response_model=PaginatedResponse[FirewallRuleListResponse])
async def list_firewall_rules(
    user_id: Optional[UUID] = None,
    is_active: Optional[bool] = None,
    include_global: bool = Query(True, description="Include global rules"),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    List firewall rules (admin only).

    - Filter by user_id to see user-specific rules
    - include_global=true includes rules that apply to all users
    """
    firewall_service = FirewallService(db)

    rules, total = await firewall_service.list_rules(
        user_id=user_id,
        is_active=is_active,
        include_global=include_global,
        skip=(page - 1) * per_page,
        limit=per_page
    )

    return PaginatedResponse.create(
        items=[FirewallRuleListResponse.model_validate(r) for r in rules],
        total=total,
        page=page,
        per_page=per_page
    )


@router.post("/rules", response_model=FirewallRuleResponse, status_code=status.HTTP_201_CREATED)
async def create_firewall_rule(
    data: FirewallRuleCreate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Create a new firewall rule (admin only)"""
    firewall_service = FirewallService(db)

    rule, error = await firewall_service.create_rule(data, admin)

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    return rule


@router.get("/rules/{rule_id}", response_model=FirewallRuleResponse)
async def get_firewall_rule(
    rule_id: UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get firewall rule details (admin only)"""
    firewall_service = FirewallService(db)

    rule = await firewall_service.get_rule_by_id(rule_id)

    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Firewall rule not found"
        )

    return rule


@router.patch("/rules/{rule_id}", response_model=FirewallRuleResponse)
async def update_firewall_rule(
    rule_id: UUID,
    data: FirewallRuleUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Update firewall rule (admin only)"""
    firewall_service = FirewallService(db)

    rule = await firewall_service.get_rule_by_id(rule_id)

    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Firewall rule not found"
        )

    updated_rule, error = await firewall_service.update_rule(rule, data, admin)

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    return updated_rule


@router.delete("/rules/{rule_id}", response_model=MessageResponse)
async def delete_firewall_rule(
    rule_id: UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Delete firewall rule (admin only)"""
    firewall_service = FirewallService(db)

    rule = await firewall_service.get_rule_by_id(rule_id)

    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Firewall rule not found"
        )

    success, error = await firewall_service.delete_rule(rule, admin)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    return MessageResponse(message="Firewall rule deleted")


@router.post("/apply", response_model=MessageResponse)
async def apply_firewall_rules(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Apply all firewall rules to nftables (admin only).

    This regenerates and applies the nftables configuration
    based on all active rules in the database.
    """
    firewall_service = FirewallService(db)

    success, error = await firewall_service.apply_rules()

    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=error or "Failed to apply firewall rules"
        )

    return MessageResponse(message="Firewall rules applied successfully")


@router.get("/config", response_class=PlainTextResponse)
async def get_firewall_config(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Get generated nftables configuration (admin only).

    Returns the nftables configuration that would be applied.
    Useful for review before applying.
    """
    firewall_service = FirewallService(db)

    config = await firewall_service.generate_nftables_config()

    return PlainTextResponse(content=config)


@router.get("/status", response_model=FirewallStatus)
async def get_firewall_status(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get current firewall status (admin only)"""
    firewall_service = FirewallService(db)

    status_data = await firewall_service.get_status()

    return FirewallStatus(**status_data)


@router.post("/init-defaults", response_model=MessageResponse)
async def initialize_default_rules(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Initialize default firewall rules (admin only).

    Creates standard rules for ICMP, DNS, HTTP/HTTPS.
    Safe to call multiple times - won't create duplicates.
    """
    firewall_service = FirewallService(db)

    await firewall_service.create_default_rules()

    return MessageResponse(message="Default firewall rules initialized")


# ==================== User-specific Routes ====================

@router.get("/my-rules", response_model=list[FirewallRuleListResponse])
async def get_my_firewall_rules(
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get firewall rules that apply to the current user.

    Includes both user-specific rules and applicable global rules.
    """
    firewall_service = FirewallService(db)

    rules = await firewall_service.get_rules_for_user(user)

    return [FirewallRuleListResponse.model_validate(r) for r in rules]


# ==================== Quick Rules ====================

@router.get("/quick-rules")
async def get_quick_rules_status(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get status of all quick rules (admin only)"""
    from sqlalchemy import select
    from app.models.firewall import FirewallRule

    result = {}
    for rule_key in QUICK_RULES.keys():
        # Check if rule exists
        query = await db.execute(
            select(FirewallRule).where(FirewallRule.name == rule_key)
        )
        rule = query.scalar_one_or_none()

        result[rule_key] = {
            "exists": rule is not None,
            "is_active": rule.is_active if rule else False,
            "id": str(rule.id) if rule else None,
            "description": QUICK_RULES[rule_key]["description"],
        }

    return result


@router.post("/quick-rules/{rule_key}/toggle")
async def toggle_quick_rule(
    rule_key: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Toggle a quick rule on/off (admin only).

    If rule doesn't exist, creates it as active.
    If rule exists, toggles its active status.
    """
    from sqlalchemy import select
    from app.models.firewall import FirewallRule, FirewallAction, ProtocolType

    if rule_key not in QUICK_RULES:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Quick rule '{rule_key}' not found"
        )

    rule_def = QUICK_RULES[rule_key]

    # Check if rule exists
    query = await db.execute(
        select(FirewallRule).where(FirewallRule.name == rule_key)
    )
    rule = query.scalar_one_or_none()

    if rule:
        # Rule exists - delete it (toggle OFF = remove rule)
        await db.delete(rule)
        await db.commit()

        # Auto-apply firewall rules after deleting quick rule
        firewall_service = FirewallService(db)
        await firewall_service.apply_rules()

        return {
            "action": "deleted",
            "is_active": False,
            "id": None,
        }
    else:
        # Create new rule
        from app.services.vpn_service import get_server_config
        import ipaddress

        server_config = get_server_config()

        # Get VPN network for client-to-client rule
        vpn_network = None
        if rule_key == "block-client-to-client":
            vpn_net = server_config.get("vpn_network", settings.OPENVPN_NETWORK)
            vpn_mask = server_config.get("vpn_netmask", settings.OPENVPN_NETMASK)
            # Convert netmask to CIDR
            network = ipaddress.ip_network(f"{vpn_net}/{vpn_mask}", strict=False)
            vpn_network = str(network)

        # For allow-internal-network, determine which networks to allow.
        # Priority: push_routes from VPN settings > NAT_GATEWAY_NETWORK from .env > all RFC1918
        internal_networks = None
        if rule_key == "allow-internal-network":
            push_routes = server_config.get("push_routes", [])
            if push_routes:
                internal_networks = ",".join(push_routes)
            elif settings.NAT_GATEWAY_NETWORK:
                internal_networks = settings.NAT_GATEWAY_NETWORK
            else:
                # Fallback: allow all RFC1918 private networks
                internal_networks = "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"

        new_rule = FirewallRule(
            name=rule_def["name"],
            description=rule_def["description"],
            action=FirewallAction(rule_def["action"]),
            protocol=ProtocolType(rule_def["protocol"]),
            priority=rule_def["priority"],
            source_network=vpn_network if rule_key == "block-client-to-client" else rule_def.get("source_network"),
            destination_network=(
                vpn_network if rule_key == "block-client-to-client"
                else internal_networks if rule_key == "allow-internal-network"
                else rule_def.get("destination_network")
            ),
            destination_port_range=rule_def.get("destination_port_range"),
            applies_to_human_users=rule_def.get("applies_to_human_users", True),
            applies_to_service_accounts=rule_def.get("applies_to_service_accounts", True),
            created_by_id=admin.id,
            is_active=True,
        )

        db.add(new_rule)
        await db.commit()
        await db.refresh(new_rule)

        # Auto-apply firewall rules after creating quick rule
        firewall_service = FirewallService(db)
        await firewall_service.apply_rules()

        return {
            "action": "created",
            "is_active": True,
            "id": str(new_rule.id),
        }


# ==================== NAT/DNAT Routes ====================

@router.get("/nat", response_model=list[NATRuleResponse])
async def list_nat_rules(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """List all NAT rules (admin only)"""
    from sqlalchemy import select
    from app.models.firewall import NATRule

    result = await db.execute(
        select(NATRule).order_by(NATRule.external_port)
    )
    rules = result.scalars().all()

    return [NATRuleResponse.model_validate(r) for r in rules]


@router.post("/nat", response_model=NATRuleResponse, status_code=status.HTTP_201_CREATED)
async def create_nat_rule(
    data: NATRuleCreate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Create a new NAT rule (admin only)"""
    from sqlalchemy import select
    from app.models.firewall import NATRule

    # Check if external port is already in use
    existing = await db.execute(
        select(NATRule).where(
            NATRule.external_port == data.external_port,
            NATRule.protocol == data.protocol
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Port {data.external_port}/{data.protocol.value} is already in use"
        )

    new_rule = NATRule(
        name=data.name,
        description=data.description,
        nat_type=data.nat_type,
        protocol=data.protocol,
        external_port=data.external_port,
        internal_ip=data.internal_ip,
        internal_port=data.internal_port,
        source_network=data.source_network,
        created_by_id=admin.id,
        is_active=True,
    )

    db.add(new_rule)
    await db.flush()  # Get the ID before commit

    # Also create a corresponding firewall rule to allow the traffic
    from app.models.firewall import FirewallRule, FirewallAction

    firewall_rule = FirewallRule(
        name=f"nat-{data.name}",
        description=f"Allow traffic for port forwarding: {data.external_port} -> {data.internal_ip}:{data.internal_port}",
        action=FirewallAction.ACCEPT,
        protocol=data.protocol,
        destination_network=str(data.internal_ip),
        destination_port_range=str(data.internal_port),
        priority=60,  # After quick rules but before general rules
        applies_to_human_users=True,
        applies_to_service_accounts=True,
        created_by_id=admin.id,
        is_active=True,
    )
    db.add(firewall_rule)

    await db.commit()
    await db.refresh(new_rule)

    # Apply rules via NAT agent
    await apply_nat_rules_via_agent()

    return new_rule


@router.get("/nat/{rule_id}", response_model=NATRuleResponse)
async def get_nat_rule(
    rule_id: UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get NAT rule details (admin only)"""
    from sqlalchemy import select
    from app.models.firewall import NATRule

    result = await db.execute(
        select(NATRule).where(NATRule.id == rule_id)
    )
    rule = result.scalar_one_or_none()

    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="NAT rule not found"
        )

    return rule


@router.patch("/nat/{rule_id}", response_model=NATRuleResponse)
async def update_nat_rule(
    rule_id: UUID,
    data: NATRuleUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Update NAT rule (admin only)"""
    from sqlalchemy import select
    from app.models.firewall import NATRule

    result = await db.execute(
        select(NATRule).where(NATRule.id == rule_id)
    )
    rule = result.scalar_one_or_none()

    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="NAT rule not found"
        )

    update_data = data.model_dump(exclude_unset=True)

    # If changing external port, check for conflicts
    if "external_port" in update_data:
        protocol = update_data.get("protocol", rule.protocol)
        existing = await db.execute(
            select(NATRule).where(
                NATRule.external_port == update_data["external_port"],
                NATRule.protocol == protocol,
                NATRule.id != rule_id
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Port {update_data['external_port']}/{protocol.value} is already in use"
            )

    for field, value in update_data.items():
        setattr(rule, field, value)

    # Sync is_active status with associated firewall rule
    if "is_active" in update_data:
        from app.models.firewall import FirewallRule
        firewall_rule_name = f"nat-{rule.name}"
        fw_result = await db.execute(
            select(FirewallRule).where(FirewallRule.name == firewall_rule_name)
        )
        fw_rule = fw_result.scalar_one_or_none()
        if fw_rule:
            fw_rule.is_active = update_data["is_active"]

    await db.commit()
    await db.refresh(rule)

    # Apply rules via NAT agent
    await apply_nat_rules_via_agent()

    return rule


@router.post("/nat/apply", response_model=MessageResponse)
async def apply_nat_rules(
    admin: User = Depends(require_admin),
):
    """Manually apply all NAT rules via NAT agent (admin only)"""
    result = await apply_nat_rules_via_agent()

    if not result.get('success'):
        error = result.get('error', 'Unknown error')
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to apply NAT rules: {error}"
        )

    return MessageResponse(
        message=f"NAT rules applied: {result.get('applied', 0)} of {result.get('total', 0)} rules"
    )


@router.delete("/nat/{rule_id}", response_model=MessageResponse)
async def delete_nat_rule(
    rule_id: UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Delete NAT rule (admin only)"""
    from sqlalchemy import select
    from app.models.firewall import NATRule, FirewallRule

    result = await db.execute(
        select(NATRule).where(NATRule.id == rule_id)
    )
    rule = result.scalar_one_or_none()

    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="NAT rule not found"
        )

    # Also delete the associated firewall rule
    firewall_rule_name = f"nat-{rule.name}"
    fw_result = await db.execute(
        select(FirewallRule).where(FirewallRule.name == firewall_rule_name)
    )
    fw_rule = fw_result.scalar_one_or_none()
    if fw_rule:
        await db.delete(fw_rule)

    await db.delete(rule)
    await db.commit()

    # Apply rules via NAT agent (will remove deleted rule)
    await apply_nat_rules_via_agent()

    return MessageResponse(message="NAT rule and associated firewall rule deleted")
