#!/usr/bin/with-contenv bashio

MQTT_AUTO=$(bashio::config 'mqtt_auto')

if [ "${MQTT_AUTO}" = true ]; then
    bashio::log.info "MQTT auto enabled."

    # Check if MQTT service is available
    if bashio::services.available "mqtt"; then
        bashio::log.info "MQTT service found, fetching credentials ..."
        MQTT_HOST=$(bashio::services mqtt "host")
        MQTT_USERNAME=$(bashio::services mqtt "username")
        MQTT_PASSWORD=$(bashio::services mqtt "password")
        MQTT_PORT=$(bashio::services mqtt "port")

        # Construct JSON string
        JSON_CONTENT='{
            "mqtt_host": "'"${MQTT_HOST}"'",
            "mqtt_username": "'"${MQTT_USERNAME}"'",
            "mqtt_password": "'"${MQTT_PASSWORD}"'",
            "mqtt_port": "'"${MQTT_PORT}"'"
        }'
        # Write JSON to file
        echo "${JSON_CONTENT}" > /data/secret.json
    else
        bashio::log.warning "No internal MQTT service found."
        # Attempt to read from /data/secret.json if service is not available
        if [ -f "/data/secret.json" ]; then
            bashio::log.info "Reading MQTT settings from /data/secret.json"
            # Using jq to parse JSON - assuming jq is available in the environment
            MQTT_HOST=$(jq -r '.mqtt_host' /data/secret.json)
            MQTT_USERNAME=$(jq -r '.mqtt_username' /data/secret.json)
            MQTT_PASSWORD=$(jq -r '.mqtt_password' /data/secret.json)
            MQTT_PORT=$(jq -r '.mqtt_port' /data/secret.json)
        else
            bashio::log.warning "/data/secret.json not found. Cannot read previous MQTT settings."
        fi
    fi
else
    bashio::log.info "MQTT auto disabled, reading from config"
    MQTT_HOST=$(bashio::config 'mqtt.host')
    MQTT_USERNAME=$(bashio::config 'mqtt.username')
    MQTT_PASSWORD=$(bashio::config 'mqtt.password')
    MQTT_PORT=$(bashio::config 'mqtt.port')
fi

UPDATE_INTERVAL=$(bashio::config 'update_interval')

echo "Starting Python script..."
echo "MQTT: ${MQTT_HOST}:${MQTT_PORT} username: ${MQTT_USERNAME}"
echo "Update interval: ${UPDATE_INTERVAL}"

export MQTT_HOST
export MQTT_USERNAME
export MQTT_PASSWORD
export MQTT_PORT

exec python3 -u /usr/bin/main.py --config /data/options.json
