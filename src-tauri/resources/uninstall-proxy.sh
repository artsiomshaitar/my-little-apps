#!/bin/bash
#
# My Little Apps - Proxy Service Uninstallation Script
# Removes dnsmasq and Caddy LaunchDaemons and all related files
# Requires: admin privileges (will be run via osascript)
#

set -e

# Configuration
HOSTNAME=$(hostname | tr '[:upper:]' '[:lower:]' | sed 's/\.local$//')
INSTALL_DIR="/usr/local/bin/my-little-apps"
CONFIG_DIR="/usr/local/etc/my-little-apps"
LOG_DIR="/usr/local/var/log/my-little-apps"
LAUNCH_DAEMONS_DIR="/Library/LaunchDaemons"

echo "Uninstalling My Little Apps proxy service..."

# Stop and unload daemons
echo "Stopping LaunchDaemons..."
launchctl unload "$LAUNCH_DAEMONS_DIR/com.my-little-apps.dnsmasq.plist" 2>/dev/null || true
launchctl unload "$LAUNCH_DAEMONS_DIR/com.my-little-apps.caddy.plist" 2>/dev/null || true

# Remove LaunchDaemon plists
echo "Removing LaunchDaemon plists..."
rm -f "$LAUNCH_DAEMONS_DIR/com.my-little-apps.dnsmasq.plist"
rm -f "$LAUNCH_DAEMONS_DIR/com.my-little-apps.caddy.plist"

# Remove resolver file
echo "Removing DNS resolver..."
rm -f "/etc/resolver/$HOSTNAME.local"

# Remove binaries
echo "Removing binaries..."
rm -rf "$INSTALL_DIR"

# Remove config
echo "Removing configuration..."
rm -rf "$CONFIG_DIR"

# Remove logs
echo "Removing logs..."
rm -rf "$LOG_DIR"

# Flush DNS cache
echo "Flushing DNS cache..."
dscacheutil -flushcache
killall -HUP mDNSResponder 2>/dev/null || true

echo ""
echo "========================================"
echo "Uninstallation complete!"
echo "========================================"
echo ""
echo "The proxy service has been removed."
echo "Your apps will now only be accessible via localhost:<port>"
echo ""
