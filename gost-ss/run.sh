#!/usr/bin/with-contenv bashio

# Array to store background process PIDs
PIDS=""

# Function to handle graceful shutdown
shutdown_processes() {
    bashio::log.info "Caught signal, stopping processes..."
    for pid in $PIDS; do
        bashio::log.info "Stopping process with PID $pid..."
        kill -TERM $pid 2>/dev/null
    done
    bashio::log.info "bye"
    exit 0
}

# Trap SIGTERM and SIGINT for graceful shutdown
trap "shutdown_processes" SIGTERM SIGHUP SIGINT

DELAY=$(bashio::config 'delay' || echo 0)
if [ "$DELAY" -gt 0 ] 2>/dev/null; then
    bashio::log.info "Delaying startup by ${DELAY} seconds..."
    sleep "$DELAY" &
    wait $!
fi

bashio::log.info "Starting shadowsocks instances..."

# Iterate through all .json files in /config
for config_file in /config/*.json; do
    if [ -f "$config_file" ]; then
        # Extract TYPE and NAME from filename (e.g., local-example.json -> TYPE=local, NAME=example)
        filename=$(basename "$config_file")
        base="${filename%.*}" # Remove extension
        TYPE=$(echo "$base" | cut -d'-' -f1)
        NAME=$(echo "$base" | cut -d'-' -f2-) # Get the rest as NAME

        # Validate TYPE value
        case "$TYPE" in
            local|server|redir|tunnel) ;;
            *)
                bashio::log.error "Unknown type '$TYPE' in filename '$filename'. Allowed: local, server, redir, tunnel. Skipping."
                continue
                ;;
        esac

        bashio::log.info "Launching SS instance: TYPE=$TYPE, NAME=$NAME with config $config_file"

        # Launch the shadowsocks process in the background
        # Use process substitution so $! captures the ss-* PID, not awk
        ss-$TYPE -c "$config_file" > >(awk -v name="[$NAME]" '{ print name $0 }') 2>&1 &

        # Store the PID of the background process
        PIDS="$PIDS $!"
    fi
done

bashio::log.info "Starting gost instances..."

# Iterate through all .yaml/.yml files in /config
for config_file in /config/*.yaml /config/*.yml; do
    if [ -f "$config_file" ]; then
        filename=$(basename "$config_file")
        NAME="${filename%.*}" # Remove extension

        bashio::log.info "Launching gost instance: NAME=$NAME with config $config_file"

        # Launch the gost process in the background
        gost -C "$config_file" > >(awk -v name="[$NAME]" '{ print name $0 }') 2>&1 &

        # Store the PID of the background process
        PIDS="$PIDS $!"
    fi
done

if [ -z "$PIDS" ]; then
    # Path below is the host-side location shown to the user, not the container mount
    bashio::log.warning "No configuration files found in /addon_configs/89e82855_gost-ss. Do nothing."
fi

# Wait for signals (keeps the script running)
wait