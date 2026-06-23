"""
NAT Agent - Applies NAT rules from database to host iptables
Runs with network_mode: host to have direct access to host networking
"""
import os
import subprocess
import logging
from flask import Flask, jsonify, request
import psycopg2
from psycopg2.extras import RealDictCursor

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Database connection
DB_HOST = os.environ.get('POSTGRES_HOST', 'localhost')
DB_PORT = os.environ.get('POSTGRES_PORT', '5432')
DB_NAME = os.environ.get('POSTGRES_DB', 'vpn_management')
DB_USER = os.environ.get('POSTGRES_USER', 'vpn_admin')
DB_PASS = os.environ.get('POSTGRES_PASSWORD', 'changeme')

# Auth token for API calls
API_TOKEN = os.environ.get('NAT_AGENT_TOKEN', 'changeme-nat-token')

# Gateway NAT: let a private subnet use this host as a NAT gateway.
# Enabled when NAT_GATEWAY_NETWORK is set (e.g. "10.48.0.0/16"). PUBLIC_INTERFACE
# is the uplink toward the internet (e.g. "ens5"). When set, the agent installs a
# masquerade + forward rules so hosts in NAT_GATEWAY_NETWORK reach the internet.
NAT_GATEWAY_NETWORK = os.environ.get('NAT_GATEWAY_NETWORK', '').strip()
PUBLIC_INTERFACE = os.environ.get('PUBLIC_INTERFACE', 'eth0').strip()

# Site-to-site (IPsec) destinations that must NOT be masqueraded, so the real
# source IP is preserved and the IPsec policy matches on the actual addresses.
# Comma-separated CIDRs (e.g. "172.16.12.0/24"). Required for the remote peer to
# initiate connections back into NAT_GATEWAY_NETWORK over the tunnel. Empty = off.
NAT_GATEWAY_EXCLUDE = os.environ.get('NAT_GATEWAY_EXCLUDE', '').strip()

# iptables comment used to tag (and later identify/remove) gateway-NAT rules.
GW_NAT_COMMENT = 'vpn-gw-nat'


def get_db_connection():
    """Get database connection"""
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASS,
        cursor_factory=RealDictCursor
    )


def run_iptables(args, check=True):
    """Run iptables command"""
    cmd = ['iptables'] + args
    logger.info(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if check and result.returncode != 0:
        logger.error(f"iptables error: {result.stderr}")
        return False, result.stderr
    return True, result.stdout


def clear_nat_rules():
    """Clear all VPN NAT rules"""
    # Delete PREROUTING rules with comment "vpn-nat"
    while True:
        result = subprocess.run(
            ['iptables', '-t', 'nat', '-L', 'PREROUTING', '--line-numbers', '-n'],
            capture_output=True, text=True
        )
        lines = result.stdout.strip().split('\n')
        deleted = False
        for line in reversed(lines):
            if 'vpn-nat' in line:
                num = line.split()[0]
                if num.isdigit():
                    run_iptables(['-t', 'nat', '-D', 'PREROUTING', num], check=False)
                    deleted = True
                    break
        if not deleted:
            break

    # Delete POSTROUTING rules with comment "vpn-nat"
    while True:
        result = subprocess.run(
            ['iptables', '-t', 'nat', '-L', 'POSTROUTING', '--line-numbers', '-n'],
            capture_output=True, text=True
        )
        lines = result.stdout.strip().split('\n')
        deleted = False
        for line in reversed(lines):
            if 'vpn-nat' in line:
                num = line.split()[0]
                if num.isdigit():
                    run_iptables(['-t', 'nat', '-D', 'POSTROUTING', num], check=False)
                    deleted = True
                    break
        if not deleted:
            break

    # Delete FORWARD rules with comment "vpn-nat"
    while True:
        result = subprocess.run(
            ['iptables', '-L', 'FORWARD', '--line-numbers', '-n'],
            capture_output=True, text=True
        )
        lines = result.stdout.strip().split('\n')
        deleted = False
        for line in reversed(lines):
            if 'vpn-nat' in line:
                num = line.split()[0]
                if num.isdigit():
                    run_iptables(['-D', 'FORWARD', num], check=False)
                    deleted = True
                    break
        if not deleted:
            break


def clear_gateway_nat():
    """Remove gateway-NAT rules previously added by this agent (idempotent)."""
    # (table, chain): table=None means the default 'filter' table.
    for table, chain in [('nat', 'POSTROUTING'), (None, 'FORWARD')]:
        prefix = ['-t', table] if table else []
        while True:
            result = subprocess.run(
                ['iptables'] + prefix + ['-L', chain, '--line-numbers', '-n'],
                capture_output=True, text=True
            )
            deleted = False
            for line in reversed(result.stdout.strip().split('\n')):
                if GW_NAT_COMMENT in line:
                    num = line.split()[0]
                    if num.isdigit():
                        run_iptables(prefix + ['-D', chain, num], check=False)
                        deleted = True
                        break
            if not deleted:
                break


def apply_gateway_nat():
    """Install masquerade + forward rules so NAT_GATEWAY_NETWORK reaches the
    internet through PUBLIC_INTERFACE (host-as-NAT-gateway). Idempotent.

    No-op unless NAT_GATEWAY_NETWORK is configured.
    """
    if not NAT_GATEWAY_NETWORK:
        return

    net = NAT_GATEWAY_NETWORK
    iface = PUBLIC_INTERFACE
    tag = ['-m', 'comment', '--comment', GW_NAT_COMMENT]

    # Remove any stale copies first so restarts don't stack duplicates.
    clear_gateway_nat()

    # IPsec site-to-site exemptions: traffic between the private subnet and these
    # remote networks must keep its real source IP (no masquerade) and be allowed
    # to forward in both directions. These RETURN rules are appended BEFORE the
    # MASQUERADE below so they take precedence in POSTROUTING (append order = chain
    # order on the same chain).
    exclude_nets = [s.strip() for s in NAT_GATEWAY_EXCLUDE.split(',') if s.strip()]
    for dst in exclude_nets:
        run_iptables(
            ['-t', 'nat', '-A', 'POSTROUTING', '-s', net, '-d', dst,
             '-j', 'RETURN'] + tag, check=False
        )
        run_iptables(['-A', 'FORWARD', '-s', net, '-d', dst, '-j', 'ACCEPT'] + tag, check=False)
        run_iptables(['-A', 'FORWARD', '-s', dst, '-d', net, '-j', 'ACCEPT'] + tag, check=False)
    if exclude_nets:
        logger.info(f"Gateway NAT exemptions (no-masquerade) for: {', '.join(exclude_nets)}")

    # SNAT traffic leaving the private subnet toward anything outside it.
    run_iptables(
        ['-t', 'nat', '-A', 'POSTROUTING', '-s', net, '!', '-d', net,
         '-o', iface, '-j', 'MASQUERADE'] + tag, check=False
    )
    # Allow the forward path out...
    run_iptables(
        ['-A', 'FORWARD', '-s', net, '!', '-d', net, '-o', iface,
         '-j', 'ACCEPT'] + tag, check=False
    )
    # ...and the return path back to the private subnet.
    run_iptables(
        ['-A', 'FORWARD', '-d', net, '-i', iface,
         '-m', 'state', '--state', 'RELATED,ESTABLISHED', '-j', 'ACCEPT'] + tag,
        check=False
    )
    logger.info(f"Gateway NAT applied: {net} -> {iface} (masquerade)")


def apply_nat_rules():
    """Apply NAT rules from database"""
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Get active NAT rules
        cur.execute("""
            SELECT id, name, nat_type, protocol, external_port,
                   internal_ip, internal_port, source_network, is_active
            FROM nat_rules
            WHERE is_active = true
        """)
        rules = cur.fetchall()

        cur.close()
        conn.close()

        # Clear existing VPN NAT rules
        clear_nat_rules()

        # Re-assert the gateway NAT (private subnet -> internet) alongside DNAT rules
        apply_gateway_nat()

        # Create VPN_RULES chain if not exists (for firewall status detection)
        subprocess.run(['iptables', '-N', 'VPN_RULES'], capture_output=True)

        # Apply each rule
        applied = 0
        errors = []

        for rule in rules:
            try:
                proto = rule['protocol'] or 'tcp'
                ext_port = str(rule['external_port'])
                int_ip = str(rule['internal_ip'])
                int_port = str(rule['internal_port'])

                # DNAT rule (PREROUTING)
                dnat_args = [
                    '-t', 'nat', '-A', 'PREROUTING',
                    '-p', proto,
                    '--dport', ext_port,
                    '-j', 'DNAT',
                    '--to-destination', f'{int_ip}:{int_port}',
                    '-m', 'comment', '--comment', 'vpn-nat'
                ]

                # Add source filter if specified
                source_nets = []
                if rule['source_network']:
                    source_nets = [s.strip() for s in str(rule['source_network']).split(',') if s.strip()]

                if source_nets:
                    # Create one DNAT rule per source IP/CIDR
                    dnat_ok = True
                    for src in source_nets:
                        src_args = dnat_args + ['-s', src]
                        success, err = run_iptables(src_args)
                        if not success:
                            errors.append(f"DNAT {rule['name']} src {src}: {err}")
                            dnat_ok = False
                    if not dnat_ok:
                        continue
                else:
                    success, err = run_iptables(dnat_args)
                    if not success:
                        errors.append(f"DNAT {rule['name']}: {err}")
                        continue

                # FORWARD rule
                forward_args = [
                    '-A', 'FORWARD',
                    '-p', proto,
                    '-d', int_ip,
                    '--dport', int_port,
                    '-j', 'ACCEPT',
                    '-m', 'comment', '--comment', 'vpn-nat'
                ]
                success, err = run_iptables(forward_args)
                if not success:
                    errors.append(f"FORWARD {rule['name']}: {err}")

                # MASQUERADE rule (POSTROUTING) - crucial for return traffic
                masq_args = [
                    '-t', 'nat', '-A', 'POSTROUTING',
                    '-d', int_ip,
                    '-p', proto,
                    '--dport', int_port,
                    '-j', 'MASQUERADE',
                    '-m', 'comment', '--comment', 'vpn-nat'
                ]
                success, err = run_iptables(masq_args)
                if not success:
                    errors.append(f"MASQUERADE {rule['name']}: {err}")

                applied += 1
                logger.info(f"Applied NAT rule: {rule['name']} ({ext_port} -> {int_ip}:{int_port})")

            except Exception as e:
                errors.append(f"{rule['name']}: {str(e)}")

        return {
            'success': len(errors) == 0,
            'applied': applied,
            'total': len(rules),
            'errors': errors
        }

    except Exception as e:
        logger.error(f"Failed to apply NAT rules: {e}")
        return {
            'success': False,
            'error': str(e)
        }


def check_auth():
    """Check API token"""
    token = request.headers.get('X-Api-Token')
    if token != API_TOKEN:
        return False
    return True


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok'})


@app.route('/status', methods=['GET'])
def status():
    """Check if firewall is active (VPN_RULES chain exists)"""
    if not check_auth():
        return jsonify({'error': 'Unauthorized'}), 401

    # Check if VPN_RULES chain exists
    result = subprocess.run(
        ['iptables', '-L', 'VPN_RULES', '-n'],
        capture_output=True, text=True
    )

    return jsonify({
        'is_active': result.returncode == 0,
        'chain_exists': result.returncode == 0,
        'output': result.stdout if result.returncode == 0 else result.stderr
    })


@app.route('/apply', methods=['POST'])
def apply():
    """Apply all NAT rules from database"""
    if not check_auth():
        return jsonify({'error': 'Unauthorized'}), 401

    result = apply_nat_rules()
    return jsonify(result)


@app.route('/rules', methods=['GET'])
def list_rules():
    """List current iptables NAT rules"""
    if not check_auth():
        return jsonify({'error': 'Unauthorized'}), 401

    result = subprocess.run(
        ['iptables', '-t', 'nat', '-L', '-n', '-v'],
        capture_output=True, text=True
    )
    return jsonify({
        'rules': result.stdout,
        'errors': result.stderr
    })


@app.route('/clear', methods=['POST'])
def clear():
    """Clear all VPN NAT rules"""
    if not check_auth():
        return jsonify({'error': 'Unauthorized'}), 401

    clear_nat_rules()
    return jsonify({'success': True, 'message': 'NAT rules cleared'})


if __name__ == '__main__':
    # Enable IP forwarding
    try:
        with open('/proc/sys/net/ipv4/ip_forward', 'w') as f:
            f.write('1')
        logger.info("IP forwarding enabled")
    except Exception as e:
        logger.warning(f"Could not enable IP forwarding: {e}")

    # Re-assert NAT rules on startup so they survive host/container reboots
    # (previously rules only existed after a POST /apply, so a reboot dropped them).
    try:
        apply_gateway_nat()
    except Exception as e:
        logger.warning(f"Could not apply gateway NAT on startup: {e}")
    try:
        apply_nat_rules()
    except Exception as e:
        logger.warning(f"Could not apply DB NAT rules on startup: {e}")

    logger.info("NAT Agent starting on port 8100...")
    app.run(host='0.0.0.0', port=8100)
