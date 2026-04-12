ARG BUILD_FROM
FROM $BUILD_FROM
LABEL org.opencontainers.image.source=https://github.com/Aculeasis/ha_addons

# Set shell
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Install dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    bash

WORKDIR /usr/src/app

# Copy requirements and install
COPY src/requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# Copy source code
COPY src /usr/src/app

# Copy rootfs
COPY rootfs /

# Set permissions
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
