ARG BUILD_FROM
FROM $BUILD_FROM
LABEL org.opencontainers.image.source=https://github.com/Aculeasis/ha_addons

# Install dependencies
RUN apk add --no-cache \
    curl \
    ca-certificates \
    coreutils \
    procps \
    bash

RUN mkdir -p /root/.local/share/adguardvpn-cli

# Create working directory
WORKDIR /app

# Copy scripts
COPY run.sh /app/run.sh
COPY install.sh /app/install.sh
COPY watchdog.sh /app/watchdog.sh
COPY connect.sh /app/connect.sh

# Make scripts executable
RUN chmod +x /app/run.sh /app/install.sh /app/watchdog.sh /app/connect.sh

# Entrypoint
CMD [ "/app/run.sh" ]