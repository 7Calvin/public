"""
Traefik Reverse Proxy Service
Manages proxy routes, generates Traefik dynamic configuration,
and provides SSL certificate management via ACME storage.
"""
import os
import json
import time
import base64
import logging
from typing import Optional, Tuple, List
from uuid import UUID
from datetime import datetime, timezone

from pathlib import Path

import httpx
import yaml
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.proxy_route import (
    ProxyRoute, ProxyRouteStatus, SSLMode, HealthCheckType
)
from app.models.user import User
from app.schemas.proxy_route import ProxyRouteCreate, ProxyRouteUpdate
from app.core.config import settings

logger = logging.getLogger(__name__)


class TraefikService:
    """Service for managing Traefik reverse proxy routes"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.dynamic_dir = getattr(settings, 'TRAEFIK_DYNAMIC_DIR', '/etc/traefik/dynamic')
        self.traefik_api_url = getattr(settings, 'TRAEFIK_API_URL', 'http://traefik:8080')
        self.acme_storage = getattr(settings, 'TRAEFIK_ACME_STORAGE', '/acme/acme.json')

    # ==================== CRUD ====================

    async def get_route_by_id(self, route_id: UUID) -> Optional[ProxyRoute]:
        result = await self.db.execute(
            select(ProxyRoute).where(ProxyRoute.id == route_id)
        )
        return result.scalar_one_or_none()

    async def get_route_by_name(self, name: str) -> Optional[ProxyRoute]:
        result = await self.db.execute(
            select(ProxyRoute).where(ProxyRoute.name == name)
        )
        return result.scalar_one_or_none()

    async def get_route_by_hostname(self, hostname: str) -> Optional[ProxyRoute]:
        result = await self.db.execute(
            select(ProxyRoute).where(ProxyRoute.hostname == hostname)
        )
        return result.scalar_one_or_none()

    async def list_routes(
        self,
        is_enabled: Optional[bool] = None,
        skip: int = 0,
        limit: int = 50
    ) -> Tuple[List[ProxyRoute], int]:
        query = select(ProxyRoute)
        count_query = select(func.count()).select_from(ProxyRoute)

        if is_enabled is not None:
            query = query.where(ProxyRoute.is_enabled == is_enabled)
            count_query = count_query.where(ProxyRoute.is_enabled == is_enabled)

        query = query.order_by(ProxyRoute.created_at.desc()).offset(skip).limit(limit)

        result = await self.db.execute(query)
        routes = result.scalars().all()

        count_result = await self.db.execute(count_query)
        total = count_result.scalar()

        return routes, total

    async def create_route(
        self, data: ProxyRouteCreate, admin: User
    ) -> Tuple[Optional[ProxyRoute], Optional[str]]:
        # Check unique name
        existing = await self.get_route_by_name(data.name)
        if existing:
            return None, f"Route with name '{data.name}' already exists"

        # Check unique hostname
        existing = await self.get_route_by_hostname(data.hostname)
        if existing:
            return None, f"Route with hostname '{data.hostname}' already exists"

        route = ProxyRoute(
            name=data.name,
            hostname=data.hostname,
            backend_url=data.backend_url,
            path_prefix=data.path_prefix,
            strip_prefix=data.strip_prefix,
            ssl_mode=data.ssl_mode,
            force_https=data.force_https,
            health_check_type=data.health_check_type,
            health_check_path=data.health_check_path,
            health_check_interval=data.health_check_interval,
            pass_host_header=data.pass_host_header,
            custom_request_headers=data.custom_request_headers,
            custom_response_headers=data.custom_response_headers,
            rate_limit_average=data.rate_limit_average,
            rate_limit_burst=data.rate_limit_burst,
            is_enabled=data.is_enabled,
            status=ProxyRouteStatus.PENDING,
            created_by_id=admin.id,
        )

        self.db.add(route)
        await self.db.commit()
        await self.db.refresh(route)

        return route, None

    async def update_route(
        self, route: ProxyRoute, data: ProxyRouteUpdate, admin: User
    ) -> Tuple[Optional[ProxyRoute], Optional[str]]:
        update_data = data.model_dump(exclude_unset=True)

        # Check unique name if changing
        if "name" in update_data and update_data["name"] != route.name:
            existing = await self.get_route_by_name(update_data["name"])
            if existing:
                return None, f"Route with name '{update_data['name']}' already exists"

        # Check unique hostname if changing
        if "hostname" in update_data and update_data["hostname"] != route.hostname:
            existing = await self.get_route_by_hostname(update_data["hostname"])
            if existing:
                return None, f"Route with hostname '{update_data['hostname']}' already exists"

        for field, value in update_data.items():
            setattr(route, field, value)

        await self.db.commit()
        await self.db.refresh(route)

        return route, None

    async def delete_route(
        self, route: ProxyRoute, admin: User
    ) -> Tuple[bool, Optional[str]]:
        await self.db.delete(route)
        await self.db.commit()
        return True, None

    # ==================== Config Generation ====================

    async def generate_dynamic_config(self) -> dict:
        """Generate Traefik dynamic config YAML from enabled routes in DB"""
        result = await self.db.execute(
            select(ProxyRoute).where(ProxyRoute.is_enabled == True)
        )
        routes = result.scalars().all()

        config = {"http": {"routers": {}, "services": {}, "middlewares": {}}}
        tls_certificates = []

        for route in routes:
            safe_name = route.name.replace(" ", "-").replace(".", "-").lower()

            # Build Host rule
            rule = f"Host(`{route.hostname}`)"
            if route.path_prefix:
                rule += f" && PathPrefix(`{route.path_prefix}`)"

            # Router (HTTPS)
            router = {
                "rule": rule,
                "service": safe_name,
                "entryPoints": ["websecure"],
            }

            # TLS config
            if route.ssl_mode == SSLMode.LETSENCRYPT:
                router["tls"] = {"certResolver": "letsencrypt"}
            elif route.ssl_mode == SSLMode.LETSENCRYPT_DNS:
                # Use manually issued cert if available, otherwise fallback to HTTP-01 resolver
                manual_cert = Path(settings.ACME_CERTS_DIR) / route.hostname / "fullchain.pem"
                manual_key = Path(settings.ACME_CERTS_DIR) / route.hostname / "privkey.pem"
                if manual_cert.exists() and manual_key.exists():
                    router["tls"] = {}
                    # Traefik sees manual certs at /certs-manual (separate mount)
                    traefik_cert_base = "/certs-manual"
                    tls_certificates.append({
                        "certFile": f"{traefik_cert_base}/{route.hostname}/fullchain.pem",
                        "keyFile": f"{traefik_cert_base}/{route.hostname}/privkey.pem",
                    })
                else:
                    # Cert not yet issued - use HTTP-01 as fallback so route still works with TLS
                    router["tls"] = {"certResolver": "letsencrypt"}
            elif route.ssl_mode == SSLMode.CUSTOM:
                router["tls"] = {}
            # SSLMode.NONE - no TLS on this router

            # Middlewares for this route
            middlewares = []

            # Strip prefix middleware
            if route.path_prefix and route.strip_prefix:
                mw_name = f"{safe_name}-strip"
                config["http"]["middlewares"][mw_name] = {
                    "stripPrefix": {"prefixes": [route.path_prefix]}
                }
                middlewares.append(mw_name)

            # Rate limit middleware
            if route.rate_limit_average:
                mw_name = f"{safe_name}-ratelimit"
                config["http"]["middlewares"][mw_name] = {
                    "rateLimit": {
                        "average": route.rate_limit_average,
                        "burst": route.rate_limit_burst or route.rate_limit_average * 2,
                    }
                }
                middlewares.append(mw_name)

            # Custom headers middleware
            custom_headers = {}
            if route.custom_request_headers:
                try:
                    custom_headers["customRequestHeaders"] = json.loads(route.custom_request_headers)
                except json.JSONDecodeError:
                    pass
            if route.custom_response_headers:
                try:
                    custom_headers["customResponseHeaders"] = json.loads(route.custom_response_headers)
                except json.JSONDecodeError:
                    pass
            if custom_headers:
                mw_name = f"{safe_name}-headers"
                config["http"]["middlewares"][mw_name] = {"headers": custom_headers}
                middlewares.append(mw_name)

            if middlewares:
                router["middlewares"] = middlewares

            config["http"]["routers"][safe_name] = router

            # HTTP router (redirect to HTTPS)
            if route.force_https and route.ssl_mode != SSLMode.NONE:
                redirect_mw = f"{safe_name}-redirect"
                config["http"]["middlewares"][redirect_mw] = {
                    "redirectScheme": {"scheme": "https", "permanent": True}
                }
                config["http"]["routers"][f"{safe_name}-http"] = {
                    "rule": rule,
                    "service": safe_name,
                    "entryPoints": ["web"],
                    "middlewares": [redirect_mw],
                }

            # Service (backend)
            service_config = {
                "loadBalancer": {
                    "servers": [{"url": route.backend_url}],
                    "passHostHeader": route.pass_host_header,
                }
            }

            # Health check
            if route.health_check_type == HealthCheckType.HTTP:
                service_config["loadBalancer"]["healthCheck"] = {
                    "path": route.health_check_path or "/",
                    "interval": route.health_check_interval or "30s",
                }
            elif route.health_check_type == HealthCheckType.TCP:
                service_config["loadBalancer"]["healthCheck"] = {
                    "interval": route.health_check_interval or "30s",
                }

            config["http"]["services"][safe_name] = service_config

        # Add TLS certificates section for manually issued certs
        if tls_certificates:
            config["tls"] = {"certificates": tls_certificates}

        # Clean empty sections
        for section in ["routers", "services", "middlewares"]:
            if not config["http"][section]:
                del config["http"][section]
        if not config["http"]:
            del config["http"]

        return config

    async def generate_config_yaml(self) -> str:
        """Generate YAML string of the dynamic config"""
        config = await self.generate_dynamic_config()
        if not config:
            return "# No routes configured\n"
        return yaml.dump(config, default_flow_style=False, sort_keys=False)

    # ==================== Apply Config ====================

    async def apply_config(self) -> Tuple[bool, Optional[str]]:
        """Write dynamic config to shared volume; Traefik picks it up via file watcher"""
        try:
            yaml_content = await self.generate_config_yaml()
            routes_file = os.path.join(self.dynamic_dir, "routes.yml")

            os.makedirs(self.dynamic_dir, exist_ok=True)
            with open(routes_file, "w") as f:
                f.write(yaml_content)

            logger.info(f"Traefik dynamic config written to {routes_file}")

            # Update status of all enabled routes to active
            result = await self.db.execute(
                select(ProxyRoute).where(ProxyRoute.is_enabled == True)
            )
            routes = result.scalars().all()
            for route in routes:
                route.status = ProxyRouteStatus.ACTIVE
            await self.db.commit()

            return True, None

        except Exception as e:
            logger.error(f"Failed to apply Traefik config: {e}")
            return False, str(e)

    # ==================== Health Check ====================

    async def check_backend_health(self, route: ProxyRoute) -> dict:
        """Check health of a single backend"""
        result = {
            "route_id": str(route.id),
            "route_name": route.name,
            "hostname": route.hostname,
            "backend_url": route.backend_url,
            "is_healthy": False,
            "status_code": None,
            "response_time_ms": None,
            "error": None,
        }

        try:
            start = time.monotonic()
            async with httpx.AsyncClient(timeout=10.0, verify=False) as client:
                if route.health_check_type == HealthCheckType.HTTP:
                    check_url = route.backend_url.rstrip("/") + (route.health_check_path or "/")
                    response = await client.get(check_url)
                    elapsed = (time.monotonic() - start) * 1000
                    result["status_code"] = response.status_code
                    result["response_time_ms"] = round(elapsed, 2)
                    result["is_healthy"] = 200 <= response.status_code < 500
                elif route.health_check_type == HealthCheckType.TCP:
                    # Parse host:port from backend_url
                    from urllib.parse import urlparse
                    parsed = urlparse(route.backend_url)
                    host = parsed.hostname
                    port = parsed.port or (443 if parsed.scheme == "https" else 80)
                    import asyncio
                    reader, writer = await asyncio.wait_for(
                        asyncio.open_connection(host, port), timeout=5.0
                    )
                    elapsed = (time.monotonic() - start) * 1000
                    writer.close()
                    await writer.wait_closed()
                    result["response_time_ms"] = round(elapsed, 2)
                    result["is_healthy"] = True
                else:
                    result["is_healthy"] = True
                    result["error"] = "Health check disabled"

        except Exception as e:
            result["error"] = str(e)
            result["is_healthy"] = False

        # Update route health status in DB
        route.last_health_check = datetime.now(timezone.utc)
        route.last_health_status = result["is_healthy"]
        if not result["is_healthy"]:
            route.last_error = result.get("error")
            route.status = ProxyRouteStatus.ERROR
        else:
            route.last_error = None
            if route.is_enabled:
                route.status = ProxyRouteStatus.ACTIVE
        await self.db.commit()

        return result

    async def check_all_backends(self) -> List[dict]:
        """Check health of all enabled backends"""
        result = await self.db.execute(
            select(ProxyRoute).where(ProxyRoute.is_enabled == True)
        )
        routes = result.scalars().all()

        results = []
        for route in routes:
            health = await self.check_backend_health(route)
            results.append(health)

        return results

    # ==================== Traefik Status ====================

    async def get_traefik_status(self) -> dict:
        """Query Traefik API for overview status"""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.traefik_api_url}/api/overview")
                if response.status_code == 200:
                    data = response.json()
                    return {
                        "running": True,
                        "http": data.get("http", {}),
                        "tcp": data.get("tcp", {}),
                        "udp": data.get("udp", {}),
                    }
                return {"running": True, "error": f"Unexpected status: {response.status_code}"}
        except httpx.ConnectError:
            return {"running": False, "error": "Cannot connect to Traefik API"}
        except Exception as e:
            return {"running": False, "error": str(e)}

    # ==================== Certificate Management ====================

    def _read_acme_storage(self) -> Optional[dict]:
        """Read and parse the Traefik acme.json file"""
        try:
            if not os.path.exists(self.acme_storage):
                return None
            with open(self.acme_storage, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, PermissionError, OSError) as e:
            logger.error(f"Failed to read acme.json: {e}")
            return None

    def _parse_certificate(self, cert_b64: str) -> Optional[dict]:
        """Parse a base64-encoded PEM certificate and extract metadata"""
        try:
            cert_pem = base64.b64decode(cert_b64)
            cert = x509.load_pem_x509_certificate(cert_pem)

            now = datetime.now(timezone.utc)
            not_after = cert.not_valid_after_utc
            days_remaining = (not_after - now).days

            if days_remaining < 0:
                status = "expired"
            elif days_remaining < 14:
                status = "expiring"
            else:
                status = "valid"

            # Extract issuer common name
            issuer_cn = None
            try:
                for attr in cert.issuer:
                    if attr.oid == x509.oid.NameOID.COMMON_NAME:
                        issuer_cn = attr.value
                        break
                if not issuer_cn:
                    for attr in cert.issuer:
                        if attr.oid == x509.oid.NameOID.ORGANIZATION_NAME:
                            issuer_cn = attr.value
                            break
            except Exception:
                pass

            # Fingerprint
            fingerprint = cert.fingerprint(hashes.SHA256()).hex()
            fingerprint_formatted = ":".join(
                fingerprint[i:i+2] for i in range(0, len(fingerprint), 2)
            )

            return {
                "issuer": issuer_cn,
                "not_before": cert.not_valid_before_utc.isoformat(),
                "not_after": not_after.isoformat(),
                "days_remaining": days_remaining,
                "status": status,
                "serial_number": format(cert.serial_number, "x"),
                "fingerprint": fingerprint_formatted,
            }
        except Exception as e:
            logger.error(f"Failed to parse certificate: {e}")
            return None

    def _parse_certificate_pem(self, pem_text: str) -> Optional[dict]:
        """Parse a PEM certificate string and extract metadata"""
        try:
            cert = x509.load_pem_x509_certificate(pem_text.encode("utf-8"))

            now = datetime.now(timezone.utc)
            not_after = cert.not_valid_after_utc
            days_remaining = (not_after - now).days

            if days_remaining < 0:
                status = "expired"
            elif days_remaining < 14:
                status = "expiring"
            else:
                status = "valid"

            issuer_cn = None
            try:
                for attr in cert.issuer:
                    if attr.oid == x509.oid.NameOID.COMMON_NAME:
                        issuer_cn = attr.value
                        break
                if not issuer_cn:
                    for attr in cert.issuer:
                        if attr.oid == x509.oid.NameOID.ORGANIZATION_NAME:
                            issuer_cn = attr.value
                            break
            except Exception:
                pass

            # Get subject CN for domain
            subject_cn = None
            try:
                for attr in cert.subject:
                    if attr.oid == x509.oid.NameOID.COMMON_NAME:
                        subject_cn = attr.value
                        break
            except Exception:
                pass

            # SANs
            sans = []
            try:
                ext = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
                sans = ext.value.get_values_for_type(x509.DNSName)
            except Exception:
                pass

            fingerprint = cert.fingerprint(hashes.SHA256()).hex()
            fingerprint_formatted = ":".join(
                fingerprint[i:i+2] for i in range(0, len(fingerprint), 2)
            )

            return {
                "domain": subject_cn,
                "sans": sans,
                "issuer": issuer_cn,
                "not_before": cert.not_valid_before_utc.isoformat(),
                "not_after": not_after.isoformat(),
                "days_remaining": days_remaining,
                "status": status,
                "serial_number": format(cert.serial_number, "x"),
                "fingerprint": fingerprint_formatted,
                "source": "dns-01",
            }
        except Exception as e:
            logger.error(f"Failed to parse PEM certificate: {e}")
            return None

    def _get_manual_certificates(self) -> list:
        """Read certificates issued via ACME DNS-01 from /certs/manual/"""
        certs = []
        certs_dir = Path(settings.ACME_CERTS_DIR)
        if not certs_dir.exists():
            return certs

        for domain_dir in certs_dir.iterdir():
            if not domain_dir.is_dir():
                continue
            fullchain = domain_dir / "fullchain.pem"
            if not fullchain.exists():
                continue
            try:
                pem_text = fullchain.read_text()
                parsed = self._parse_certificate_pem(pem_text)
                if parsed:
                    # Use directory name as domain if CN not available
                    if not parsed["domain"]:
                        parsed["domain"] = domain_dir.name
                    certs.append(parsed)
            except Exception as e:
                logger.error(f"Failed to read certificate for {domain_dir.name}: {e}")

        return certs

    async def get_certificates(self) -> dict:
        """List all certificates from Traefik ACME storage and manual DNS-01 certs"""
        acme_data = self._read_acme_storage()

        result = {
            "certificates": [],
            "acme_email": None,
            "total": 0,
            "valid": 0,
            "expiring": 0,
            "expired": 0,
        }

        # 1) Certificates from Traefik ACME storage (HTTP-01)
        if acme_data:
            # Traefik stores resolvers at top level (e.g. "letsencrypt")
            for resolver_name, resolver_data in acme_data.items():
                if not isinstance(resolver_data, dict):
                    continue

                # Get ACME account email
                account = resolver_data.get("Account", {})
                if account and account.get("Email"):
                    result["acme_email"] = account["Email"]

                # Parse certificates
                certs = resolver_data.get("Certificates", [])
                if not certs:
                    continue

                for cert_entry in certs:
                    domain_info = cert_entry.get("domain", {})
                    main_domain = domain_info.get("main", "unknown")
                    sans = domain_info.get("sans") or []

                    cert_b64 = cert_entry.get("certificate")
                    if not cert_b64:
                        continue

                    parsed = self._parse_certificate(cert_b64)

                    cert_info = {
                        "domain": main_domain,
                        "sans": sans,
                        "issuer": parsed.get("issuer") if parsed else None,
                        "not_before": parsed.get("not_before") if parsed else None,
                        "not_after": parsed.get("not_after") if parsed else None,
                        "days_remaining": parsed.get("days_remaining") if parsed else None,
                        "status": parsed.get("status", "error") if parsed else "error",
                        "serial_number": parsed.get("serial_number") if parsed else None,
                        "fingerprint": parsed.get("fingerprint") if parsed else None,
                        "source": "http-01",
                    }

                    result["certificates"].append(cert_info)

        # 2) Certificates from manual DNS-01 issuance
        manual_certs = self._get_manual_certificates()
        # Avoid duplicates - skip manual certs already present from ACME storage
        existing_domains = {c["domain"] for c in result["certificates"]}
        for cert_info in manual_certs:
            if cert_info["domain"] not in existing_domains:
                result["certificates"].append(cert_info)

        # Count statuses
        for cert_info in result["certificates"]:
            if cert_info["status"] == "valid":
                result["valid"] += 1
            elif cert_info["status"] == "expiring":
                result["expiring"] += 1
            elif cert_info["status"] == "expired":
                result["expired"] += 1

        result["total"] = len(result["certificates"])
        return result

    async def get_certificate_details(self, domain: str) -> Optional[dict]:
        """Get detailed info for a specific domain's certificate"""
        certs_data = await self.get_certificates()
        for cert in certs_data["certificates"]:
            if cert["domain"] == domain or domain in cert.get("sans", []):
                return cert
        return None

    async def force_renew_certificate(self, domain: str) -> Tuple[bool, str]:
        """
        Force certificate renewal by removing it from acme.json.
        Traefik will automatically request a new one.
        """
        try:
            acme_data = self._read_acme_storage()
            if not acme_data:
                return False, "Cannot read acme.json"

            found = False
            for resolver_name, resolver_data in acme_data.items():
                if not isinstance(resolver_data, dict):
                    continue

                certs = resolver_data.get("Certificates", [])
                original_count = len(certs)

                # Filter out the certificate for this domain
                resolver_data["Certificates"] = [
                    c for c in certs
                    if c.get("domain", {}).get("main") != domain
                ]

                if len(resolver_data["Certificates"]) < original_count:
                    found = True

            if not found:
                return False, f"Certificate for '{domain}' not found"

            # Write back the modified acme.json
            with open(self.acme_storage, "w") as f:
                json.dump(acme_data, f, indent=2)

            logger.info(f"Removed certificate for {domain} from acme.json to force renewal")
            return True, f"Certificate for '{domain}' removed. Traefik will auto-request a new one."

        except PermissionError:
            return False, "Permission denied writing to acme.json"
        except Exception as e:
            logger.error(f"Failed to force renew certificate: {e}")
            return False, str(e)
