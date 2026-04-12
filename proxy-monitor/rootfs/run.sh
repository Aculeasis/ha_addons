#!/usr/bin/with-contenv bashio

CONFIG_DIR="/config"
CONFIG_FILE="${CONFIG_DIR}/config.yaml"

if ! bashio::fs.file_exists "${CONFIG_FILE}"; then
    bashio::log.info "Config file not found, copying example..."
    cp /usr/src/app/config.example "${CONFIG_FILE}"
fi

bashio::log.info "Starting Proxy Monitor..."
cd "${CONFIG_DIR}" || exit 1
exec python3 /usr/src/app/server.py --config "${CONFIG_FILE}"
