#!/bin/bash
#
# My Little Apps - Proxy Service Installation Script
# This script installs Caddy as a LaunchDaemon
# Requires: admin privileges (will be run via osascript)
#

set -e

RESOURCE_DIR="$1"
if [ -z "$RESOURCE_DIR" ]; then
    echo "Usage: $0 <resource-dir>"
    exit 1
fi

INSTALL_DIR="/usr/local/bin/my-little-apps"
CONFIG_DIR="/usr/local/etc/my-little-apps"
LOG_DIR="/usr/local/var/log/my-little-apps"
LAUNCH_DAEMONS_DIR="/Library/LaunchDaemons"

echo "Installing My Little Apps proxy service..."
echo "Resource dir: $RESOURCE_DIR"

ARCH=$(uname -m)
echo "Architecture: $ARCH"

echo "Creating directories..."
mkdir -p "$INSTALL_DIR"
mkdir -p "$CONFIG_DIR"
mkdir -p "$LOG_DIR"

echo "Copying Caddy binary..."
if [ "$ARCH" = "arm64" ]; then
    cp "$RESOURCE_DIR/caddy-darwin-arm64" "$INSTALL_DIR/caddy"
else
    cp "$RESOURCE_DIR/caddy-darwin-amd64" "$INSTALL_DIR/caddy"
fi
chmod +x "$INSTALL_DIR/caddy"

echo "Creating Caddyfile..."
cat > "$CONFIG_DIR/Caddyfile" << 'EOF'
{
    auto_https off
    admin localhost:2019
}

:80 {
    respond "My Little Apps proxy is running. No apps configured yet." 200
}
EOF

echo "Installing Caddy LaunchDaemon..."
cp "$RESOURCE_DIR/com.my-little-apps.caddy.plist" \
    "$LAUNCH_DAEMONS_DIR/com.my-little-apps.caddy.plist"

echo "Loading LaunchDaemon..."
launchctl unload "$LAUNCH_DAEMONS_DIR/com.my-little-apps.caddy.plist" 2>/dev/null || true
launchctl load "$LAUNCH_DAEMONS_DIR/com.my-little-apps.caddy.plist"

echo ""
echo "========================================"
echo "Installation complete!"
echo "========================================"
echo ""
echo "Your apps will be accessible at:"
echo "  http://<app-name>.local"
echo ""
echo "This works automatically on all devices"
echo "on the same Wi-Fi network via mDNS."
echo ""
