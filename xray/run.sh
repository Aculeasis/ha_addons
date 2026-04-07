#!/usr/bin/with-contenv bashio

CONFIG_FILE="/config/config.json"



if [ ! -f "$CONFIG_FILE" ]; then
    bashio::log.warning "No config.json found at $CONFIG_FILE"
    # Path below is the host-side location shown to the user, not the container mount
    bashio::log.warning "Please place your config.json in /addon_configs/89e82855_xray/"
    bashio::log.warning "Waiting for config file..."
    # Keep running so the user can see the log message and knows what to do
    while [ ! -f "$CONFIG_FILE" ]; do
        sleep 10
    done
    bashio::log.info "Config file appeared, starting Xray..."
fi

bashio::log.info "Starting Xray with config: $CONFIG_FILE"

export XRAY_LOCATION_ASSET="/usr/local/share/xray"

# Run xray with the config file in the foreground (replaces shell process)
exec xray run -config "$CONFIG_FILE"
