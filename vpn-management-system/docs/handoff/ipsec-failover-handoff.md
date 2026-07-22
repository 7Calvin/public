# IPsec HA/Failover — Session Handoff

> Continuation doc so work can resume on another machine. **No secrets here**
> (this repo's remote is on GitHub) — SSH passwords / PSK live only in local
> Claude memory. Re-provide access creds in chat when resuming.

Last updated: 2026-07-22 (end of session).

## TL;DR — where we are

- **Released & functional:** `v1.5.2` — swanctl IPsec (running in prod "alphaquimica" and on the homolog box).
- **In progress (this branch, NOT released):** the **IPsec HA/failover feature** — a peer (FortiGate) with **2 fixed public IPs**; the tunnel fails over between them.
- **Where it's deployed:** manually on the **homolog box** (`/opt/vpn-management`, backend rebuilt by hand). This branch (`feature/ipsec-failover`) is the same code, now committed. It is **not** on `main` and **not** released.
- **Current tunnel state on homolog:** both primary and backup **ESTABLISHED + INSTALLED**.

## What this branch adds

Connection model gains a **second peer endpoint** + a **manual switch** flag, plus ops buttons and three bug fixes.

- **Schema/DB:** `right_ip_backup` (alembic `012`, revises 011) and `prefer_backup` (alembic `013`, revises 012, `server_default=false`). `right_id` relaxed to allow empty → defaults to `right_ip` (fixes a 422 on create).
- **swanctl generation (`backend/app/models/ipsec.py`):**
  - `_remote_addrs()` → `remote_addrs = primary, backup` (native multi-homing failover). Ordered **backup-first** when `prefer_backup` is set.
  - `to_swanctl()` `remote {}` block **does not pin `id`** (accept any peer id; security = `remote_addrs` source-IP pinning + the PSK).
  - `to_swanctl_secret()` emits the PSK keyed to **all** peer ids, and each bare IP in **both** forms: address (`1.2.3.4`) **and** string/FQDN (`@1.2.3.4`) — see Bug 3.
- **Service (`backend/app/services/ipsec_service.py`):** `set_prefer_backup()` (flag + apply, then block/unblock the primary via the agent so the switch actually forces over — a mere reorder loses the race because the peer initiates from primary), `test_failover()` (agent blocks the active endpoint, auto-restores after `FAILOVER_TEST_RESTORE_SECONDS=120`).
- **Routes (`backend/app/api/v1/routes/ipsec.py`):** `switch-backup`, `rollback-primary`, `test-failover`.
- **Agent (`docker/ipsec-agent/app.py`):** `/block-peer/<ip>`, `/unblock-peer/<ip>`, `/test-failover-block/<ip>`.
- **UI (`frontend/src/pages/IPsecPage.tsx` + `api/client.ts` + `types/index.ts`):** "IP de Backup (failover)" field, 3 buttons (test / switch / rollback), a BACKUP badge, and a ✓ marker on the active IP.

## Three bugs found & fixed (all deployed to homolog)

1. **PSK not keyed to the backup IP** — the secret only listed the primary, and `remote{}` pinned the primary id → auth from the backup IP failed silently (retransmit). Fixed: secret lists all peer ids; no id pin.
2. **PUT `/connections` returned 500 while the save+apply actually succeeded** — the route returned the ORM object; FastAPI serialized it after the apply/restart awaits had expired the attributes → `DetachedInstanceError`. Fixed: re-fetch fresh before returning. (This misleading 500 is why panel edits looked failed and silently wiped fields.)
3. **PSK id-TYPE mismatch (the big one)** — a FortiGate with a **text "Local ID" set to its WAN IP** sends that identity as **ID_FQDN (a string), not ID_IPV4_ADDR**, so an address-typed secret id doesn't match → `no shared key found` → auth fails (a *wrong* key would instead say "MAC mismatched"). Fixed: for every bare IP, emit both `IP` and `@IP` (the `@` forces FQDN type). Verified via a real API `/apply` — both tunnels re-established.

## FortiGate (peer) side — SD-WAN failover

Moved off equal-distance/equal-weight static routes (which caused **ECMP → asymmetric routing → one-way ping**) to **SD-WAN zone + rule + Performance SLA**.

- **RESOLVED:** SLA health-check wouldn't come UP because the probe was **sourced from an IP outside** the protected subnet (`192.168.1.2` tunnel-iface / WAN). Fixed on the FortiGate: set the health-check **source** to an IP inside the remote subnet.

## ⏭️ RESUME HERE — open item (FortiGate NAT)

Hosts **behind** the FortiGate still can't reach the `10.10.x` side, even though the SLA works. FortiGate diag showed the same packet twice: the original client source **immediately followed by the WAN IP** — i.e. the **LAN→SD-WAN firewall policy has NAT enabled**, SNAT-ing transit traffic to the WAN IP, which falls **outside the phase2 selector** → our side drops it → no reply.

**Fix (FortiGate):**
```
config firewall policy
    edit <LAN→SD-WAN policy>
        set nat disable
    next
end
```
Site-to-site must preserve the client's real source. If that policy also serves internet, split out a VPN-destination policy (`dst 10.10.0.0/16`, `nat disable`) above the generic one.

**Verify from our (strongSwan) side:**
```
tcpdump -ni any "icmp[icmptype]=icmp-echo and dst net 10.10.0.0/16"
```
After the fix the post-NAT WAN-IP line disappears and real `192.168.128.x → 10.10.x` requests arrive decrypted and get replies.

## Known caveats / TODO before releasing (~v1.6.0)

- **Panel edit form wipes `right_id` / `right_ip_backup`** when saving without touching them (the form re-submits them empty) — unfixed UI bug in `IPsecPage.tsx` (`openEditModal`/`updateData`). Not load-bearing after Bug 3's fix, but fix before release.
- **Per-member SLA on the backup won't stay UP** with the current single-connection design: both CHILD_SAs share `reqid`, so our outbound is pinned to the primary → replies to backup-sourced probes return via primary → asymmetric. Plain active/standby (fail over on primary-down/DPD) is fine as-is. Health-checking **both** members cleanly would need **two separate tunnels/connections with distinct selectors** on our side — decide before release.
- Then: merge to `main` + cut the release.

## How to resume on a new machine

1. `git fetch && git checkout feature/ipsec-failover` (this branch).
2. Re-provide SSH access to the homolog + web-panel creds in chat (kept out of git).
3. Do the FortiGate `set nat disable` and re-run the tcpdump verify above.
4. The homolog deploy is **manual** (outside git) — connecting to it doesn't depend on which PC you use.
