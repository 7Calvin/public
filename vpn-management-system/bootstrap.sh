#!/usr/bin/env bash
#
# VPN Management System - one-line installer / bootstrapper
#
# Usage (fresh Ubuntu 24.04, as root or with sudo):
#
#   curl -fsSL https://raw.githubusercontent.com/7Calvin/public/main/vpn-management-system/bootstrap.sh | sudo bash
#
# What it does:
#   1. installs the minimal tools needed to fetch the source (git, curl)
#   2. clones (or updates) the repository into /opt/vpn-management-src
#   3. runs install.sh, reconnecting the terminal so the guided (whiptail)
#      installer works even though this script arrived through a curl | bash pipe
#
# Fully unattended install (no prompts) — pass NONINTERACTIVE and any config:
#
#   curl -fsSL <url>/bootstrap.sh | sudo NONINTERACTIVE=1 DOMAIN=vpn.example.com bash
#
# Pin to a specific release instead of the latest main:
#
#   curl -fsSL <url>/bootstrap.sh | sudo VPN_REPO_REF=v1.1.2 bash
#
set -euo pipefail

REPO_URL="${VPN_REPO_URL:-https://github.com/7Calvin/public.git}"
REPO_REF="${VPN_REPO_REF:-main}"          # branch or tag
SUBDIR="vpn-management-system"
SRC_DIR="${VPN_SRC_DIR:-/opt/vpn-management-src}"

# --- Colors (only when attached to a terminal) ---
if [ -t 1 ]; then
    BLUE='\033[0;34m'; GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
else
    BLUE=''; GREEN=''; RED=''; NC=''
fi
say()  { echo -e "${BLUE}==>${NC} $*"; }
ok()   { echo -e "${GREEN}==>${NC} $*"; }
die()  { echo -e "${RED}error:${NC} $*" >&2; exit 1; }

# --- Must be root ---
if [ "$(id -u)" -ne 0 ]; then
    die "run as root, e.g.:  curl -fsSL <url>/bootstrap.sh | sudo bash"
fi

# --- Minimal prerequisites to clone the repo ---
say "Installing prerequisites (git, curl)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates >/dev/null

# --- Clone or update the source ---
if [ -d "$SRC_DIR/.git" ]; then
    say "Updating existing source in $SRC_DIR ..."
    git -C "$SRC_DIR" fetch --tags --prune --depth 1 origin "$REPO_REF"
    git -C "$SRC_DIR" checkout -f "$REPO_REF"
    git -C "$SRC_DIR" reset --hard "origin/$REPO_REF" 2>/dev/null || true
else
    say "Cloning $REPO_URL ($REPO_REF) into $SRC_DIR ..."
    rm -rf "$SRC_DIR"
    git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$SRC_DIR" 2>/dev/null \
        || git clone "$REPO_URL" "$SRC_DIR"   # fallback if REF is a specific commit
fi

APP_DIR="$SRC_DIR/$SUBDIR"
[ -f "$APP_DIR/install.sh" ] || die "install.sh not found under $APP_DIR"
chmod +x "$APP_DIR/install.sh"

ok "Source ready. Launching installer..."
cd "$APP_DIR"

# Run the installer. If a terminal is available and the caller didn't force
# NONINTERACTIVE, reconnect stdin to /dev/tty so the guided whiptail installer
# runs (a curl | bash pipe otherwise leaves stdin non-interactive).
if [ -z "${NONINTERACTIVE:-}" ] && [ -e /dev/tty ]; then
    exec ./install.sh < /dev/tty
else
    exec ./install.sh
fi
