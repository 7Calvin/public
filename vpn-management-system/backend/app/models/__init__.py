"""
Database Models
"""
from app.models.user import User, UserType
from app.models.vpn_profile import VPNProfile, AuthMethod
from app.models.connection import Connection, ConnectionStatus
from app.models.firewall import FirewallRule, FirewallAction, ProtocolType
from app.models.audit_log import AuditLog
from app.models.ip_pool import IPPool
from app.models.network_route import NetworkRoute
from app.models.ipsec import IPsecConnection, IPsecStatus, IKEVersion, DPDAction
from app.models.proxy_route import ProxyRoute, ProxyRouteStatus, SSLMode, HealthCheckType
from app.models.acme_challenge import ACMEChallenge, ACMEChallengeStatus

__all__ = [
    # User
    "User",
    "UserType",
    # VPN Profile
    "VPNProfile",
    "AuthMethod",
    # Connection
    "Connection",
    "ConnectionStatus",
    # Firewall
    "FirewallRule",
    "FirewallAction",
    "ProtocolType",
    # Audit
    "AuditLog",
    # IP Pool
    "IPPool",
    # Routes
    "NetworkRoute",
    # IPsec
    "IPsecConnection",
    "IPsecStatus",
    "IKEVersion",
    "DPDAction",
    # Proxy Route
    "ProxyRoute",
    "ProxyRouteStatus",
    "SSLMode",
    "HealthCheckType",
    # ACME Challenge
    "ACMEChallenge",
    "ACMEChallengeStatus",
]
