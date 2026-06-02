"""
Connection Service - Manages VPN connections and statistics
"""
from typing import Optional, List, Tuple
from datetime import datetime, timedelta, timezone
from uuid import UUID
import subprocess
import socket
import logging

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, func, and_, or_
from sqlalchemy.orm import selectinload

from app.models.user import User
from app.models.vpn_profile import VPNProfile
from app.models.connection import Connection, ConnectionStatus
from app.core.config import settings

logger = logging.getLogger(__name__)


class ConnectionService:
    """VPN connection management service"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.management_host = "vpn-openvpn"  # OpenVPN container
        self.management_port = 7505  # OpenVPN management interface

    # ==================== Connection Queries ====================

    async def get_connection_by_id(self, connection_id: UUID) -> Optional[Connection]:
        """Get connection by ID"""
        result = await self.db.execute(
            select(Connection)
            .options(selectinload(Connection.user))
            .where(Connection.id == connection_id)
        )
        return result.scalar_one_or_none()

    async def list_connections(
        self,
        user_id: Optional[UUID] = None,
        status: Optional[ConnectionStatus] = None,
        active_only: bool = False,
        skip: int = 0,
        limit: int = 100
    ) -> Tuple[List[Connection], int]:
        """
        List connections with filtering.

        Returns:
            (list of connections, total count)
        """
        query = select(Connection).options(selectinload(Connection.user))

        filters = []

        if user_id:
            filters.append(Connection.user_id == user_id)

        if status:
            filters.append(Connection.status == status)
        elif active_only:
            filters.append(Connection.status == ConnectionStatus.ACTIVE)

        if filters:
            query = query.where(and_(*filters))

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total = await self.db.execute(count_query)
        total_count = total.scalar()

        # Apply ordering and pagination
        query = query.order_by(Connection.connected_at.desc()).offset(skip).limit(limit)

        result = await self.db.execute(query)
        connections = result.scalars().all()

        return list(connections), total_count

    async def get_active_connections(self) -> List[Connection]:
        """Get all active connections"""
        result = await self.db.execute(
            select(Connection)
            .options(selectinload(Connection.user))
            .where(Connection.status == ConnectionStatus.ACTIVE)
            .order_by(Connection.connected_at.desc())
        )
        return list(result.scalars().all())

    async def get_user_connections(
        self,
        user_id: UUID,
        active_only: bool = False,
        limit: int = 50
    ) -> List[Connection]:
        """Get connections for a specific user"""
        query = select(Connection).where(Connection.user_id == user_id)

        if active_only:
            query = query.where(Connection.status == ConnectionStatus.ACTIVE)

        query = query.order_by(Connection.connected_at.desc()).limit(limit)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_user_active_connection_count(self, user_id: UUID) -> int:
        """Get count of active connections for a user"""
        result = await self.db.execute(
            select(func.count(Connection.id))
            .where(
                Connection.user_id == user_id,
                Connection.status == ConnectionStatus.ACTIVE
            )
        )
        return result.scalar() or 0

    # ==================== Connection Management ====================

    async def record_connection(
        self,
        user: User,
        vpn_profile: Optional[VPNProfile],
        source_ip: str,
        client_version: Optional[str] = None,
        os_info: Optional[str] = None
    ) -> Tuple[Optional[Connection], Optional[str]]:
        """
        Record a new VPN connection.

        Called when a client connects to the VPN server.
        vpn_profile can be None in simplified mode (password-only auth).
        """
        # Close any stale active connections for this user
        # This handles cases where the container restarted or client reconnected
        # without the disconnect script firing
        stale_result = await self.db.execute(
            select(Connection).where(
                Connection.user_id == user.id,
                Connection.status == ConnectionStatus.ACTIVE
            )
        )
        stale_connections = stale_result.scalars().all()
        for stale in stale_connections:
            stale.status = ConnectionStatus.DISCONNECTED
            stale.disconnected_at = datetime.now(timezone.utc)
            stale.disconnect_reason = "Replaced by new connection"
            logger.info(f"Closed stale connection {stale.id} for user {user.username}")

        connection = Connection(
            user_id=user.id,
            vpn_profile_id=vpn_profile.id if vpn_profile else None,
            source_ip=source_ip,
            vpn_ip=str(vpn_profile.assigned_ip) if vpn_profile else None,
            status=ConnectionStatus.ACTIVE,
            client_version=client_version,
            os_info=os_info,
        )

        self.db.add(connection)

        # Update profile stats if profile exists
        if vpn_profile:
            vpn_profile.total_connections += 1
            vpn_profile.last_connection_at = datetime.now(timezone.utc)

        await self.db.commit()
        await self.db.refresh(connection)

        logger.info(f"Connection recorded: {user.username} from {source_ip}")
        return connection, None

    async def update_connection_stats(
        self,
        connection_id: UUID,
        bytes_sent: int,
        bytes_received: int,
        packets_sent: int = 0,
        packets_received: int = 0
    ) -> bool:
        """Update connection traffic statistics"""
        await self.db.execute(
            update(Connection)
            .where(Connection.id == connection_id)
            .values(
                bytes_sent=bytes_sent,
                bytes_received=bytes_received,
                packets_sent=packets_sent,
                packets_received=packets_received,
            )
        )
        await self.db.commit()
        return True

    async def disconnect(
        self,
        connection: Connection,
        reason: Optional[str] = None,
        force: bool = False
    ) -> bool:
        """
        Disconnect a VPN connection.

        Args:
            connection: The connection to disconnect
            reason: Reason for disconnection
            force: If True, forcibly kill the connection via OpenVPN management
        """
        if connection.status != ConnectionStatus.ACTIVE:
            return False

        if force:
            # Try to kill via OpenVPN management interface
            success = await self._kill_connection_via_management(connection)
            if not success:
                logger.warning(f"Failed to force disconnect {connection.id}")

        connection.status = ConnectionStatus.DISCONNECTED
        connection.disconnected_at = datetime.now(timezone.utc)
        connection.disconnect_reason = reason

        # Update VPN profile statistics
        vpn_profile = await self.db.execute(
            select(VPNProfile).where(VPNProfile.id == connection.vpn_profile_id)
        )
        profile = vpn_profile.scalar_one_or_none()
        if profile:
            profile.total_bytes_sent += connection.bytes_sent
            profile.total_bytes_received += connection.bytes_received

        await self.db.commit()

        logger.info(f"Connection disconnected: {connection.id}, reason: {reason}")
        return True

    async def disconnect_user(
        self,
        user_id: UUID,
        reason: Optional[str] = None
    ) -> int:
        """Disconnect all active connections for a user"""
        connections = await self.get_user_connections(user_id, active_only=True)

        count = 0
        for conn in connections:
            if await self.disconnect(conn, reason=reason, force=True):
                count += 1

        return count

    async def ban_connection(
        self,
        connection: Connection,
        reason: str,
        ban_duration_minutes: Optional[int] = None
    ) -> bool:
        """Ban a connection (mark as banned and disconnect)"""
        connection.status = ConnectionStatus.BANNED
        connection.disconnected_at = datetime.now(timezone.utc)
        connection.disconnect_reason = f"BANNED: {reason}"

        # Force kill the connection
        await self._kill_connection_via_management(connection)

        await self.db.commit()

        logger.warning(f"Connection banned: {connection.id}, reason: {reason}")
        return True

    # ==================== OpenVPN Management Interface ====================

    async def _kill_connection_via_management(self, connection: Connection) -> bool:
        """Kill a connection via OpenVPN management interface"""
        try:
            # Get username from connection's user
            username = connection.user.username if connection.user else None
            if not username:
                logger.warning(f"Cannot kill connection {connection.id} - no username")
                return False

            command = f"kill {username}\n"
            return await self._send_management_command(command)
        except Exception as e:
            logger.error(f"Failed to kill connection via management: {e}")
            return False

    async def _send_management_command(self, command: str) -> bool:
        """Send command to OpenVPN management interface"""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(5)
            sock.connect((self.management_host, self.management_port))

            # Wait for banner
            sock.recv(1024)

            # Send command
            sock.send(command.encode())

            # Get response
            response = sock.recv(1024).decode()
            sock.close()

            return "SUCCESS" in response or "END" in response

        except socket.error as e:
            logger.error(f"Management interface error: {e}")
            return False

    async def get_live_connections_from_server(self) -> List[dict]:
        """Get live connection info from OpenVPN server"""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(5)
            sock.connect((self.management_host, self.management_port))

            # Wait for banner
            sock.recv(1024)

            # Request status
            sock.send(b"status\n")

            # Read response
            response = b""
            while True:
                chunk = sock.recv(4096)
                response += chunk
                if b"END" in chunk:
                    break

            sock.close()

            return self._parse_status_response(response.decode())

        except Exception as e:
            logger.error(f"Failed to get live connections: {e}")
            return []

    def _parse_status_response(self, response: str) -> List[dict]:
        """Parse OpenVPN status response"""
        connections = []
        in_client_list = False
        routing_table = {}

        lines = response.split("\n")
        for i, line in enumerate(lines):
            line = line.strip()

            # Start of client list section
            if line.startswith("Common Name,Real Address"):
                in_client_list = True
                continue

            # End of client list section
            if line.startswith("ROUTING TABLE") or line.startswith("GLOBAL STATS"):
                in_client_list = False
                continue

            # Parse routing table to get virtual IPs
            if line.startswith("Virtual Address,"):
                # Parse subsequent routing entries
                for j in range(i + 1, len(lines)):
                    route_line = lines[j].strip()
                    if route_line.startswith("GLOBAL STATS") or not route_line or route_line == "END":
                        break
                    route_parts = route_line.split(",")
                    if len(route_parts) >= 2:
                        # common_name -> virtual_ip
                        routing_table[route_parts[1]] = route_parts[0]

            # Parse client entries
            if in_client_list and line and not line.startswith("Updated,"):
                parts = line.split(",")
                if len(parts) >= 5:
                    common_name = parts[0]
                    # Find virtual IP from routing table
                    virtual_ip = None
                    for cn, vip in routing_table.items():
                        if cn == common_name:
                            virtual_ip = vip
                            break

                    connections.append({
                        "common_name": common_name,
                        "real_address": parts[1],
                        "virtual_address": virtual_ip,
                        "bytes_received": int(parts[2]) if parts[2].isdigit() else 0,
                        "bytes_sent": int(parts[3]) if parts[3].isdigit() else 0,
                        "connected_since": parts[4],
                    })

        # Fill in virtual IPs from routing table
        for conn in connections:
            if not conn["virtual_address"] and conn["common_name"] in routing_table:
                conn["virtual_address"] = routing_table[conn["common_name"]]

        return connections

    # ==================== Statistics ====================

    async def get_stats(self) -> dict:
        """Get connection statistics"""
        now = datetime.now(timezone.utc)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = today_start - timedelta(days=now.weekday())
        month_start = today_start.replace(day=1)

        # Total connections
        total_result = await self.db.execute(
            select(func.count(Connection.id))
        )
        total = total_result.scalar() or 0

        # Active connections
        active_result = await self.db.execute(
            select(func.count(Connection.id))
            .where(Connection.status == ConnectionStatus.ACTIVE)
        )
        active = active_result.scalar() or 0

        # Connections today
        today_result = await self.db.execute(
            select(func.count(Connection.id))
            .where(Connection.connected_at >= today_start)
        )
        today = today_result.scalar() or 0

        # Connections this week
        week_result = await self.db.execute(
            select(func.count(Connection.id))
            .where(Connection.connected_at >= week_start)
        )
        this_week = week_result.scalar() or 0

        # Connections this month
        month_result = await self.db.execute(
            select(func.count(Connection.id))
            .where(Connection.connected_at >= month_start)
        )
        this_month = month_result.scalar() or 0

        # Unique users today
        unique_users_result = await self.db.execute(
            select(func.count(func.distinct(Connection.user_id)))
            .where(Connection.connected_at >= today_start)
        )
        unique_users_today = unique_users_result.scalar() or 0

        # Active users (distinct users with active connections)
        active_users_result = await self.db.execute(
            select(func.count(func.distinct(Connection.user_id)))
            .where(Connection.status == ConnectionStatus.ACTIVE)
        )
        active_users = active_users_result.scalar() or 0

        # Total bytes sent/received
        bytes_result = await self.db.execute(
            select(
                func.coalesce(func.sum(Connection.bytes_sent), 0),
                func.coalesce(func.sum(Connection.bytes_received), 0)
            )
        )
        bytes_row = bytes_result.first()
        total_bytes_sent = int(bytes_row[0]) if bytes_row else 0
        total_bytes_received = int(bytes_row[1]) if bytes_row else 0

        return {
            "total_connections": total,
            "active_connections": active,
            "active_users": active_users,
            "connections_today": today,
            "connections_this_week": this_week,
            "connections_this_month": this_month,
            "unique_users_today": unique_users_today,
            "peak_concurrent_today": 0,  # TODO: Track peak
            "total_bytes_sent": total_bytes_sent,
            "total_bytes_received": total_bytes_received,
        }

    async def get_bandwidth_stats(
        self,
        user_id: Optional[UUID] = None,
        period: str = "day"
    ) -> dict:
        """Get bandwidth usage statistics"""
        now = datetime.now(timezone.utc)

        period_map = {
            "hour": timedelta(hours=1),
            "day": timedelta(days=1),
            "week": timedelta(weeks=1),
            "month": timedelta(days=30),
        }

        start_time = now - period_map.get(period, timedelta(days=1))

        query = select(
            func.sum(Connection.bytes_sent),
            func.sum(Connection.bytes_received),
            func.count(Connection.id)
        ).where(Connection.connected_at >= start_time)

        if user_id:
            query = query.where(Connection.user_id == user_id)

        result = await self.db.execute(query)
        row = result.one()

        total_sent = row[0] or 0
        total_received = row[1] or 0
        connection_count = row[2] or 1  # Avoid division by zero

        return {
            "period": period,
            "total_bytes_sent": total_sent,
            "total_bytes_received": total_received,
            "average_bytes_per_connection": (total_sent + total_received) // connection_count,
            "peak_bandwidth_mbps": 0,  # TODO: Track peak bandwidth
            "data_points": [],  # TODO: Time series data
        }

    async def get_user_stats(self, user_id: UUID) -> dict:
        """Get statistics for a specific user"""
        result = await self.db.execute(
            select(
                func.count(Connection.id),
                func.sum(Connection.duration_seconds),
                func.sum(Connection.bytes_sent),
                func.sum(Connection.bytes_received),
                func.max(Connection.connected_at)
            ).where(Connection.user_id == user_id)
        )
        row = result.one()

        # Check if currently connected
        active_result = await self.db.execute(
            select(func.count(Connection.id))
            .where(
                Connection.user_id == user_id,
                Connection.status == ConnectionStatus.ACTIVE
            )
        )
        is_connected = (active_result.scalar() or 0) > 0

        # Get username
        user_result = await self.db.execute(
            select(User.username).where(User.id == user_id)
        )
        username = user_result.scalar() or "unknown"

        return {
            "user_id": str(user_id),
            "username": username,
            "total_connections": row[0] or 0,
            "total_duration_seconds": row[1] or 0,
            "total_bytes_sent": row[2] or 0,
            "total_bytes_received": row[3] or 0,
            "last_connection_at": row[4],
            "is_currently_connected": is_connected,
        }

    # ==================== Cleanup ====================

    async def cleanup_stale_connections(self, max_age_hours: int = 24) -> int:
        """Mark stale connections as disconnected by syncing with OpenVPN"""
        count = 0

        # Get live connections from OpenVPN
        live_connections = await self.get_live_connections_from_server()
        live_usernames = {lc["common_name"] for lc in live_connections}

        # Get all active connections from database
        result = await self.db.execute(
            select(Connection)
            .options(selectinload(Connection.user))
            .where(Connection.status == ConnectionStatus.ACTIVE)
        )
        db_active = result.scalars().all()

        # Mark connections not in live list as disconnected
        for conn in db_active:
            username = conn.user.username if conn.user else None
            if username and username not in live_usernames:
                conn.status = ConnectionStatus.DISCONNECTED
                conn.disconnected_at = datetime.now(timezone.utc)
                conn.disconnect_reason = "Stale connection cleanup - not in OpenVPN"
                count += 1
                logger.info(f"Cleaned up stale connection for user {username}")

        # Also clean up very old connections (fallback)
        cutoff = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
        old_result = await self.db.execute(
            update(Connection)
            .where(
                Connection.status == ConnectionStatus.ACTIVE,
                Connection.connected_at < cutoff
            )
            .values(
                status=ConnectionStatus.DISCONNECTED,
                disconnected_at=datetime.now(timezone.utc),
                disconnect_reason="Stale connection cleanup - too old"
            )
        )
        count += old_result.rowcount

        await self.db.commit()

        if count > 0:
            logger.info(f"Cleaned up {count} stale connections total")

        return count
