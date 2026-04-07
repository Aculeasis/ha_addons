ARG BUILD_FROM
FROM $BUILD_FROM
LABEL org.opencontainers.image.source=https://github.com/Aculeasis/ha_addons

RUN apk add --no-cache python3 py3-pip smartmontools jq

COPY run.sh /etc/services.d/remote-smart/run
COPY requirements.txt /
COPY smart.py utils.py mqtt_adapters.py main.py /usr/bin/

RUN pip3 install --no-cache-dir --break-system-packages -r /requirements.txt

RUN chmod a+x /etc/services.d/remote-smart/run
