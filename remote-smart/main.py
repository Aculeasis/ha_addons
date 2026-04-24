#!/usr/bin/python3
import hashlib
import threading
import uuid
import argparse

import paho.mqtt.client as mqtt

import mqtt_adapters
import utils
from smart import get_smart


class RemoteSMART(threading.Thread):
    HA_STATUS_TOPIC = 'homeassistant/status'

    def __init__(self, config_file: str = 'config_local.yaml'):
        super().__init__()
        uid = f'remote_smart_{hashlib.md5(uuid.UUID(int=uuid.getnode(), version=3).bytes).hexdigest()}'
        self.cfg = utils.read_config(config_file)
        self.wait = threading.Event()
        self.work = False
        self.conn = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2, client_id=uid, clean_session=False
        )
        self.conn.username_pw_set(username=self.cfg['mqtt']['username'], password=self.cfg['mqtt']['password'])
        self.conn.reconnect_delay_set(max_delay=600)
        self.conn.on_connect = self._on_connect
        self.conn.on_message = self._on_message
        self.conn.on_disconnect = self._on_disconnect

    def start(self) -> None:
        self.work = True
        super().start()

    def join(self, timeout=30) -> None:
        if self.work:
            self._send_availability(online=False)
            self.work = False
            self.wait.set()
            self.conn.loop_stop()
            self.conn.disconnect()
            super().join(timeout)

    def _on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code > 0:
            print(f"on_connect error: {reason_code}")
            return
        print('MQTT connected')
        self.conn.subscribe(self.HA_STATUS_TOPIC)
        self._send_init()

    def _on_message(self, _, __, message: mqtt.MQTTMessage):
        try:
            if message.topic == self.HA_STATUS_TOPIC:
                status = message.payload.decode('utf-8')
                print(f'Home Assistant: {status}')
                if status == 'online':
                    self._send_init()
        except Exception as e:
            print(f'on_message error: {e}')

    def _on_disconnect(self, client, userdata, flags, reason_code, properties):
        if reason_code > 0:
            print(f'MQTT Disconnected, reconnecting. rc: {reason_code}')
            wait = 15
            while self.work:
                try:
                    self.conn.reconnect()
                    break
                except (ConnectionError, OSError) as e:
                    print(f'reconnect error: {e}')
                if wait < 1800:
                    wait *= 2
                self.wait.wait(wait)

    def _send_init(self):
        self._send_discovery()
        self._send_availability(online=True)
        self._send_data(is_init=True)

    def _send_discovery(self):
        for topic, data in mqtt_adapters.discovery(self.cfg['devices']):
            self.conn.publish(topic, data, qos=1)

    def _send_data(self, is_init=False):
        for device, value in self.cfg['devices'].items():
            for topic, data in mqtt_adapters.publish(
                    *get_smart(value['dev'], value.get('cmd'), self.cfg['missing_attribute']), value
            ):
                self.conn.publish(topic, data, qos=int(is_init), retain=is_init)

    def _send_availability(self, online):
        for topic, data in mqtt_adapters.availability(self.cfg['devices'], online):
            self.conn.publish(topic, data, retain=True, qos=1)

    def run(self) -> None:
        wait = 15
        while self.work:
            if wait:
                try:
                    self.conn.connect(host=self.cfg['mqtt']['host'], port=self.cfg['mqtt']['port'])
                except Exception as e:
                    print(f'Connecting error: {e}')
                    if wait < 1800:
                        wait *= 2
                    self.wait.wait(wait)
                else:
                    self.conn.loop_start()
                    wait = False
            else:
                if wait is False:
                    wait = None
                else:
                    self._send_data()
                self.wait.wait(self.cfg['update_interval'])


def main():
    print('MAIN: Start...')
    parser = argparse.ArgumentParser(description='Remote SMART Home Assistant MQTT bridge')
    parser.add_argument('--config', type=str, default='config_local.yaml',
                        help='Path to the configuration file (default: config_local.yaml)')
    args = parser.parse_args()

    sig = utils.SignalHandler()
    worker = RemoteSMART(config_file=args.config)
    worker.start()
    sig.sleep(None)
    print('MAIN: stopping...')
    worker.join()
    print('MAIN: bye.')


if __name__ == '__main__':
    main()
