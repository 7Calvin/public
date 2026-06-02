"""
IPsec Connection Model for StrongSwan Site-to-Site VPN
"""
from sqlalchemy import (
    Column, String, Boolean, DateTime, Text,
    ForeignKey, Enum as SQLEnum
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import enum

from app.db.session import Base


class IPsecStatus(str, enum.Enum):
    """IPsec connection status"""
    ACTIVE = "active"
    INACTIVE = "inactive"
    CONNECTING = "connecting"
    ERROR = "error"


class IKEVersion(str, enum.Enum):
    """IKE version"""
    IKEV1 = "ikev1"
    IKEV2 = "ikev2"


class DPDAction(str, enum.Enum):
    """Dead Peer Detection action"""
    RESTART = "restart"
    CLEAR = "clear"
    HOLD = "hold"
    NONE = "none"


class IPsecConnection(Base):
    """IPsec Site-to-Site Connection"""

    __tablename__ = "ipsec_connections"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Connection identification
    name = Column(String(100), nullable=False, unique=True, index=True)
    description = Column(Text)

    # Local (Left) - This server/gateway
    left_ip = Column(String(45), nullable=False)  # Private IP of gateway
    left_subnet = Column(String(500), nullable=False)  # Local network CIDR(s), comma-separated
    left_id = Column(String(100), nullable=False)  # Public IP or FQDN

    # Remote (Right) - Client/peer
    right_ip = Column(String(45), nullable=False)  # Public IP of peer
    right_subnet = Column(String(500), nullable=False)  # Remote network CIDR(s), comma-separated
    right_id = Column(String(100), nullable=False)  # Peer ID (usually same as right_ip)

    # Authentication
    auth_method = Column(String(20), default="psk")  # psk or pubkey
    psk = Column(Text)  # Pre-shared key (should be encrypted in production)

    # IKE Settings (Phase 1)
    ike_version = Column(
        SQLEnum(IKEVersion, name="ike_version", values_callable=lambda x: [e.value for e in x]),
        default=IKEVersion.IKEV2
    )
    ike_cipher = Column(String(100), default="aes256-sha256-modp2048")
    ike_lifetime = Column(String(20), default="8h")

    # ESP Settings (Phase 2) - No PFS by default for better compatibility
    esp_cipher = Column(String(100), default="aes256-sha256")
    key_lifetime = Column(String(20), default="1h")

    # Control settings
    auto_start = Column(Boolean, default=True)  # auto=start vs auto=add
    dpd_action = Column(
        SQLEnum(DPDAction, name="dpd_action", values_callable=lambda x: [e.value for e in x]),
        default=DPDAction.RESTART
    )

    # Status
    status = Column(
        SQLEnum(IPsecStatus, name="ipsec_status", values_callable=lambda x: [e.value for e in x]),
        default=IPsecStatus.INACTIVE
    )
    is_enabled = Column(Boolean, default=True, index=True)
    last_status_check = Column(DateTime(timezone=True))
    last_error = Column(Text)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )
    created_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))

    # Relationships
    created_by = relationship("User", foreign_keys=[created_by_id])

    def __repr__(self):
        return f"<IPsecConnection {self.name} ({self.right_ip})>"

    def to_ipsec_conf(self) -> str:
        """Generate ipsec.conf connection block(s)

        If multiple subnets are specified (comma-separated), generates:
        - A base connection with auto=ignore
        - Child connections for each subnet pair using also= inheritance
        """
        left_subnets = [s.strip() for s in self.left_subnet.split(',')]
        right_subnets = [s.strip() for s in self.right_subnet.split(',')]

        # Single subnet on each side - simple config
        if len(left_subnets) == 1 and len(right_subnets) == 1:
            return self._generate_single_conn()

        # Multiple subnets - use base connection with inheritance
        return self._generate_multi_subnet_conf(left_subnets, right_subnets)

    def _generate_single_conn(self) -> str:
        """Generate single connection block (no multiple subnets)"""
        lines = [
            f'conn {self.name}',
            f'    dpdaction={self.dpd_action.value}',
            f'    left={self.left_ip}',
            f'    leftsubnet={self.left_subnet}',
            f'    leftid={self.left_id}',
            f'    right={self.right_ip}',
            f'    rightsubnet={self.right_subnet}',
            f'    rightid={self.right_id}',
            f'    leftauth={self.auth_method}',
            f'    rightauth={self.auth_method}',
            f'    ike={self.ike_cipher}!',
            f'    ikelifetime={self.ike_lifetime}',
            f'    esp={self.esp_cipher}!',
            f'    keylife={self.key_lifetime}',
            f'    auto={"start" if self.auto_start else "add"}',
            f'    keyexchange={self.ike_version.value}',
        ]
        return '\n'.join(lines)

    def _generate_multi_subnet_conf(self, left_subnets: list, right_subnets: list) -> str:
        """Generate base connection + child connections for multiple subnets"""
        auto_mode = "start" if self.auto_start else "add"

        # Base connection with shared settings (auto=ignore)
        # Keeps the original name as the base/template
        lines = [
            f'# Base connection: {self.name}',
            f'conn {self.name}',
            f'    dpdaction={self.dpd_action.value}',
            f'    left={self.left_ip}',
            f'    leftid={self.left_id}',
            f'    right={self.right_ip}',
            f'    rightid={self.right_id}',
            f'    leftauth={self.auth_method}',
            f'    rightauth={self.auth_method}',
            f'    ike={self.ike_cipher}!',
            f'    ikelifetime={self.ike_lifetime}',
            f'    esp={self.esp_cipher}!',
            f'    keylife={self.key_lifetime}',
            f'    keyexchange={self.ike_version.value}',
            f'    auto=ignore',
            '',
        ]

        # Generate child connections for each subnet combination
        conn_num = 1
        for left_net in left_subnets:
            for right_net in right_subnets:
                lines.extend([
                    f'# {self.name}: {left_net} <-> {right_net}',
                    f'conn {self.name}-{conn_num}',
                    f'    also={self.name}',
                    f'    leftsubnet={left_net}',
                    f'    rightsubnet={right_net}',
                    f'    auto={auto_mode}',
                    '',
                ])
                conn_num += 1

        return '\n'.join(lines).rstrip()

    def to_ipsec_secret(self) -> str:
        """Generate ipsec.secrets lines using leftid and rightid for PSK lookup"""
        if self.auth_method == "psk" and self.psk:
            # StrongSwan looks up PSK by leftid/rightid in both directions
            # Adding both directions ensures PSK is found regardless of initiator
            lines = [
                f'{self.left_id} {self.right_id} : PSK "{self.psk}"',
                f'{self.right_id} {self.left_id} : PSK "{self.psk}"',
            ]
            return '\n'.join(lines)
        return ""
