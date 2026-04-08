ARG BUILD_FROM
FROM $BUILD_FROM
LABEL org.opencontainers.image.source=https://github.com/Aculeasis/ha_addons

RUN apk add --no-cache bash privoxy

COPY run.sh /etc/services.d/privoxy/run
RUN chmod a+x /etc/services.d/privoxy/run
