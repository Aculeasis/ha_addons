ARG BUILD_FROM
FROM $BUILD_FROM
LABEL org.opencontainers.image.source=https://github.com/Aculeasis/ha_addons

ARG XRAY_VERSION="26.10.29"

RUN apk add --no-cache bash curl unzip

COPY xray_install.sh /tmp/
RUN chmod a+x /tmp/xray_install.sh && \
    /tmp/xray_install.sh "${XRAY_VERSION}" && \
    rm -f /tmp/xray_install.sh

COPY run.sh /etc/services.d/xray/run
RUN chmod a+x /etc/services.d/xray/run
