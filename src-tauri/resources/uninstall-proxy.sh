#!/bin/bash
#
# My Little Apps - Proxy Service Uninstallation Script
# Removes Caddy LaunchDaemon and all related files
# Requires: admin privileges (will be run via osascript)
#

set -e

INSTALL_DIR="/usr/local/bin/my-little-apps"
CONFIG_DIR="/usr/local/etc/my-little-apps"
LOG_DIR="/usr/local/var/log/my-little-apps"
LAUNCH_DAEMONS_DIR="/Library/LaunchDaemons"

echo "Uninstalling My Little Apps proxy service..."

echo "Stopping LaunchDaemon..."
launchctl unload "$LAUNCH_DAEMONS_DIR/com.my-little-apps.caddy.plist" 2>/dev/null || true

echo "Removing LaunchDaemon plist..."
rm -f "$LAUNCH_DAEMONS_DIR/com.my-little-apps.caddy.plist"

echo "Removing binaries..."
rm -rf "$INSTALL_DIR"

echo "Removing configuration..."
rm -rf "$CONFIG_DIR"

echo "Removing logs..."
rm -rf "$LOG_DIR"

echo ""
echo "========================================"
echo "Uninstallation complete!"
echo "========================================"
echo ""
echo "The proxy service has been removed."
echo "Your apps will now only be accessible via localhost:<port>"
echo ""
