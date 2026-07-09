#!/usr/bin/env python3
"""
EdgeGate API smoke test — exercises the main flows end-to-end and cleans up.

Run inside the backend container (mints an admin token via the app, so it works
even with MFA-required admins):

    docker exec -w /app vpn-backend python /app/scripts/smoke_test.py

Or against any base URL with a token:

    SMOKE_BASE=https://host/api/v1 SMOKE_TOKEN=<jwt> python scripts/smoke_test.py

Exit code 0 = all passed, 1 = something failed. Everything it creates is
prefixed "smoketest" and deleted at the end (even on failure).
"""
import os
import sys
import traceback

import httpx

BASE = os.environ.get("SMOKE_BASE", "http://localhost:8000/api/v1")
UNAME = f"smoketest_{os.getpid()}"  # unique per run (delete is a soft-delete)

passed = 0
failed = 0
cleanup = []  # list of (method, path) to run at the end


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  \033[32mPASS\033[0m  {name}")
    else:
        failed += 1
        print(f"  \033[31mFAIL\033[0m  {name}   {detail}")
    return cond


def mint_admin_token():
    import asyncio
    from sqlalchemy import select
    from app.core.security import create_access_token
    from app.db.session import AsyncSessionLocal
    from app.models.user import User

    async def _():
        async with AsyncSessionLocal() as db:
            admin = (await db.execute(select(User).where(User.is_admin == True).limit(1))).scalars().first()  # noqa: E712
            if not admin:
                raise SystemExit("no admin user found")
            return create_access_token({"sub": str(admin.id), "type": "access"})
    return asyncio.run(_())


def main():
    token = os.environ.get("SMOKE_TOKEN") or mint_admin_token()
    c = httpx.Client(base_url=BASE, headers={"Authorization": f"Bearer {token}"}, timeout=30.0)

    # ---------- READ ----------
    print("\n[READ] endpoints respondem 200")
    reads = [
        "/auth/me", "/users", "/users/stats/summary", "/ipsec/status", "/ipsec/connections",
        "/ipsec/server-info", "/proxy/routes", "/proxy/certificates", "/firewall/rules",
        "/firewall/status", "/firewall/quick-rules", "/connections", "/connections/stats/summary",
        "/vpn/server/config", "/system/version", "/system/info",
    ]
    for p in reads:
        try:
            r = c.get(p)
            check(f"GET {p}", r.status_code == 200, f"HTTP {r.status_code} {r.text[:100]}")
        except Exception as e:
            check(f"GET {p}", False, str(e))

    # ---------- USERS CRUD ----------
    print("\n[USERS] criar / ler / apagar")
    uid = None
    try:
        r = c.post("/users", json={
            "username": UNAME, "password": "SmokeTest12345!",
            "email": f"{UNAME}@example.com", "user_type": "human",
        })
        if check("criar usuário", r.status_code in (200, 201), f"HTTP {r.status_code} {r.text[:200]}"):
            uid = r.json().get("id")
            cleanup.append(("DELETE", f"/users/{uid}"))
            check("ler usuário", c.get(f"/users/{uid}").status_code == 200)
    except Exception as e:
        check("usuário CRUD", False, str(e))

    # ---------- IPSEC CRUD ----------
    print("\n[IPSEC] criar / apagar (sem iniciar)")
    try:
        r = c.post("/ipsec/connections", json={
            "name": "smoketest_ipsec", "description": "smoke",
            "left_ip": "10.48.1.212", "left_subnet": "10.48.0.0/16", "left_id": "1.2.3.4",
            "right_ip": "203.0.113.10", "right_subnet": "192.168.250.0/24", "right_id": "203.0.113.10",
            "auth_method": "psk", "psk": "smoketestpsk123456",
            "ike_version": "ikev2", "ike_cipher": "aes256-sha256-modp2048", "ike_lifetime": "8h",
            "esp_cipher": "aes256-sha256", "key_lifetime": "1h",
            "auto_start": False, "dpd_action": "restart", "is_enabled": False,
        })
        if check("criar IPsec", r.status_code in (200, 201), f"HTTP {r.status_code} {r.text[:220]}"):
            cid = r.json().get("id")
            cleanup.append(("DELETE", f"/ipsec/connections/{cid}"))
    except Exception as e:
        check("IPsec CRUD", False, str(e))

    # ---------- PROXY ROUTE CRUD ----------
    print("\n[PROXY] criar rota / apagar")
    try:
        r = c.post("/proxy/routes", json={
            "name": "smoketest_route", "hostname": "smoketest.example.com",
            "backend_url": "http://127.0.0.1:9999", "path_prefix": "",
            "ssl_mode": "none", "force_https": False, "is_enabled": False,
        })
        if check("criar rota proxy", r.status_code in (200, 201), f"HTTP {r.status_code} {r.text[:220]}"):
            rid = r.json().get("id")
            cleanup.append(("DELETE", f"/proxy/routes/{rid}"))
    except Exception as e:
        check("proxy CRUD", False, str(e))

    # ---------- FIREWALL RULE CRUD ----------
    print("\n[FIREWALL] criar regra / apagar")
    try:
        r = c.post("/firewall/rules", json={
            "name": "smoketest_rule", "description": "smoke", "action": "accept",
            "protocol": "all", "destination_network": "203.0.113.0/24", "priority": 100,
            "applies_to_human_users": True, "applies_to_service_accounts": True,
        })
        if check("criar regra firewall", r.status_code in (200, 201), f"HTTP {r.status_code} {r.text[:220]}"):
            fid = r.json().get("id")
            cleanup.append(("DELETE", f"/firewall/rules/{fid}"))
    except Exception as e:
        check("firewall CRUD", False, str(e))

    # ---------- VPN SERVER CONFIG round-trip ----------
    print("\n[CONFIG] round-trip da config do servidor VPN")
    try:
        cur = c.get("/vpn/server/config")
        if check("ler config VPN", cur.status_code == 200):
            body = cur.json()
            payload = {"dns_servers": body.get("dns_servers", ["8.8.8.8", "1.1.1.1"])}
            r = c.put("/vpn/server/config", json=payload)
            check("gravar config VPN (mesmo valor)", r.status_code == 200, f"HTTP {r.status_code} {r.text[:150]}")
    except Exception as e:
        check("config round-trip", False, str(e))

    # ---------- PASSWORD + MFA no usuário temporário ----------
    if uid:
        print("\n[SENHA + MFA] no usuário temporário")
        try:
            login = c.post("/auth/login", json={"username": UNAME, "password": "SmokeTest12345!"})
            if check("login do usuário temp", login.status_code == 200, f"HTTP {login.status_code} {login.text[:150]}"):
                utok = login.json().get("access_token")
                uc = httpx.Client(base_url=BASE, headers={"Authorization": f"Bearer {utok}"}, timeout=30.0)

                # password change
                pr = uc.post("/auth/password/change", json={
                    "current_password": "SmokeTest12345!",
                    "new_password": "SmokeTest67890!",
                    "confirm_password": "SmokeTest67890!",
                })
                check("trocar senha", pr.status_code == 200, f"HTTP {pr.status_code} {pr.text[:150]}")

                # MFA setup -> verify -> disable
                import pyotp
                ms = uc.post("/auth/mfa/setup")
                if check("MFA setup", ms.status_code == 200, f"HTTP {ms.status_code} {ms.text[:150]}"):
                    secret = ms.json().get("secret")
                    code = pyotp.TOTP(secret).now()
                    mv = uc.post("/auth/mfa/verify", json={"code": code})
                    check("MFA verify (ativar)", mv.status_code == 200, f"HTTP {mv.status_code} {mv.text[:150]}")
                    code2 = pyotp.TOTP(secret).now()
                    md = uc.post("/auth/mfa/disable", json={"password": "SmokeTest67890!", "mfa_code": code2})
                    check("MFA disable", md.status_code == 200, f"HTTP {md.status_code} {md.text[:150]}")
                uc.close()
        except Exception as e:
            check("senha/MFA", False, f"{e}")

    # ---------- CLEANUP ----------
    print("\n[CLEANUP]")
    for method, path in reversed(cleanup):
        try:
            r = c.request(method, path)
            check(f"{method} {path}", r.status_code in (200, 204), f"HTTP {r.status_code}")
        except Exception as e:
            check(f"{method} {path}", False, str(e))

    c.close()
    print(f"\n=== RESULTADO: {passed} PASS · {failed} FAIL ===")
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(2)
