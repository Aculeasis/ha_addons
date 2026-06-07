ARG BUILD_FROM
FROM $BUILD_FROM
LABEL org.opencontainers.image.source=https://github.com/Aculeasis/ha_addons

ARG BUILD_ARCH

RUN apk add --no-cache python3 py3-pip smartmontools

COPY requirements.txt /
RUN pip3 install --no-cache-dir --break-system-packages -r /requirements.txt

COPY rootfs /
COPY binaries/${BUILD_ARCH}/ /usr/bin/
RUN chmod a+x /usr/bin/esp-stat /usr/bin/esp_parse
