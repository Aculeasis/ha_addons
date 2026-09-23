ARG BUILD_FROM
FROM node:24-alpine AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

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
COPY --from=frontend-build /build/src/web /usr/src/app/web

# Copy rootfs
COPY rootfs /

# Set permissions
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
