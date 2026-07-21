#!/bin/bash
#
# update.sh - Resilient full-system updater for the VPN Management System.
#
# Runs on the HOST (invoked by the update-agent systemd service, or manually /
# by `vpnctl update`). It is intentionally decoupled from the docker-compose
# lifecycle so that rebuilding/restarting the backend or frontend mid-update
# cannot kill the update.
#
# Design goals:
#   * Never leave the system in a broken state ("cair no meio"):
#       - build images BEFORE stopping anything (a build failure changes nothing)
#       - no `docker compose down`  -> postgres/redis/traefik never blink
#       - health-gate after `up -d`, with automatic code rollback on failure
#   * Never destroy OpenVPN certificates/PKI:
#       - the openvpn_data named volume is never removed (no `down -v`, ever)
#       - assert ca.crt survives the update, restore from backup if it vanishes
#       - server.conf and PKI/ccd are preserved; only runtime scripts refresh
#
# Progress is written to $STATE_DIR/status.json (JSON, polled by the agent) and
# $STATE_DIR/update.log (human log). The frontend polls the agent, which serves
# these files, so progress stays visible even while the backend is rebuilding.
#
set -uo pipefail

# ==================== Configuration (overridable via env) ====================
INSTALL_DIR="${INSTALL_DIR:-/opt/vpn-management}"
REPO_DIR="${REPO_DIR:-${INSTALL_DIR}/repo}"
GIT_REMOTE="${GIT_REMOTE:-https://github.com/7Calvin/public.git}"
# The app lives in a subdirectory of the repo.
REPO_SUBDIR="${REPO_SUBDIR:-vpn-management-system}"
GIT_BRANCH="${GIT_BRANCH:-main}"
COMPOSE_FILE="${COMPOSE_FILE:-${INSTALL_DIR}/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-${INSTALL_DIR}/config/.env}"
STATE_DIR="${STATE_DIR:-/var/lib/vpn-update}"
BACKUP_DIR="${BACKUP_DIR:-${INSTALL_DIR}/backups}"
LOCK_FILE="${STATE_DIR}/update.lock"
STATUS_FILE="${STATE_DIR}/status.json"
LOG_FILE="${STATE_DIR}/update.log"
HEALTH_URL="${HEALTH_URL:-http://localhost/health}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"   # seconds to wait for /health after up
OPENVPN_CONTAINER="${OPENVPN_CONTAINER:-vpn-openvpn}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-vpn-backend}"

# Services rebuilt on update. Postgres/redis/traefik are intentionally excluded
# so they never restart during an update.
BUILD_SERVICES="backend frontend nat-agent openvpn"

# Inputs (from the agent, via env)
UPDATE_REF="${UPDATE_REF:-}"                       # tag/branch; empty => latest tag
DO_BACKUP="${DO_BACKUP:-1}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-1}"
JOB_ID="${JOB_ID:-manual-$(date -u +%Y%m%d%H%M%S)}"

mkdir -p "$STATE_DIR" "$BACKUP_DIR"

compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

_json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

# write_status <pct> <state> <message> [error]
write_status() {
    local pct="$1" state="$2" msg; msg="$(_json_escape "$3")"
    local err; err="$(_json_escape "${4:-}")"
    local now; now="$(date -u +%FT%TZ)"
    cat > "${STATUS_FILE}.tmp" <<EOF
{
  "job_id": "$(_json_escape "$JOB_ID")",
  "state": "$state",
  "pct": $pct,
  "message": "$msg",
  "error": "$err",
  "ref": "$(_json_escape "${UPDATE_REF:-latest}")",
  "updated_at": "$now"
}
EOF
    mv -f "${STATUS_FILE}.tmp" "$STATUS_FILE"
    echo "[$(date -u +%T)] ${pct}% ${state}: $3${4:+ | ERROR: $4}" >> "$LOG_FILE"
}

fail() {
    write_status "${1:-100}" "failed" "${2:-Update failed}" "${3:-}"
    exit 1
}

# ==================== Single-instance lock ====================
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    echo "Another update is already running" >&2
    exit 3
fi

: > "$LOG_FILE"   # fresh log per run
write_status 1 "running" "Starting update (job $JOB_ID)"

# ==================== Preflight ====================
write_status 3 "running" "Preflight checks..."

command -v docker >/dev/null 2>&1 || fail 3 "docker not found on host"
command -v git >/dev/null 2>&1 || fail 3 "git not found on host"

# Disk space guard (need a few GB to rebuild images).
avail_kb="$(df -Pk "$INSTALL_DIR" | awk 'NR==2{print $4}')"
if [ -n "$avail_kb" ] && [ "$avail_kb" -lt 2097152 ]; then
    fail 3 "Not enough disk space (<2GB free) to rebuild images"
fi

# Record whether OpenVPN currently has a CA, so we can prove it survives.
HAD_CA=0
if docker exec "$OPENVPN_CONTAINER" test -f /etc/openvpn/ca.crt 2>/dev/null; then
    HAD_CA=1
    echo "Preflight: OpenVPN CA present, will verify it survives the update" >> "$LOG_FILE"
fi

# ==================== Ensure repo checkout ====================
write_status 8 "running" "Preparing source checkout..."
if [ ! -d "$REPO_DIR/.git" ]; then
    echo "Cloning $GIT_REMOTE -> $REPO_DIR" >> "$LOG_FILE"
    git clone "$GIT_REMOTE" "$REPO_DIR" >> "$LOG_FILE" 2>&1 || fail 8 "git clone failed"
fi

cd "$REPO_DIR" || fail 8 "cannot enter repo dir"
PREV_SHA="$(git rev-parse HEAD 2>/dev/null || echo '')"
# Version currently installed (used to detect a rollback/downgrade below).
INSTALLED_VERSION="$(cat "${INSTALL_DIR}/VERSION" 2>/dev/null | tr -d '[:space:]')"

git fetch --tags --prune origin >> "$LOG_FILE" 2>&1 || fail 8 "git fetch failed"

# Resolve target ref: explicit ref, else latest semver-ish tag, else branch head.
TARGET_REF="$UPDATE_REF"
if [ -z "$TARGET_REF" ]; then
    TARGET_REF="$(git tag -l 'v*' --sort=-v:refname | head -n1)"
fi
if [ -z "$TARGET_REF" ]; then
    TARGET_REF="origin/${GIT_BRANCH}"
fi
UPDATE_REF="$TARGET_REF"

# Only chase the branch tip when we are explicitly tracking the branch. For a tag
# or a pinned commit — i.e. a rollback to an older version — a later
# `git pull --ff-only` would fast-forward the old tag back up to the branch tip and
# silently undo the rollback. So we pin (detached HEAD) unless the target IS the branch.
TRACK_BRANCH=0
case "$TARGET_REF" in
    "origin/${GIT_BRANCH}"|"${GIT_BRANCH}") TRACK_BRANCH=1 ;;
esac

# ==================== Backup (DB + OpenVPN PKI + config) ====================
if [ "$DO_BACKUP" = "1" ]; then
    write_status 12 "running" "Backing up database, PKI and config..."
    ts="$(date -u +%Y%m%d-%H%M%S)"
    bdir="${BACKUP_DIR}/pre-update-${ts}"
    mkdir -p "$bdir"

    # Postgres dump (best effort; container name from compose)
    if docker exec vpn-postgres sh -c 'command -v pg_dump' >/dev/null 2>&1; then
        docker exec vpn-postgres sh -c \
            'pg_dump -U "${POSTGRES_USER:-vpn_admin}" "${POSTGRES_DB:-vpn_management}"' \
            > "${bdir}/db.sql" 2>>"$LOG_FILE" || echo "WARN: db dump failed" >> "$LOG_FILE"
    fi

    # OpenVPN PKI/certs/ccd — the crown jewels. Tar them out of the volume.
    if [ "$HAD_CA" = "1" ]; then
        docker exec "$OPENVPN_CONTAINER" tar -czf - \
            -C /etc/openvpn ca.crt server.crt server.key ta.key dh.pem \
            server.conf ccd ipp.txt pki 2>/dev/null \
            > "${bdir}/openvpn-pki.tar.gz" 2>>"$LOG_FILE" \
            || echo "WARN: openvpn PKI backup partial" >> "$LOG_FILE"
    fi

    # Config (.env etc.)
    [ -d "${INSTALL_DIR}/config" ] && cp -a "${INSTALL_DIR}/config" "${bdir}/config" 2>>"$LOG_FILE"
    echo "$bdir" > "${STATE_DIR}/last-backup"
    echo "Backup stored at $bdir" >> "$LOG_FILE"
fi

# ==================== Checkout target ====================
write_status 20 "running" "Checking out ${UPDATE_REF}..."
git checkout -f "$UPDATE_REF" >> "$LOG_FILE" 2>&1 || fail 20 "git checkout $UPDATE_REF failed"
# Only fast-forward to the branch tip when tracking the branch — never for a tag or
# commit pin, or a rollback to an older tag would be undone (see TRACK_BRANCH above).
if [ "$TRACK_BRANCH" = "1" ]; then
    git pull --ff-only origin "$GIT_BRANCH" >> "$LOG_FILE" 2>&1 || true
fi
NEW_SHA="$(git rev-parse HEAD)"

SRC="${REPO_DIR}/${REPO_SUBDIR}"
[ -d "$SRC" ] || fail 20 "source subdir $SRC not found in repo"

# Detect a rollback: target VERSION older than the installed one (version-sorted).
TARGET_VERSION="$(cat "${SRC}/VERSION" 2>/dev/null | tr -d '[:space:]')"
IS_DOWNGRADE=0
if [ -n "$INSTALLED_VERSION" ] && [ -n "$TARGET_VERSION" ] && [ "$INSTALLED_VERSION" != "$TARGET_VERSION" ]; then
    lower="$(printf '%s\n%s\n' "$INSTALLED_VERSION" "$TARGET_VERSION" | sort -V | head -n1)"
    [ "$lower" = "$TARGET_VERSION" ] && IS_DOWNGRADE=1
fi
[ "$IS_DOWNGRADE" = "1" ] && echo "Rollback detected: v${INSTALLED_VERSION} -> v${TARGET_VERSION}" >> "$LOG_FILE"

# ==================== Sync application files ====================
# NOTE: docker-compose.yml and config/.env are NOT synced here — structural
# compose changes go through install.sh. This keeps the openvpn_data volume
# definition (and thus the certs) untouched by construction.
write_status 30 "running" "Syncing application files..."
rsync -a --delete --exclude='node_modules' --exclude='dist' --exclude='.next' \
    "${SRC}/frontend/" "${INSTALL_DIR}/frontend/" >> "$LOG_FILE" 2>&1 || fail 30 "frontend sync failed"
rsync -a --delete --exclude='__pycache__' --exclude='*.pyc' --exclude='.pytest_cache' \
    "${SRC}/backend/" "${INSTALL_DIR}/backend/" >> "$LOG_FILE" 2>&1 || fail 30 "backend sync failed"
rsync -a --delete "${SRC}/docker/" "${INSTALL_DIR}/docker/" >> "$LOG_FILE" 2>&1 || fail 30 "docker sync failed"
[ -f "${SRC}/VERSION" ] && cp -f "${SRC}/VERSION" "${INSTALL_DIR}/VERSION"

# ==================== Build BEFORE touching running containers ====================
# If a build fails here, nothing has been stopped or recreated yet.
write_status 45 "running" "Building images (this can take a few minutes)..."
if ! compose build $BUILD_SERVICES >> "$LOG_FILE" 2>&1; then
    fail 45 "Image build failed — no containers were changed, system still running"
fi

# ==================== Apply (recreate changed containers, no down) ====================
write_status 62 "running" "Applying update (recreating containers)..."
compose up -d $BUILD_SERVICES >> "$LOG_FILE" 2>&1 || fail 62 "docker compose up failed"

# ==================== OpenVPN safety: certs must have survived ====================
write_status 70 "running" "Verifying OpenVPN certificates..."
if [ "$HAD_CA" = "1" ]; then
    ok=0
    for _ in $(seq 1 15); do
        if docker exec "$OPENVPN_CONTAINER" test -f /etc/openvpn/ca.crt 2>/dev/null; then ok=1; break; fi
        sleep 2
    done
    if [ "$ok" != "1" ]; then
        echo "CRITICAL: OpenVPN CA missing after update! Restoring from backup..." >> "$LOG_FILE"
        if [ -f "${bdir:-}/openvpn-pki.tar.gz" ]; then
            docker exec -i "$OPENVPN_CONTAINER" tar -xzf - -C /etc/openvpn \
                < "${bdir}/openvpn-pki.tar.gz" >> "$LOG_FILE" 2>&1 || true
            docker restart "$OPENVPN_CONTAINER" >> "$LOG_FILE" 2>&1 || true
        fi
        fail 70 "OpenVPN CA was lost during update; attempted restore from backup — verify VPN manually"
    fi
    echo "OpenVPN CA verified intact." >> "$LOG_FILE"
fi
# Runtime scripts refresh automatically via start.sh (code, not data). server.conf
# is preserved; use the 'regenerate config' action to rebuild it explicitly.

# ==================== Database migrations ====================
if [ "$RUN_MIGRATIONS" = "1" ] && [ "$IS_DOWNGRADE" = "1" ]; then
    # Rollback: the DB schema is newer than the target code. We do NOT auto-downgrade
    # (that would drop columns/tables and lose data). Additive migrations are
    # backward-compatible, so the older code runs fine against the newer schema. The
    # pre-update dump is kept for a manual restore if a hard downgrade is ever needed.
    write_status 78 "running" "Rollback — leaving DB schema as-is (forward-compatible); skipping migrations"
    echo "Downgrade to v${TARGET_VERSION}: DB schema left untouched. Pre-update dump: ${bdir:-N/A}" >> "$LOG_FILE"
elif [ "$RUN_MIGRATIONS" = "1" ]; then
    write_status 78 "running" "Running database migrations..."
    # Wait for backend container to be up enough to run alembic.
    for _ in $(seq 1 20); do
        docker exec "$BACKEND_CONTAINER" sh -c 'command -v alembic' >/dev/null 2>&1 && break
        sleep 2
    done
    if ! docker exec "$BACKEND_CONTAINER" alembic upgrade head >> "$LOG_FILE" 2>&1; then
        echo "WARN: alembic upgrade failed" >> "$LOG_FILE"
        # Migrations failing is serious; trigger rollback path below by failing health.
    fi
fi

# ==================== Health gate ====================
write_status 85 "running" "Waiting for services to become healthy..."
healthy=0
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then healthy=1; break; fi
    sleep 3
done

if [ "$healthy" != "1" ]; then
    # ---------- Automatic rollback to previous code ----------
    write_status 88 "running" "Unhealthy after update — rolling back to previous version..."
    if [ -n "$PREV_SHA" ]; then
        ( cd "$REPO_DIR" && git checkout -f "$PREV_SHA" >> "$LOG_FILE" 2>&1 ) || true
        rsync -a --delete --exclude='node_modules' --exclude='dist' \
            "${SRC}/frontend/" "${INSTALL_DIR}/frontend/" >> "$LOG_FILE" 2>&1 || true
        rsync -a --delete --exclude='__pycache__' --exclude='*.pyc' \
            "${SRC}/backend/" "${INSTALL_DIR}/backend/" >> "$LOG_FILE" 2>&1 || true
        rsync -a --delete "${SRC}/docker/" "${INSTALL_DIR}/docker/" >> "$LOG_FILE" 2>&1 || true
        compose build $BUILD_SERVICES >> "$LOG_FILE" 2>&1 || true
        compose up -d $BUILD_SERVICES >> "$LOG_FILE" 2>&1 || true
        # Re-check health after rollback
        rb_deadline=$(( $(date +%s) + 90 ))
        rb_ok=0
        while [ "$(date +%s)" -lt "$rb_deadline" ]; do
            curl -fsS "$HEALTH_URL" >/dev/null 2>&1 && { rb_ok=1; break; }
            sleep 3
        done
        if [ "$rb_ok" = "1" ]; then
            write_status 100 "rolled_back" \
                "Update failed health check; rolled back to previous version successfully"
            exit 2
        fi
    fi
    fail 90 "Update failed and rollback did not restore health — check ${LOG_FILE} and backup ${bdir:-N/A}"
fi

# ==================== Success ====================
# NOTE: the update-agent and this script are refreshed OUT-OF-BAND by systemd, not
# from here. An `update-agent-refresh.path` unit watches the synced agent code
# (${INSTALL_DIR}/docker/update-agent) and restarts the agent — after any in-flight
# update finishes — so its ExecStartPre re-adopts the deployed version. Keeping the
# refresh in systemd (which survives rollbacks, unlike this script) means a rollback
# through an older version and back never strands the agent on stale code.
NEW_VERSION="$(cat "${INSTALL_DIR}/VERSION" 2>/dev/null | tr -d '[:space:]')"
write_status 100 "done" "Update complete${NEW_VERSION:+ — now on v${NEW_VERSION}} (${NEW_SHA:0:8})"
exit 0
