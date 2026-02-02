#!/bin/bash
#
# My Little Apps - Proxy Service Installation Script
# This script installs dnsmasq and Caddy as LaunchDaemons
# Requires: admin privileges (will be run via osascript)
#

set -e

# Arguments
RESOURCE_DIR="$1"
if [ -z "$RESOURCE_DIR" ]; then
    echo "Usage: $0 <resource-dir>"
    exit 1
fi

# Configuration
HOSTNAME=$(scutil --get LocalHostName 2>/dev/null | tr '[:upper:]' '[:lower:]' || hostname | tr '[:upper:]' '[:lower:]' | sed 's/\.local$//')
INSTALL_DIR="/usr/local/bin/my-little-apps"
CONFIG_DIR="/usr/local/etc/my-little-apps"
LOG_DIR="/usr/local/var/log/my-little-apps"
RUN_DIR="/usr/local/var/run/my-little-apps"
LAUNCH_DAEMONS_DIR="/Library/LaunchDaemons"

echo "Installing My Little Apps proxy service..."
echo "Hostname: $HOSTNAME"
echo "Resource dir: $RESOURCE_DIR"

# Detect architecture
ARCH=$(uname -m)
echo "Architecture: $ARCH"

# Create directories
echo "Creating directories..."
mkdir -p "$INSTALL_DIR"
mkdir -p "$CONFIG_DIR"
mkdir -p "$LOG_DIR"
mkdir -p "$RUN_DIR"

# Copy binaries based on architecture
echo "Copying binaries..."
if [ "$ARCH" = "arm64" ]; then
    cp "$RESOURCE_DIR/caddy-darwin-arm64" "$INSTALL_DIR/caddy"
    cp "$RESOURCE_DIR/dnsmasq-darwin-arm64" "$INSTALL_DIR/dnsmasq"
else
    cp "$RESOURCE_DIR/caddy-darwin-amd64" "$INSTALL_DIR/caddy"
    cp "$RESOURCE_DIR/dnsmasq-darwin-amd64" "$INSTALL_DIR/dnsmasq"
fi
chmod +x "$INSTALL_DIR/caddy"
chmod +x "$INSTALL_DIR/dnsmasq"

# Create initial Caddyfile
echo "Creating Caddyfile..."
cat > "$CONFIG_DIR/Caddyfile" << 'EOF'
{
    auto_https off
    admin localhost:2019
}

# Default catch-all (no apps configured yet)
:80 {
    respond "My Little Apps proxy is running. No apps configured yet." 200
}
EOF

# Create resolver directory and file
echo "Creating DNS resolver..."
mkdir -p /etc/resolver
echo "nameserver 127.0.0.1" > "/etc/resolver/$HOSTNAME.local"

# Install dnsmasq LaunchDaemon (replace placeholder with actual hostname)
echo "Installing dnsmasq LaunchDaemon..."
sed "s/__HOSTNAME__/$HOSTNAME/g" "$RESOURCE_DIR/com.my-little-apps.dnsmasq.plist" > \
    "$LAUNCH_DAEMONS_DIR/com.my-little-apps.dnsmasq.plist"

# Install Caddy LaunchDaemon
echo "Installing Caddy LaunchDaemon..."
cp "$RESOURCE_DIR/com.my-little-apps.caddy.plist" \
    "$LAUNCH_DAEMONS_DIR/com.my-little-apps.caddy.plist"

# Unload existing daemons if they exist (ignore errors)
echo "Loading LaunchDaemons..."
launchctl unload "$LAUNCH_DAEMONS_DIR/com.my-little-apps.dnsmasq.plist" 2>/dev/null || true
launchctl unload "$LAUNCH_DAEMONS_DIR/com.my-little-apps.caddy.plist" 2>/dev/null || true

# Load daemons
launchctl load "$LAUNCH_DAEMONS_DIR/com.my-little-apps.dnsmasq.plist"
launchctl load "$LAUNCH_DAEMONS_DIR/com.my-little-apps.caddy.plist"

# Flush DNS cache
echo "Flushing DNS cache..."
dscacheutil -flushcache
killall -HUP mDNSResponder 2>/dev/null || true

echo ""
echo "========================================"
echo "Installation complete!"
echo "========================================"
echo ""
echo "DNS resolver configured for: *.$HOSTNAME.local"
echo "Proxy listening on: http://*.$HOSTNAME.local"
echo ""
echo "You can now access your apps at:"
echo "  http://<app-name>.$HOSTNAME.local"
echo ""
