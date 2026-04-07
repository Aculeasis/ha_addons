#!/usr/bin/python3

import json
import socket
import time
import os
from typing import Optional

import esp_data
import smart
import utils
from base import Worker, MQTTManager

ESP_LIST = ['DF0E7E', 'DF0FE4', 'B9BA8A']
LF = b'\n'
ESP_STAT_ADDR = ('127.0.0.1', 8801)
MQTT = {
    'ip': os.getenv('MQTT_HOST'),
    'port': int(os.getenv('MQTT_PORT')),
    'username': os.getenv('MQTT_USERNAME'),
    'password': os.getenv('MQTT_PASSWORD'),
}


def esp_parse(data: str):
    if data.startswith('-1'):
        return None
    return json.loads(data)


def vcc_to_battery(vcc: str) -> int:
    vcc = float(vcc)
    max_battery = 4.2
    min_battery = 3.0
    battery = int(((vcc - min_battery) / (max_battery - min_battery)) * 100)
    return max(min(battery, 100), 0)


def read_esp_data(esp_id: str) -> str:
    return _read_base(ESP_STAT_ADDR, f"{esp_id} json")


def _read_base(address: tuple, cmd: str, buff_size=4096) -> Optional[str]:
    soc = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    soc.settimeout(3)
    soc.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    try:
        soc.connect(address)
        soc.sendall(cmd.encode() + LF)
        return soc.recv(buff_size).decode()
    finally:
        soc.close()


class SwitchHelper(Worker):
    SUBSCRIBE = 'zigbee2mqtt/Wall Switch 4buttons Office/action'
    UPDATE_INTERVAL = 0.8
    NAME = 'SwitchHelper'

    MQTT_OUT = 'zigbee2mqtt/Wall Switch 4buttons Office/action4'
    BUTTONS = ('1', '2')
    MIN_CLICKS = 1
    MAX_CLICKS = 2

    def __init__(self):
        super().__init__()
        self._buffer = dict()

    def _has_connected(self):
        self._buffer = dict()

    def _check_buffer(self):
        if self.MIN_CLICKS <= len(self._buffer) <= self.MAX_CLICKS:
            self._mqtt_send_data(self.MQTT_OUT, ''.join([self._buffer.get(i, '-') for i in range(1, 5)]))
        self._buffer = dict()

    def _loop(self, topic: str or None, msg: str or None):
        if self._buffer and msg is None:
            self._check_buffer()
        elif msg:
            if len(msg) > 2 and msg[1] == '_' and msg[2] in ('s', 'h', 'd'):
                if msg[0] in self.BUTTONS:
                    pos = int(msg[0])
                    if pos not in self._buffer:
                        self._buffer[pos] = msg[2].capitalize()
            if len(self._buffer) >= self.MAX_CLICKS:
                self._check_buffer()


class ESP(Worker):
    SUBSCRIBE = 'homeassistant/status'
    RUN_DELAY = 10
    UPDATE_INTERVAL = 60 * 5
    NAME = 'ESP'

    def __init__(self):
        super().__init__()
        self._ESP = {esp: esp_data.discovery_adapter(esp, avty_t=True) for esp in ESP_LIST}

    def _has_connected(self):
        availabilities = {}
        for esp_id, data in self._ESP.items():
            stage = 'read_esp_data'
            result = None
            try:
                result = read_esp_data(esp_id)
                stage = 'esp_parse'
                result = esp_parse(result)
                stage = 'vcc_to_voltage'
                if result is not None:
                    result['voltage'] = result['vcc']
                stage = 'vcc_to_battery'
                if result is not None:
                    result['battery'] = vcc_to_battery(result['vcc'])
            except Exception as e:
                self._log(f"Something went wrong with {esp_id}, stage:'{stage}': {e}")
                self._log(f"result={result}")
                for sensor in data.values():
                    if 'avty_t' in sensor:
                        availabilities[sensor['avty_t']] = 'offline'
                continue
            for dev_t, sensor in data.items():
                if 'avty_t' in sensor:
                    availabilities[sensor['avty_t']] = 'offline' if result is None else 'online'
                if result is None:
                    break
                try:
                    stage = f"yielding->{dev_t}"
                    stage = f"{stage}->{sensor['dev_cla']}"
                except Exception as e:
                    self._log(f"Something went wrong, stage:'{stage}': {e}")
                else:
                    self._mqtt_send_data(sensor['stat_t'], str(result[sensor['dev_cla']]))
        for topic, status in availabilities.items():
            self._mqtt_send_data(topic, status)

    def _loop(self, topic: Optional[str], msg: Optional[str]):
        if msg:
            if msg != 'online':
                return
            else:
                time.sleep(self.RUN_DELAY)
        self._has_connected()


class Discovery(Worker):
    SUBSCRIBE = 'homeassistant/status'
    UPDATE_INTERVAL = 60 * 30
    NAME = 'DiscoverySSD'

    def __init__(self):
        super().__init__()
        self._data = [esp_data.discovery_adapter(esp, avty_t=True) for esp in ESP_LIST]
        self._data.append(esp_data.ssd_one())

    def _has_connected(self):
        for target in self._data:
            for topic, data in target.items():
                self._mqtt_send_data(topic, json.dumps(data, ensure_ascii=False))

    def _loop(self, topic: Optional[str], msg: Optional[str]):
        if msg is not None:
            self._log(f"Home Assistant {msg}")
            if msg != 'online':
                return
        self._has_connected()


class SSD(Worker):
    SUBSCRIBE = 'homeassistant/status'
    RUN_DELAY = 10
    UPDATE_INTERVAL = 60 * 2
    NAME = 'SSD'

    def __init__(self):
        super().__init__()
        self._ssd_topic = ''
        for v in esp_data.ssd_one().values():
            self._ssd_topic = v.get('stat_t', '')
            break

    def _has_connected(self):
        if self._ssd_topic:
            stage = 'read_smart'
            try:
                data = smart.get_smart()
                stage = 'yielding_ssd_data'
            except Exception as e:
                self._log('Something went wrong, stage:"{}": {}'.format(stage, e))
            else:
                self._mqtt_send_data(self._ssd_topic, json.dumps(data, ensure_ascii=False))

    def _loop(self, topic: Optional[str], msg: Optional[str]):
        if msg:
            if msg != 'online':
                return
            else:
                time.sleep(self.RUN_DELAY)
        self._has_connected()


def main():
    print('MAIN: Start...')
    sig = utils.SignalHandler()
    data = [Discovery(), ESP(), SSD(), SwitchHelper()]
    mqtt_manager = MQTTManager(credentials=MQTT, workers=data)
    mqtt_manager.start()
    sig.sleep(None)
    print('MAIN: stopping...')
    mqtt_manager.join()
    print('MAIN: bye.')


if __name__ == '__main__':
    main()
