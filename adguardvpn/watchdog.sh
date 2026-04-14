#!/usr/bin/with-contenv bashio
# Watchdog for AdGuard VPN SOCKS5 proxy
# Monitors proxy health and restarts VPN if needed

#================================================================================
# CONFIGURATION
#================================================================================

CLI_PATH="/root/.local/share/adguardvpn-cli/adguardvpn-cli"

# Source shared connection module
source /app/connect.sh

#================================================================================
# CHECK FUNCTIONS
#================================================================================

check_proxy() {
    # Try to connect through SOCKS5 proxy
    # Returns 0 on success, 1 on failure

    local host="$1"
    local port="$2"
    local user="$3"
    local pass="$4"
    local test_host="$5"
    local test_port="$6"
    local timeout="${7:-10}"

    # Use curl to test SOCKS5 connection
    if curl -s -o /dev/null -w "" \
        -x "socks5h://${user}:${pass}@${host}:${port}" \
        --connect-timeout "$timeout" \
        "http://${test_host}:${test_port}/" 2>/dev/null; then
        return 0
    fi

    # Alternative: try HTTPS through proxy
    if curl -s -o /dev/null -w "" \
        -x "socks5h://${user}:${pass}@${host}:${port}" \
        --connect-timeout "$timeout" \
        "https://api.ipify.org" 2>/dev/null; then
        return 0
    fi

    return 1
}

#================================================================================
# MAIN LOOP
#================================================================================

main() {
    bashio::log.info "Starting Watchdog..."

    # Read configuration
    local socks_port=$(bashio::config 'adguard.socks_port')
    local socks_user=$(bashio::config 'auth.socks_user')
    local socks_pass=$(bashio::config 'auth.socks_pass')
    local interval=$(bashio::config 'watchdog.interval')
    local threshold=$(bashio::config 'watchdog.threshold')
    local pause=$(bashio::config 'watchdog.pause')
    local test_host=$(bashio::config 'watchdog.test_host')
    local test_port=$(bashio::config 'watchdog.test_port')

    # Set defaults if empty
    socks_port="${socks_port:-5004}"
    socks_user="${socks_user:-user}"
    socks_pass="${socks_pass:-user}"
    interval="${interval:-30}"
    threshold="${threshold:-6}"
    pause="${pause:-30}"
    test_host="${test_host:-1.1.1.1}"
    test_port="${test_port:-80}"

    bashio::log.info "Configuration:"
    bashio::log.info "  SOCKS Port: $socks_port"
    bashio::log.info "  Check Interval: ${interval}s"
    bashio::log.info "  Failure Threshold: $threshold"
    bashio::log.info "  Pause after restart: ${pause}m"
    bashio::log.info "  Test Host: ${test_host}:${test_port}"

    local failure_count=0

    bashio::log.info "Watchdog started. Monitoring SOCKS5 proxy on 127.0.0.1:$socks_port"

    while true; do
        # Check proxy
        if check_proxy "127.0.0.1" "$socks_port" "$socks_user" "$socks_pass" "$test_host" "$test_port"; then
            # Success
            if [ $failure_count -gt 0 ]; then
                bashio::log.info "Proxy recovered. Resetting failure count (was $failure_count)"
            fi
            failure_count=0
        else
            # Failure
            failure_count=$((failure_count + 1))
            bashio::log.error "Proxy check failed ($failure_count/$threshold)"

            # Check if threshold reached
            if [ $failure_count -ge $threshold ]; then
                bashio::log.error "Failure threshold reached! Restarting VPN..."

                # Use shared connect function with retry logic
                connect_vpn

                bashio::log.info "Pausing for ${pause} minutes to allow stabilization..."
                failure_count=0
                sleep $((pause * 60))
                bashio::log.info "Resuming monitoring"
                continue
            fi
        fi

        # Wait for next check
        sleep "$interval"
    done
}

#================================================================================
# SIGNAL HANDLERS
#================================================================================

cleanup() {
    bashio::log.info "Watchdog stopping..."
    exit 0
}

trap cleanup SIGTERM SIGINT

#================================================================================
# RUN
#================================================================================

main