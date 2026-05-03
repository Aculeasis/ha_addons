#!/usr/bin/with-contenv bashio
# Main entry point for AdGuard VPN Home Assistant Add-on
set -e

#================================================================================
# CONFIGURATION
#================================================================================

# Paths
CLI_PATH="/root/.local/share/adguardvpn-cli/adguardvpn-cli"
DATA_DIR="/root/.local/share/adguardvpn-cli"

# Source shared connection module
source /app/connect.sh

#================================================================================
# HELPER FUNCTIONS
#================================================================================

# Check if adguardvpn-cli is properly logged in
check_logged_in() {
    # 'license' shows "Logged in as ..." when logged in
    local license_output
    license_output=$($CLI_PATH license </dev/null 2>&1 || true)
    if echo "$license_output" | grep -qi "logged in"; then
        return 0
    fi
    return 1
}

#================================================================================
# INSTALLATION
#================================================================================

ensure_installed() {
    if [ ! -f "$CLI_PATH" ]; then
        bashio::log.info "AdGuard VPN CLI not found. Installing..."
        /app/install.sh
    else
        chmod +x "$CLI_PATH" 2>/dev/null || true
        bashio::log.info "AdGuard VPN CLI found: $CLI_PATH"
    fi
}

#================================================================================
# CONFIGURATION
#================================================================================

apply_config() {
    local socks_port=$(bashio::config 'adguard.socks_port')
    local socks_user=$(bashio::config 'auth.socks_user')
    local socks_pass=$(bashio::config 'auth.socks_pass')
    local crash_reports=$(bashio::config 'adguard.crash_reports')
    local telemetry=$(bashio::config 'adguard.telemetry')
    local log_max_size=$(bashio::config 'adguard.log_max_size')

    # Set mode to SOCKS
    $CLI_PATH config set-mode socks </dev/null >/dev/null 2>&1 || true

    # Set SOCKS port
    $CLI_PATH config set-socks-port "$socks_port" </dev/null >/dev/null 2>&1 || true

    # Set SOCKS host with authentication (required for binding to 0.0.0.0)
    $CLI_PATH config set-socks-host 0.0.0.0 -u "$socks_user" -p "$socks_pass" </dev/null >/dev/null 2>&1 || true

    # Set DNS to default
    $CLI_PATH config set-dns default </dev/null >/dev/null 2>&1 || true

    # Set change system DNS servers
    $CLI_PATH config set-change-system-dns off </dev/null >/dev/null 2>&1 || true

    # Set VPN tunnel routing mode
    $CLI_PATH config set-tun-routing-mode none </dev/null >/dev/null 2>&1 || true

    # Set crash reporting
    local crash_value="off"
    [ "$crash_reports" = "true" ] && crash_value="on"
    $CLI_PATH config set-crash-reporting "$crash_value" </dev/null >/dev/null 2>&1 || true

    # Set telemetry
    local telemetry_value="off"
    [ "$telemetry" = "true" ] && telemetry_value="on"
    $CLI_PATH config set-telemetry "$telemetry_value" </dev/null >/dev/null 2>&1 || true

    # Clean up old rotated log files
    rm -f "$DATA_DIR"/app.log.* 2>/dev/null || true
    rm -f "$DATA_DIR"/tunnel.log.* 2>/dev/null || true

    # Truncate app.log if too large
    local app_log="$DATA_DIR/app.log"
    if [ -f "$app_log" ]; then
        local log_size_kb
        log_size_kb=$(du -k "$app_log" 2>/dev/null | cut -f1)
        if [ "$log_size_kb" -gt "$log_max_size" ] 2>/dev/null; then
            bashio::log.info "Truncating app.log from ${log_size_kb}KB to ${log_max_size}KB"
            truncate -s "${log_max_size}K" "$app_log" 2>/dev/null || true
        fi
    fi

    # Truncate tunnel.log if too large
    local tunnel_log="$DATA_DIR/tunnel.log"
    if [ -f "$tunnel_log" ]; then
        local tunnel_log_size_kb
        tunnel_log_size_kb=$(du -k "$tunnel_log" 2>/dev/null | cut -f1)
        if [ "$tunnel_log_size_kb" -gt "$log_max_size" ] 2>/dev/null; then
            bashio::log.info "Truncating tunnel.log from ${tunnel_log_size_kb}KB to ${log_max_size}KB"
            truncate -s "${log_max_size}K" "$tunnel_log" 2>/dev/null || true
        fi
    fi

    bashio::log.info "Configuration applied successfully"
}

#================================================================================
# MODE HANDLERS
#================================================================================

handle_reinstall() {
    bashio::log.info "Reinstalling AdGuard VPN CLI..."

    # Remove existing binary
    rm -f "$CLI_PATH" 2>/dev/null || true

    # Run installation
    /app/install.sh

    bashio::log.notice "Reinstallation complete. Set mode to 'normal' and restart."
}

handle_login() {
    bashio::log.info "Starting login process..."

    local adguard_user=$(bashio::config 'auth.adguard_user')
    local adguard_pass=$(bashio::config 'auth.adguard_pass')

    # Check if already logged in
    if check_logged_in; then
        bashio::log.info "Already logged in. Logging out first..."
        return 0
    fi

    # Method 1: Try username/password login if provided
    if [ -n "$adguard_user" ] && [ -n "$adguard_pass" ]; then
        bashio::log.info "Attempting login with username/password..."
        local login_output
        login_output=$($CLI_PATH login -u "$adguard_user" -p "$adguard_pass" 2>&1) || true

        if check_logged_in; then
            bashio::log.notice "Login successful via username/password!"
            local license_info
            license_info=$($CLI_PATH license 2>&1) || true
            echo "$license_info" | while IFS= read -r lline; do
                [ -n "$lline" ] && bashio::log.notice "$lline"
            done
            return 0
        else
            bashio::log.error "Username/password login failed. Output: $login_output"
            bashio::log.info "Falling back to browser login..."
        fi
    fi

    # Method 2: Browser login
    bashio::log.info "Starting browser-based login..."

    # Create temporary file for login output
    local login_fifo="/tmp/login_output_$$"
    mkfifo "$login_fifo" 2>/dev/null || true

    # Start login in background, capturing output
    $CLI_PATH login > "$login_fifo" 2>&1 &

    # Read output, filter noise, extract URL
    local auth_url=""
    local timeout=1800
    local elapsed=0
    local check_interval=10

    while [ $elapsed -lt $timeout ]; do
        # Try to read a line (with timeout)
        if read -t $check_interval line < "$login_fifo" 2>/dev/null; then
            # Extract URL from output (only if not already found)
            if [ -z "$auth_url" ] && echo "$line" | grep -q "https://"; then
                auth_url=$(echo "$line" | grep -oE 'https://[^ ]+')
                if [ -n "$auth_url" ]; then
                    bashio::log.notice "BROWSER LOGIN REQUIRED — open this link: $auth_url"
                fi
            fi
            # Check for successful login in output - return immediately
            if echo "$line" | grep -qi "logged in"; then
                bashio::log.notice "LOGIN SUCCESSFUL!"
                # Show license info through bashio notices
                local license_info
                license_info=$($CLI_PATH license 2>&1) || true
                echo "$license_info" | while IFS= read -r lline; do
                    [ -n "$lline" ] && bashio::log.notice "$lline"
                done
                rm -f "$login_fifo"
                return 0
            fi
        fi

        elapsed=$((elapsed + check_interval))
    done

    # Timeout reached
    bashio::log.error "Login timed out after $timeout seconds"
    rm -f "$login_fifo"
    return 1
}

handle_logout() {
    bashio::log.info "Logging out..."
    $CLI_PATH logout </dev/null >/dev/null 2>&1 || true
    bashio::log.notice "Logged out successfully. Set mode to 'login' to authenticate again."
}

handle_locations() {
    bashio::log.notice "Available VPN locations:"
    local locations_output
    locations_output=$($CLI_PATH list-locations 2>&1) || true
    echo "$locations_output" | while IFS= read -r line; do
        [ -n "$line" ] && bashio::log.notice "$line"
    done
}

handle_normal() {
    bashio::log.info "Starting normal mode..."

    # Check if logged in
    if ! check_logged_in; then
        bashio::log.error "Not logged in. Please set mode to 'login' first."
        bashio::log.info "Waiting..."
        exec sleep infinity
    fi

    # Connect VPN with retry logic
    connect_vpn

    # Check if watchdog is enabled
    local watchdog_enabled=$(bashio::config 'watchdog.enabled')
    if [ "$watchdog_enabled" = "true" ]; then
        exec /app/watchdog.sh
    else
        bashio::log.info "Watchdog disabled. VPN running as daemon."
        exec sleep infinity
    fi
}

#================================================================================
# SIGNAL HANDLERS
#================================================================================

cleanup() {
    bashio::log.info "Received shutdown signal. Stopping VPN..."
    $CLI_PATH disconnect </dev/null >/dev/null 2>&1 || true
    exit 0
}

trap cleanup SIGTERM SIGINT

#================================================================================
# MAIN
#================================================================================

main() {
    bashio::log.info "AdGuard VPN Add-on starting..."

    local mode=$(bashio::config 'mode')
    local location=$(bashio::config 'location')
    bashio::log.info "Mode: $mode"

    # Debug mode - exit early, do nothing
    if [ "$location" = "ah shit" ]; then
        bashio::log.info "Debug mode activated - here we go again..."
        exec sleep infinity
        exit 1
    fi

    ensure_installed

    apply_config

    local cli_version
    cli_version=$($CLI_PATH -v 2>/dev/null | head -1) || cli_version="unknown"
    bashio::log.info "CLI Version: $cli_version"

    # Handle different modes
    case "$mode" in
        reinstall)
            handle_reinstall
            ;;
        login)
            handle_login
            ;;
        logout)
            handle_logout
            ;;
        locations)
            handle_locations
            ;;
        normal)
            handle_normal
            ;;
        *)
            bashio::log.error "Unknown mode: $mode"
            bashio::log.info "Valid modes: normal, login, logout, locations, reinstall"
            exit 1
            ;;
    esac
}

# Run main
main