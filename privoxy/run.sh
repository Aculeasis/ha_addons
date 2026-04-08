#!/usr/bin/with-contenv bashio

CONFIG_DIR="/config"
PRIVOXY_DEFAULT_DIR="/etc/privoxy"

if [ -z "$(ls -A "$CONFIG_DIR" 2>/dev/null)" ]; then
    bashio::log.info "Config directory is empty, copying default Privoxy configuration..."
    cp -r "$PRIVOXY_DEFAULT_DIR"/* "$CONFIG_DIR/"
    # Rename .new files to remove the suffix
    for f in "$CONFIG_DIR"/*.new; do
        [ -f "$f" ] && mv "$f" "${f%.new}"
    done
    # Change listen-address from 127.0.0.1 to 0.0.0.0 so the proxy is accessible from the host
    sed -i 's/^listen-address.*127\.0\.0\.1/listen-address  0.0.0.0/' "$CONFIG_DIR/config"
    bashio::log.info "Default configuration copied to $CONFIG_DIR"
    bashio::log.info "You can customize it in /addon_configs/89e82855_privoxy/"
fi

bashio::log.info "Starting Privoxy with config: $CONFIG_DIR/config"

exec privoxy --no-daemon "$CONFIG_DIR/config"
