#!/usr/bin/env python3
"""
IPsec Agent - Runs on host to execute StrongSwan commands
Provides REST API for the backend to control IPsec tunnels
"""
import os
import subprocess
import logging
from flask import Flask, jsonify, request

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Simple token auth
AUTH_TOKEN = os.environ.get('IPSEC_AGENT_TOKEN', 'changeme-ipsec-token')

def check_auth():
    """Check authorization header"""
    auth = request.headers.get('Authorization', '')
    if auth != f'Bearer {AUTH_TOKEN}':
        return False
    return True

def run_ipsec_command(args):
    """Run ipsec command and return result"""
    try:
        cmd = ['ipsec'] + args
        logger.info(f"Running: {' '.join(cmd)}")
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60
        )
        return {
            'success': result.returncode == 0,
            'stdout': result.stdout,
            'stderr': result.stderr,
            'output': result.stdout + result.stderr,
            'returncode': result.returncode
        }
    except subprocess.TimeoutExpired:
        return {'success': False, 'output': 'Command timed out', 'returncode': -1}
    except FileNotFoundError:
        return {'success': False, 'output': 'ipsec command not found', 'returncode': -1}
    except Exception as e:
        return {'success': False, 'output': str(e), 'returncode': -1}

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    result = run_ipsec_command(['version'])
    return jsonify({
        'status': 'healthy' if result['success'] else 'unhealthy',
        'ipsec_installed': result['success'],
        'version': result['stdout'].split('\n')[0] if result['success'] else None
    })

@app.route('/version', methods=['GET'])
def version():
    """Get StrongSwan version"""
    if not check_auth():
        return jsonify({'error': 'Unauthorized'}), 401
    result = run_ipsec_command(['version'])
    return jsonify(result)

@app.route('/status', methods=['GET'])
def status():
    """Get IPsec status (ipsec statusall)"""
    if not check_auth():
        return jsonify({'error': 'Unauthorized'}), 401
    result = run_ipsec_command(['statusall'])
    return jsonify(result)

@app.route('/status/<connection_name>', methods=['GET'])
def status_connection(connection_name):
    """Get status of specific connection"""
    if not check_auth():
        return jsonify({'error': 'Unauthorized'}), 401
    result = run_ipsec_command(['status', connection_name])
    return jsonify(result)

@app.route('/up/<connection_name>', methods=['POST'])
def connection_up(connection_name):
    """Start a connection (ipsec up)"""
    if not check_auth():
        return jsonify({'error': 'Unauthorized'}), 401
    result = run_ipsec_command(['up', connection_name])
    return jsonify(result)

@app.route('/down/<connection_name>', methods=['POST'])
def connection_down(connection_name):
    """Stop a connection (ipsec down)"""
    if not check_auth():
        return jsonify({'error': 'Unauthorized'}), 401
    result = run_ipsec_command(['down', connection_name])
    return jsonify(result)

@app.route('/reload', methods=['POST'])
def reload_config():
    """Reload IPsec configuration.

    'ipsec reload' rereads ipsec.conf but NOT ipsec.secrets, so a freshly
    configured PSK would fail with "no shared key found" until a restart.
    Run 'ipsec rereadsecrets' first so new/changed PSKs take effect on reload.
    """
    if not check_auth():
        return jsonify({'error': 'Unauthorized'}), 401
    reread = run_ipsec_command(['rereadsecrets'])  # reload ipsec.secrets (PSKs)
    result = run_ipsec_command(['reload'])          # reload ipsec.conf
    result['rereadsecrets'] = reread
    return jsonify(result)

@app.route('/restart', methods=['POST'])
def restart_ipsec():
    """Restart StrongSwan"""
    if not check_auth():
        return jsonify({'error': 'Unauthorized'}), 401
    result = run_ipsec_command(['restart'])
    return jsonify(result)

@app.route('/config/write', methods=['POST'])
def write_config():
    """Write ipsec.conf and ipsec.secrets files"""
    if not check_auth():
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.json
    results = {}

    # Write ipsec.conf
    if 'ipsec_conf' in data:
        try:
            with open('/etc/ipsec.conf', 'w') as f:
                f.write(data['ipsec_conf'])
            results['ipsec_conf'] = {'success': True}
            logger.info("Wrote /etc/ipsec.conf")
        except Exception as e:
            results['ipsec_conf'] = {'success': False, 'error': str(e)}

    # Write ipsec.secrets
    if 'ipsec_secrets' in data:
        try:
            with open('/etc/ipsec.secrets', 'w') as f:
                f.write(data['ipsec_secrets'])
            # Set proper permissions
            os.chmod('/etc/ipsec.secrets', 0o600)
            results['ipsec_secrets'] = {'success': True}
            logger.info("Wrote /etc/ipsec.secrets")
        except Exception as e:
            results['ipsec_secrets'] = {'success': False, 'error': str(e)}

    return jsonify(results)

@app.route('/config/read', methods=['GET'])
def read_config():
    """Read current ipsec.conf and ipsec.secrets"""
    if not check_auth():
        return jsonify({'error': 'Unauthorized'}), 401

    result = {}

    try:
        with open('/etc/ipsec.conf', 'r') as f:
            result['ipsec_conf'] = f.read()
    except Exception as e:
        result['ipsec_conf_error'] = str(e)

    try:
        with open('/etc/ipsec.secrets', 'r') as f:
            result['ipsec_secrets'] = f.read()
    except Exception as e:
        result['ipsec_secrets_error'] = str(e)

    return jsonify(result)


@app.route('/statusall', methods=['GET'])
def statusall():
    """Get detailed IPsec status (ipsec statusall) - raw output"""
    if not check_auth():
        return jsonify({'error': 'Unauthorized'}), 401
    result = run_ipsec_command(['statusall'])
    return jsonify(result)


@app.route('/logs', methods=['GET'])
def get_logs():
    """Get recent IPsec/StrongSwan logs from journalctl (charon + strongswan-starter)"""
    if not check_auth():
        return jsonify({'error': 'Unauthorized'}), 401

    lines = request.args.get('lines', '100')
    connection = request.args.get('connection', None)

    try:
        max_lines = int(lines)

        journal_cmd = [
            'journalctl',
            '-t', 'charon',
            '-t', 'ipsec',
            '-t', 'ipsec_starter',
            '--no-pager',
            '-n', str(max_lines * 3 if connection else max_lines),
        ]

        result = subprocess.run(
            journal_cmd,
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode == 0 and result.stdout.strip():
            log_lines = result.stdout.strip().split('\n')

            if connection:
                conn_lower = connection.lower()
                filtered = [
                    line for line in log_lines
                    if conn_lower in line.lower()
                    or 'error' in line.lower()
                    or 'failed' in line.lower()
                ]
                log_output = '\n'.join(filtered[-max_lines:])
                source = f'journalctl (filtered: {connection})'
            else:
                log_output = '\n'.join(log_lines[-max_lines:])
                source = 'journalctl'

            if log_output.strip():
                return jsonify({
                    'success': True,
                    'logs': log_output,
                    'source': source,
                    'connection': connection
                })

        # Fallback: try log files directly
        log_paths = [
            '/var/log/charon.log',
            '/var/log/strongswan.log',
            '/var/log/syslog'
        ]

        for log_path in log_paths:
            try:
                result = subprocess.run(
                    ['tail', '-n', str(max_lines * 3 if connection else max_lines), log_path],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                if result.returncode == 0 and result.stdout.strip():
                    log_lines = result.stdout.strip().split('\n')
                    if connection:
                        conn_lower = connection.lower()
                        log_lines = [l for l in log_lines if conn_lower in l.lower()]
                    log_output = '\n'.join(log_lines[-max_lines:])
                    if log_output.strip():
                        return jsonify({
                            'success': True,
                            'logs': log_output,
                            'source': log_path,
                            'connection': connection
                        })
            except Exception:
                continue

        return jsonify({
            'success': True,
            'logs': f'No logs found{" for connection " + connection if connection else ""}',
            'source': None,
            'connection': connection
        })

    except subprocess.TimeoutExpired:
        return jsonify({'success': False, 'logs': 'Timeout reading logs', 'source': None})
    except Exception as e:
        return jsonify({'success': False, 'logs': str(e), 'source': None})

if __name__ == '__main__':
    port = int(os.environ.get('IPSEC_AGENT_PORT', 8101))
    logger.info(f"Starting IPsec Agent on port {port}")
    app.run(host='0.0.0.0', port=port)
