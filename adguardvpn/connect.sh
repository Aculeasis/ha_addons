#!/usr/bin/with-contenv bashio
# VPN connection management with retry logic
# Shared module for run.sh and watchdog.sh

#================================================================================
# CONFIGURATION
#================================================================================

CLI_PATH="/root/.local/share/adguardvpn-cli/adguardvpn-cli"

# Retry configuration
MIN_DELAY=10
MAX_DELAY=300
DELAY_INCREMENT=10

#================================================================================
# CONNECTION FUNCTIONS
#================================================================================

# Check if VPN connection was successful based on output
# Returns 0 if connected, 1 if failed
check_connection_success() {
    local output="$1"

    # Check for success indicator
    if echo "$output" | grep -q "Successfully Connected to"; then
        return 0
    fi

    # If we see "You are now connected", that's success
    if echo "$output" | grep -q "You are now connected"; then
        return 0
    fi

    # Check for failure indicators
    if echo "$output" | grep -q "Failed to start the VPN service"; then
        return 1
    fi

    if echo "$output" | grep -q "Disconnected"; then
        return 1
    fi

    # Default to failure if we can't determine status
    return 1
}

# Connect to VPN with infinite retry logic
# Reads configuration from bashio config
# Never returns - keeps retrying until successful
connect_vpn() {
    # Read configuration
    local location=$(bashio::config 'location')
    local show_progress=$(bashio::config 'adguard.show_connect_progress')

    # Build connect arguments
    local progress_flag=""
    [ "$show_progress" != "true" ] && progress_flag="--no-progress"

    local connect_args
    if [ -z "$location" ] || [ "$location" = "fastest" ]; then
        connect_args="-f $progress_flag"
        bashio::log.info "Connecting to fastest location..."
    else
        connect_args="-l \"$location\" $progress_flag"
        bashio::log.info "Connecting to location: $location"
    fi

    local current_delay=$MIN_DELAY
    local attempt=1

    # Disconnect first to ensure clean state
    $CLI_PATH disconnect </dev/null >/dev/null 2>&1 || true
    while true; do
        bashio::log.info "Connection attempt #$attempt..."

        # Use yes to automatically answer "no" to interactive prompts on first run
        local connect_output
        connect_output=$(yes "no" | eval "$CLI_PATH connect $connect_args" 2>&1) || true

        # Log connect output line by line
        echo "$connect_output" | while IFS= read -r line; do
            [ -n "$line" ] && bashio::log.info "$line"
        done

        # Check if connection was successful
        if check_connection_success "$connect_output"; then
            bashio::log.info "VPN connected successfully!"

            # Wait a moment for tunnel to stabilize
            sleep 3

            # Verify connection status
            local status
            status=$($CLI_PATH status </dev/null 2>/dev/null | head -1 || echo "Unknown")
            bashio::log.notice "VPN Status: $status"

            # Detect external IP through SOCKS proxy
            local socks_port=$(bashio::config 'adguard.socks_port')
            local socks_user=$(bashio::config 'auth.socks_user')
            local socks_pass=$(bashio::config 'auth.socks_pass')
            local external_ip

            for i in 1 2 3; do
                external_ip=$(curl -s --connect-timeout 10 \
                    -x "socks5h://$socks_user:$socks_pass@127.0.0.1:$socks_port" \
                    "https://ifconfig.me/ip" 2>/dev/null)
                [ -n "$external_ip" ] && [ "$external_ip" != "unknown" ] && break
                bashio::log.info "Waiting for VPN tunnel... (attempt $i)"
                sleep 3
            done
            [ -z "$external_ip" ] && external_ip="unknown"

            bashio::log.notice "External IP: $external_ip"

            return 0
        fi

        # Connection failed - log and retry
        bashio::log.error "Connection attempt #$attempt failed"
        bashio::log.warning "Retrying in $current_delay seconds..."

        sleep $current_delay

        # Increase delay for next attempt (with max limit)
        current_delay=$((current_delay + DELAY_INCREMENT))
        if [ $current_delay -gt $MAX_DELAY ]; then
            current_delay=$MAX_DELAY
        fi

        attempt=$((attempt + 1))
    done
}