ARG BUILD_FROM
FROM $BUILD_FROM
LABEL org.opencontainers.image.source=https://github.com/Aculeasis/ha_addons

RUN apk add --no-cache bash curl && \
    apk add --no-cache --repository http://dl-cdn.alpinelinux.org/alpine/edge/testing shadowsocks-libev

COPY gost_install.sh /tmp/
RUN chmod a+x /tmp/gost_install.sh && \
    /tmp/gost_install.sh && \
    rm -f /tmp/gost_install.sh

COPY run.sh /etc/services.d/gost-ss/run
RUN chmod a+x /etc/services.d/gost-ss/run
