"""
IPsec Service - Manages StrongSwan IPsec Site-to-Site VPN connections
"""
from typing import Optional, List, Tuple, Dict, Any
from datetime import datetime
from uuid import UUID
import subprocess
import logging
import re
import os
import httpx

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models.ipsec import IPsecConnection, IPsecStatus
from app.models.user import User
from app.schemas.ipsec import IPsecConnectionCreate, IPsecConnectionUpdate

logger = logging.getLogger(__name__)

# IPsec Agent configuration
IPSEC_AGENT_URL = os.environ.get("IPSEC_AGENT_URL", "http://127.0.0.1:8101")
IPSEC_AGENT_TOKEN = os.environ.get("IPSEC_AGENT_TOKEN", "changeme-ipsec-token")


class IPsecService:
    """StrongSwan IPsec connection management"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.ipsec_conf_path = "/etc/ipsec.conf"
        self.ipsec_secrets_path = "/etc/ipsec.secrets"
        self.agent_url = IPSEC_AGENT_URL
        self.agent_token = IPSEC_AGENT_TOKEN

    # ==================== CRUD Operations ====================

    async def get_connection_by_id(self, connection_id: UUID) -> Optional[IPsecConnection]:
        """Get IPsec connection by ID"""
        result = await self.db.execute(
            select(IPsecConnection).where(IPsecConnection.id == connection_id)
        )
        return result.scalar_one_or_none()

    async def get_connection_by_name(self, name: str) -> Optional[IPsecConnection]:
        """Get IPsec connection by name"""
        result = await self.db.execute(
            select(IPsecConnection).where(IPsecConnection.name == name)
        )
        return result.scalar_one_or_none()

    async def list_connections(
        self,
        is_enabled: Optional[bool] = None,
        skip: int = 0,
        limit: int = 100
    ) -> Tuple[List[IPsecConnection], int]:
        """List IPsec connections with filtering and pagination"""
        query = select(IPsecConnection)

        if is_enabled is not None:
            query = query.where(IPsecConnection.is_enabled == is_enabled)

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total = await self.db.execute(count_query)
        total_count = total.scalar()

        # Apply ordering and pagination
        query = query.order_by(
            IPsecConnection.name
        ).offset(skip).limit(limit)

        result = await self.db.execute(query)
        connections = result.scalars().all()

        return list(connections), total_count

    async def create_connection(
        self,
        data: IPsecConnectionCreate,
        created_by: User
    ) -> Tuple[Optional[IPsecConnection], Optional[str]]:
        """Create a new IPsec connection"""
        # Check for duplicate name
        existing = await self.get_connection_by_name(data.name)
        if existing:
            return None, f"Connection with name '{data.name}' already exists"

        # Validate PSK is provided for PSK auth
        if data.auth_method == "psk" and not data.psk:
            return None, "PSK (Pre-Shared Key) is required for PSK authentication"

        connection = IPsecConnection(
            name=data.name,
            description=data.description,
            left_ip=data.left_ip,
            left_subnet=data.left_subnet,
            left_id=data.left_id,
            right_ip=data.right_ip,
            right_subnet=data.right_subnet,
            right_id=data.right_id,
            auth_method=data.auth_method,
            psk=data.psk,
            ike_version=data.ike_version,
            ike_cipher=data.ike_cipher,
            ike_lifetime=data.ike_lifetime,
            esp_cipher=data.esp_cipher,
            key_lifetime=data.key_lifetime,
            auto_start=data.auto_start,
            dpd_action=data.dpd_action,
            is_enabled=data.is_enabled,
            status=IPsecStatus.INACTIVE,
            created_by_id=created_by.id,
        )

        self.db.add(connection)
        await self.db.commit()
        await self.db.refresh(connection)

        logger.info(f"IPsec connection created: {connection.name} by {created_by.username}")
        return connection, None

    async def update_connection(
        self,
        connection: IPsecConnection,
        data: IPsecConnectionUpdate,
        updated_by: User
    ) -> Tuple[IPsecConnection, Optional[str]]:
        """Update an IPsec connection"""
        update_data = data.model_dump(exclude_unset=True)

        # Check for name conflict if name is being changed
        if "name" in update_data and update_data["name"] != connection.name:
            existing = await self.get_connection_by_name(update_data["name"])
            if existing:
                return connection, f"Connection with name '{update_data['name']}' already exists"

        for field, value in update_data.items():
            setattr(connection, field, value)

        await self.db.commit()
        await self.db.refresh(connection)

        logger.info(f"IPsec connection updated: {connection.name} by {updated_by.username}")
        return connection, None

    async def delete_connection(
        self,
        connection: IPsecConnection,
        deleted_by: User
    ) -> Tuple[bool, Optional[str]]:
        """Delete an IPsec connection"""
        # Stop the connection first if active
        if connection.status == IPsecStatus.ACTIVE:
            await self.stop_connection(connection.name)

        connection_name = connection.name
        await self.db.delete(connection)
        await self.db.commit()

        logger.info(f"IPsec connection deleted: {connection_name} by {deleted_by.username}")
        return True, None

    # ==================== Config Generation ====================

    async def generate_ipsec_conf(self) -> str:
        """Generate complete ipsec.conf file content"""
        connections, _ = await self.list_connections(is_enabled=True)

        lines = [
            "# ipsec.conf - StrongSwan IPsec configuration file",
            "# Auto-generated by EdgeGate",
            f"# Generated at: {datetime.utcnow().isoformat()}",
            "",
            "# Basic configuration",
            "config setup",
            "    # strictcrlpolicy=yes",
            "    # uniqueids = no",
            "",
        ]

        # Add connection blocks
        for conn in connections:
            lines.append(f"# Connection: {conn.name}")
            if conn.description:
                lines.append(f"# {conn.description}")
            lines.append(conn.to_ipsec_conf())
            lines.append("#" * 80)
            lines.append("")

        return "\n".join(lines)

    async def generate_ipsec_secrets(self) -> str:
        """Generate complete ipsec.secrets file content"""
        connections, _ = await self.list_connections(is_enabled=True)

        lines = [
            "# ipsec.secrets - StrongSwan IPsec secrets file",
            "# Auto-generated by EdgeGate",
            f"# Generated at: {datetime.utcnow().isoformat()}",
            "",
            "# This file holds shared secrets or RSA private keys for authentication.",
            "# Format: IP_LOCAL IP_REMOTE : PSK \"key\"",
            "",
        ]

        for conn in connections:
            secret_line = conn.to_ipsec_secret()
            if secret_line:
                lines.append(f"# {conn.name}")
                lines.append(secret_line)
                lines.append("")

        return "\n".join(lines)

    async def apply_config(self) -> Tuple[bool, Optional[str]]:
        """Write config files and reload StrongSwan via ipsec-agent"""
        try:
            # Generate configs
            ipsec_conf = await self.generate_ipsec_conf()
            ipsec_secrets = await self.generate_ipsec_secrets()

            # Write configs via agent
            success, error = await self._agent_write_config(ipsec_conf, ipsec_secrets)
            if not success:
                return False, f"Failed to write config: {error}"

            # Reload StrongSwan
            success, output = await self._run_ipsec_command_async(["reload"])
            if not success:
                return False, f"Failed to reload ipsec: {output}"

            logger.info("IPsec configuration applied successfully")
            return True, None

        except Exception as e:
            logger.error(f"Failed to apply IPsec config: {e}")
            return False, str(e)

    async def _agent_write_config(self, ipsec_conf: str, ipsec_secrets: str) -> Tuple[bool, Optional[str]]:
        """Write config files via ipsec-agent API"""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.agent_url}/config/write",
                    headers={"Authorization": f"Bearer {self.agent_token}"},
                    json={
                        "ipsec_conf": ipsec_conf,
                        "ipsec_secrets": ipsec_secrets
                    }
                )

                if response.status_code == 401:
                    return False, "Unauthorized - check IPSEC_AGENT_TOKEN"

                if response.status_code != 200:
                    return False, f"Agent returned status {response.status_code}"

                data = response.json()
                errors = []
                if data.get("ipsec_conf", {}).get("success") is False:
                    errors.append(f"ipsec.conf: {data['ipsec_conf'].get('error', 'unknown error')}")
                if data.get("ipsec_secrets", {}).get("success") is False:
                    errors.append(f"ipsec.secrets: {data['ipsec_secrets'].get('error', 'unknown error')}")

                if errors:
                    return False, "; ".join(errors)

                return True, None

        except httpx.ConnectError:
            return False, "Cannot connect to ipsec-agent - is it running on the host?"
        except httpx.TimeoutException:
            return False, "Timeout connecting to ipsec-agent"
        except Exception as e:
            return False, str(e)

    def _write_file(self, path: str, content: str) -> Tuple[bool, Optional[str]]:
        """Write content to file (local fallback)"""
        try:
            with open(path, 'w') as f:
                f.write(content)
            return True, None
        except Exception as e:
            return False, str(e)

    # ==================== StrongSwan Control ====================

    async def _run_ipsec_command_async(self, args: List[str]) -> Tuple[bool, str]:
        """Run ipsec command via ipsec-agent API and return (success, output)"""
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                # Map command args to agent endpoints
                if len(args) >= 1:
                    cmd = args[0]

                    if cmd == "version":
                        response = await client.get(
                            f"{self.agent_url}/version",
                            headers={"Authorization": f"Bearer {self.agent_token}"}
                        )
                    elif cmd == "statusall":
                        response = await client.get(
                            f"{self.agent_url}/status",
                            headers={"Authorization": f"Bearer {self.agent_token}"}
                        )
                    elif cmd == "status" and len(args) >= 2:
                        response = await client.get(
                            f"{self.agent_url}/status/{args[1]}",
                            headers={"Authorization": f"Bearer {self.agent_token}"}
                        )
                    elif cmd == "up" and len(args) >= 2:
                        response = await client.post(
                            f"{self.agent_url}/up/{args[1]}",
                            headers={"Authorization": f"Bearer {self.agent_token}"}
                        )
                    elif cmd == "down" and len(args) >= 2:
                        response = await client.post(
                            f"{self.agent_url}/down/{args[1]}",
                            headers={"Authorization": f"Bearer {self.agent_token}"}
                        )
                    elif cmd == "reload":
                        response = await client.post(
                            f"{self.agent_url}/reload",
                            headers={"Authorization": f"Bearer {self.agent_token}"}
                        )
                    elif cmd == "restart":
                        response = await client.post(
                            f"{self.agent_url}/restart",
                            headers={"Authorization": f"Bearer {self.agent_token}"}
                        )
                    else:
                        return False, f"Unknown ipsec command: {' '.join(args)}"

                    if response.status_code == 401:
                        return False, "Unauthorized - check IPSEC_AGENT_TOKEN"

                    data = response.json()
                    success = data.get("success", False)
                    output = data.get("output", data.get("stdout", ""))

                    if not success:
                        # Detect daemon not running (empty output with failure)
                        if not output and data.get("returncode") in (7, -1, 1):
                            output = "StrongSwan daemon (charon) is not running. Try restarting StrongSwan first."
                        logger.warning(f"ipsec command failed via agent: {' '.join(args)} - {output}")

                    return success, output

                return False, "No command specified"

        except httpx.ConnectError:
            return False, "Cannot connect to ipsec-agent - is it running on the host? Install with: cd docker/ipsec-agent && sudo ./install.sh"
        except httpx.TimeoutException:
            return False, "Timeout connecting to ipsec-agent"
        except Exception as e:
            logger.error(f"Error calling ipsec-agent: {e}")
            return False, str(e)

    def _run_ipsec_command(self, args: List[str]) -> Tuple[bool, str]:
        """Run ipsec command synchronously (fallback for sync contexts)"""
        try:
            cmd = ["ipsec"] + args
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30
            )

            output = result.stdout + result.stderr
            success = result.returncode == 0

            if not success:
                logger.warning(f"ipsec command failed: {' '.join(args)} - {output}")

            return success, output.strip()

        except subprocess.TimeoutExpired:
            return False, "Command timed out"
        except FileNotFoundError:
            return False, "ipsec command not found - StrongSwan may not be installed"
        except Exception as e:
            return False, str(e)

    async def start_connection(self, name: str) -> Tuple[bool, str]:
        """Start/initiate an IPsec connection"""
        connection = await self.get_connection_by_name(name)
        if not connection:
            return False, f"Connection '{name}' not found"

        if not connection.is_enabled:
            return False, f"Connection '{name}' is disabled"

        success, output = await self._run_ipsec_command_async(["up", name])

        if success:
            connection.status = IPsecStatus.ACTIVE
            connection.last_error = None
        else:
            connection.status = IPsecStatus.ERROR
            connection.last_error = output

        connection.last_status_check = datetime.utcnow()
        await self.db.commit()

        return success, output

    async def stop_connection(self, name: str) -> Tuple[bool, str]:
        """Stop/terminate an IPsec connection"""
        connection = await self.get_connection_by_name(name)
        if not connection:
            return False, f"Connection '{name}' not found"

        success, output = await self._run_ipsec_command_async(["down", name])

        connection.status = IPsecStatus.INACTIVE
        connection.last_status_check = datetime.utcnow()
        if not success:
            connection.last_error = output
        await self.db.commit()

        return success, output

    async def restart_connection(self, name: str) -> Tuple[bool, str]:
        """Restart an IPsec connection"""
        # Stop first
        await self.stop_connection(name)

        # Then start
        return await self.start_connection(name)

    async def reload_all(self) -> Tuple[bool, str]:
        """Reload StrongSwan configuration"""
        return await self._run_ipsec_command_async(["reload"])

    async def restart_strongswan(self) -> Tuple[bool, str]:
        """Restart StrongSwan service"""
        return await self._run_ipsec_command_async(["restart"])

    # ==================== Status Monitoring ====================

    async def get_status(self, name: Optional[str] = None) -> Dict[str, Any]:
        """Get IPsec connection status from StrongSwan"""
        if name:
            success, output = await self._run_ipsec_command_async(["status", name])
        else:
            success, output = await self._run_ipsec_command_async(["statusall"])

        if not success:
            return {
                "strongswan_running": False,
                "total_connections": 0,
                "active_tunnels": 0,
                "error": output,
                "connections": []
            }

        # Parse output
        return self._parse_status_output(output)

    def _parse_status_output(self, output: str) -> Dict[str, Any]:
        """Parse ipsec statusall output"""
        result = {
            "strongswan_running": True,
            "total_connections": 0,
            "active_tunnels": 0,
            "connections": []
        }

        if not output:
            return result

        # Parse connection status
        # Example output:
        # teste[3]: ESTABLISHED 11 minutes ago, 10.10.22.91[3.95.183.228]...170.231.45.197[170.231.45.197]
        # teste[3]: IKEv2 SPIs: d82b4443749d49d0_i 40d790f91f308592_r*, ...
        # teste{1}:  INSTALLED, TUNNEL, reqid 1, ESP in UDP SPIs: c72b3457_i cc58d7e5_o
        # teste{1}:  AES_CBC_256/HMAC_SHA2_256_128, 0 bytes_i, 0 bytes_o, rekeying in 43 minutes
        # teste{1}:   10.10.0.0/16 === 10.7.0.0/16

        # Pattern for IKE SA (Phase 1): connection[N]: ESTABLISHED/CONNECTING
        ike_pattern = re.compile(r'^\s*([\w-]+)\[(\d+)\]:\s+(ESTABLISHED|CONNECTING)', re.MULTILINE)
        # Pattern for Child SA (Phase 2 / ESP tunnel): connection{N}: INSTALLED
        child_pattern = re.compile(r'^\s*([\w-]+)\{(\d+)\}:\s+(INSTALLED|REKEYING)', re.MULTILINE)

        # Track IKE SAs
        ike_sas = {}
        for match in ike_pattern.finditer(output):
            conn_name = match.group(1)
            ike_id = match.group(2)
            status = match.group(3)
            ike_sas[conn_name] = {"status": status, "ike_id": ike_id}

        # Track Child SAs (ESP tunnels)
        child_sas = {}
        for match in child_pattern.finditer(output):
            conn_name = match.group(1)
            child_id = match.group(2)
            status = match.group(3)
            if conn_name not in child_sas:
                child_sas[conn_name] = []
            child_sas[conn_name].append({"status": status, "child_id": child_id})

        # Build connection info - only include connections with IKE SA
        for conn_name, ike_info in ike_sas.items():
            ike_status = ike_info["status"]
            has_child_sa = conn_name in child_sas and len(child_sas[conn_name]) > 0
            child_installed = has_child_sa and any(c["status"] == "INSTALLED" for c in child_sas[conn_name])

            # Determine overall tunnel status
            # IKE ESTABLISHED + Child INSTALLED = tunnel fully up
            # IKE ESTABLISHED + no Child SA = IKE only (Phase 2 failed)
            # IKE CONNECTING = still negotiating
            if ike_status == "ESTABLISHED" and child_installed:
                tunnel_status = "UP"
            elif ike_status == "ESTABLISHED" and not child_installed:
                tunnel_status = "IKE_ONLY"  # Phase 1 ok, Phase 2 failed
            elif ike_status == "CONNECTING":
                tunnel_status = "CONNECTING"
            else:
                tunnel_status = "DOWN"

            conn_info = {
                "name": conn_name,
                "ike_status": ike_status,
                "tunnel_status": tunnel_status,
                "has_child_sa": has_child_sa,
                "status": "ESTABLISHED" if tunnel_status == "UP" else ike_status,
                "uptime": None,
                "local_ts": None,
                "remote_ts": None,
                "bytes_in": None,
                "bytes_out": None,
                "rekey_time": None,
                "error_hint": None
            }

            # Add error hint for IKE_ONLY status
            if tunnel_status == "IKE_ONLY":
                conn_info["error_hint"] = "IKE established but tunnel not up. Check ESP cipher compatibility."

            # Escape connection name for use in regex patterns
            cn = re.escape(conn_name)

            # Try to extract uptime
            uptime_match = re.search(rf'{cn}\[\d+\]:\s+ESTABLISHED\s+(.+?),', output)
            if uptime_match:
                conn_info["uptime"] = uptime_match.group(1)

            # Try to extract traffic selectors from Child SA
            ts_match = re.search(rf'{cn}\{{\d+\}}:\s+.+\n\s*{cn}\{{\d+\}}:\s+.+\n\s+(\S+)\s+===\s+(\S+)', output)
            if not ts_match:
                ts_match = re.search(rf'{cn}\{{\d+\}}:.*\n.*\n\s+(\S+)\s+===\s+(\S+)', output)
            if ts_match:
                conn_info["local_ts"] = ts_match.group(1)
                conn_info["remote_ts"] = ts_match.group(2)

            # Try to extract bytes from Child SA line
            bytes_match = re.search(rf'{cn}\{{\d+\}}:.*?(\d+)\s+bytes_i.*?(\d+)\s+bytes_o', output)
            if bytes_match:
                conn_info["bytes_in"] = int(bytes_match.group(1))
                conn_info["bytes_out"] = int(bytes_match.group(2))

            # Try to extract rekey time
            rekey_match = re.search(rf'{cn}\{{\d+\}}:.*rekeying in\s+(\d+\s+\w+)', output)
            if rekey_match:
                conn_info["rekey_time"] = rekey_match.group(1)

            result["connections"].append(conn_info)
            result["total_connections"] += 1

            # Only count as active if tunnel is fully UP
            if tunnel_status == "UP":
                result["active_tunnels"] += 1

        return result

    async def update_connection_statuses(self) -> None:
        """Update all connection statuses from StrongSwan"""
        status = await self.get_status()

        connections, _ = await self.list_connections()
        conn_statuses = {c["name"]: c for c in status.get("connections", [])}

        for conn in connections:
            if conn.name in conn_statuses:
                conn_status = conn_statuses[conn.name]
                tunnel_status = conn_status.get("tunnel_status", "DOWN")

                if tunnel_status == "UP":
                    conn.status = IPsecStatus.ACTIVE
                    conn.last_error = None
                elif tunnel_status == "IKE_ONLY":
                    conn.status = IPsecStatus.ERROR
                    conn.last_error = conn_status.get("error_hint", "IKE established but Child SA failed")
                elif tunnel_status == "CONNECTING":
                    conn.status = IPsecStatus.CONNECTING
                else:
                    conn.status = IPsecStatus.INACTIVE
            else:
                if conn.is_enabled:
                    conn.status = IPsecStatus.INACTIVE
            conn.last_status_check = datetime.utcnow()

        await self.db.commit()

    # ==================== Utility Methods ====================

    async def get_preview(self) -> Dict[str, str]:
        """Get preview of generated configs without applying"""
        return {
            "ipsec_conf": await self.generate_ipsec_conf(),
            "ipsec_secrets": await self.generate_ipsec_secrets()
        }

    async def check_strongswan_installed(self) -> bool:
        """Check if StrongSwan is installed and ipsec-agent is running"""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.agent_url}/health")
                if response.status_code == 200:
                    data = response.json()
                    return data.get("ipsec_installed", False)
                return False
        except Exception:
            return False

    async def get_strongswan_version(self) -> Optional[str]:
        """Get StrongSwan version"""
        success, output = await self._run_ipsec_command_async(["version"])
        if success:
            return output.split('\n')[0] if output else None
        return None

    async def get_detailed_status(self) -> Dict[str, Any]:
        """Get detailed IPsec status (raw ipsec statusall output)"""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{self.agent_url}/statusall",
                    headers={"Authorization": f"Bearer {self.agent_token}"}
                )

                if response.status_code == 401:
                    return {"success": False, "output": "Unauthorized - check IPSEC_AGENT_TOKEN"}

                if response.status_code != 200:
                    return {"success": False, "output": f"Agent returned status {response.status_code}"}

                return response.json()

        except httpx.ConnectError:
            return {"success": False, "output": "Cannot connect to ipsec-agent"}
        except httpx.TimeoutException:
            return {"success": False, "output": "Timeout connecting to ipsec-agent"}
        except Exception as e:
            return {"success": False, "output": str(e)}

    async def get_logs(self, lines: int = 100, connection: Optional[str] = None) -> Dict[str, Any]:
        """Get recent IPsec/StrongSwan logs, optionally filtered by connection name"""
        try:
            params = {"lines": str(lines)}
            if connection:
                params["connection"] = connection

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{self.agent_url}/logs",
                    headers={"Authorization": f"Bearer {self.agent_token}"},
                    params=params
                )

                if response.status_code == 401:
                    return {"success": False, "logs": "Unauthorized - check IPSEC_AGENT_TOKEN", "source": None}

                if response.status_code != 200:
                    return {"success": False, "logs": f"Agent returned status {response.status_code}", "source": None}

                return response.json()

        except httpx.ConnectError:
            return {"success": False, "logs": "Cannot connect to ipsec-agent", "source": None}
        except httpx.TimeoutException:
            return {"success": False, "logs": "Timeout connecting to ipsec-agent", "source": None}
        except Exception as e:
            return {"success": False, "logs": str(e), "source": None}

    def get_server_network_info(self) -> Dict[str, Any]:
        """Get server network information for IPsec configuration.

        For AWS EC2, uses the instance metadata service to get accurate host IPs.
        Falls back to container network info if metadata is unavailable.
        """
        import ipaddress
        import os

        info = {
            "private_ip": None,
            "public_ip": None,
            "local_subnet": None,
            "interface": None
        }

        # Check for environment variable overrides first (useful for custom setups)
        if os.environ.get("VPN_SERVER_PRIVATE_IP"):
            info["private_ip"] = os.environ.get("VPN_SERVER_PRIVATE_IP")
        if os.environ.get("VPN_SERVER_PUBLIC_IP"):
            info["public_ip"] = os.environ.get("VPN_SERVER_PUBLIC_IP")
        if os.environ.get("VPN_SERVER_SUBNET"):
            info["local_subnet"] = os.environ.get("VPN_SERVER_SUBNET")

        try:
            # For AWS EC2: Use IMDSv2 (Instance Metadata Service v2)
            # First get a token
            token = None
            try:
                result = subprocess.run(
                    ["curl", "-s", "-X", "PUT",
                     "-H", "X-aws-ec2-metadata-token-ttl-seconds: 60",
                     "--connect-timeout", "2",
                     "http://169.254.169.254/latest/api/token"],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if result.returncode == 0 and result.stdout:
                    token = result.stdout.strip()
            except Exception:
                pass

            # Build curl headers for metadata requests
            metadata_headers = []
            if token:
                metadata_headers = ["-H", f"X-aws-ec2-metadata-token: {token}"]

            # Get private IP from EC2 metadata
            if not info["private_ip"]:
                try:
                    cmd = ["curl", "-s", "--connect-timeout", "2"] + metadata_headers + \
                          ["http://169.254.169.254/latest/meta-data/local-ipv4"]
                    result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
                    if result.returncode == 0 and result.stdout:
                        ip = result.stdout.strip()
                        if re.match(r'^\d+\.\d+\.\d+\.\d+$', ip):
                            info["private_ip"] = ip
                except Exception:
                    pass

            # Get public IP from EC2 metadata
            if not info["public_ip"]:
                try:
                    cmd = ["curl", "-s", "--connect-timeout", "2"] + metadata_headers + \
                          ["http://169.254.169.254/latest/meta-data/public-ipv4"]
                    result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
                    if result.returncode == 0 and result.stdout and not result.stdout.startswith('<?'):
                        ip = result.stdout.strip()
                        if re.match(r'^\d+\.\d+\.\d+\.\d+$', ip):
                            info["public_ip"] = ip
                except Exception:
                    pass

            # Get VPC CIDR / subnet from EC2 metadata (MAC address -> subnet)
            if not info["local_subnet"] and info["private_ip"]:
                try:
                    # First get MAC address
                    cmd = ["curl", "-s", "--connect-timeout", "2"] + metadata_headers + \
                          ["http://169.254.169.254/latest/meta-data/mac"]
                    result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
                    if result.returncode == 0 and result.stdout:
                        mac = result.stdout.strip()
                        # Get subnet CIDR using MAC
                        cmd = ["curl", "-s", "--connect-timeout", "2"] + metadata_headers + \
                              [f"http://169.254.169.254/latest/meta-data/network/interfaces/macs/{mac}/subnet-ipv4-cidr-block"]
                        result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
                        if result.returncode == 0 and result.stdout:
                            subnet = result.stdout.strip()
                            if '/' in subnet:
                                info["local_subnet"] = subnet
                except Exception:
                    pass

            # Fallback: Calculate subnet from private IP if we have IP but no subnet
            if info["private_ip"] and not info["local_subnet"]:
                try:
                    # Assume /24 as a reasonable default for most VPC subnets
                    ip_obj = ipaddress.ip_address(info["private_ip"])
                    network = ipaddress.ip_network(f"{info['private_ip']}/24", strict=False)
                    info["local_subnet"] = str(network)
                except Exception:
                    pass

            # Fallback for public IP: use external service
            if not info["public_ip"]:
                try:
                    result = subprocess.run(
                        ["curl", "-s", "--connect-timeout", "5", "https://api.ipify.org"],
                        capture_output=True,
                        text=True,
                        timeout=10
                    )
                    if result.returncode == 0 and result.stdout:
                        ip = result.stdout.strip()
                        if re.match(r'^\d+\.\d+\.\d+\.\d+$', ip):
                            info["public_ip"] = ip
                except Exception:
                    pass

            # Set interface name (informational)
            info["interface"] = "eth0"

        except Exception as e:
            logger.error(f"Failed to get server network info: {e}")

        return info
