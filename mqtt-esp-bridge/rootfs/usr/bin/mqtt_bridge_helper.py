#!/usr/bin/python3

import json
import time
import os
from typing import Optional

import esp_data
import smart
import utils
from base import Worker, MQTTManager

MQTT = {
    'ip': os.getenv('MQTT_HOST'),
    'port': int(os.getenv('MQTT_PORT')),
    'username': os.getenv('MQTT_USERNAME'),
    'password': os.getenv('MQTT_PASSWORD'),
}


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



class Discovery(Worker):
    SUBSCRIBE = 'homeassistant/status'
    UPDATE_INTERVAL = 60 * 30
    NAME = 'DiscoverySSD'

    def __init__(self):
        super().__init__()
        self._data = [esp_data.ssd_one()]

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
    data = [Discovery(), SSD(), SwitchHelper()]
    mqtt_manager = MQTTManager(credentials=MQTT, workers=data)
    mqtt_manager.start()
    sig.sleep(None)
    print('MAIN: stopping...')
    mqtt_manager.join()
    print('MAIN: bye.')


if __name__ == '__main__':
    main()
