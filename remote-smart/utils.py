import signal
import threading
import time
import os
from datetime import datetime

import yaml
import json

MQTT = {
    'host': os.getenv('MQTT_HOST'),
    'port': int(os.getenv('MQTT_PORT', '0')),
    'username': os.getenv('MQTT_USERNAME'),
    'password': os.getenv('MQTT_PASSWORD'),
}


def read_config(file: str) -> dict:
    with open(file, 'r', encoding="UTF-8") as f:
        if file.endswith('.yaml') or file.endswith('.yml'):
            data = yaml.safe_load(f)
        elif file.endswith('.json'):
            data = json.load(f)
        else:
            raise ValueError(f"Unsupported file extension for config file: {file}")

    # convert list -> dict, for addon
    if isinstance(data['devices'], list):
        devices = {}
        for l in data['devices']:
            if device:= l.pop('device', None):
                # str -> list, for addon and we can't use space in command :(
                if isinstance(cmd:=l.get('cmd'), str) and cmd:
                    l['cmd'] = cmd.split(' ')
                devices[device] = l
        data['devices'] = devices

    ids = set()
    for key, value in data['devices'].items():
        if 'id' not in value:
            raise RuntimeError(f'Device `{key}` has no id')
        if not isinstance(cmd:=value.get('cmd'), (type(None), list)):
            raise RuntimeError(f'cmd has to be list or none, get {type(cmd)} for {key}')
        if value['id'] in ids:
            raise RuntimeError(f'ID: `{value["id"]}` duplicated. ID MUST BE unique')
        ids.add(value['id'])
    return inject_env(data)


def inject_env(data: dict) -> dict:
    if MQTT['host']:
        for k, v in MQTT.items():
            data['mqtt'][k] = v or data['mqtt'].get(k, v)
    return data


class SignalHandler:
    def __init__(self, signals=(signal.SIGINT, signal.SIGTERM)):
        super().__init__()
        self._sleep = threading.Event()
        self._death_time = 0
        self._wakeup = None
        _ = [signal.signal(signal_, self._signal_handler) for signal_ in signals]

    def _signal_handler(self, _, __):
        self._sleep.set()

    def set_wakeup_callback(self, wakeup):
        self._wakeup = wakeup

    def die_in(self, sec: int):
        self._death_time = sec
        self._sleep.set()

    def interrupted(self) -> bool:
        return self._sleep.is_set()

    def sleep(self, sleep_time):
        self._sleep.wait(sleep_time)
        if self._wakeup:
            self._wakeup()
        if self._death_time:
            time.sleep(self._death_time)


def pretty_size(size: int, divider: int = 1000) -> str:
    def pretty_round(size_: float) -> float | int:
        return round(size_, 2) if size_ % 1 >= 0.1 else int(size_)

    units = ["Bytes", "KB", "MB", "GB", "TB"]
    for unit in units:
        if size < divider:
            return f"{pretty_round(size)} {unit}"
        size /= divider
    return f"{pretty_round(size)} PB"


# https://github.com/home-assistant/core/blob/dev/homeassistant/util/dt.py#L291
def relative_time(date: datetime) -> str:
    def formatn(number: int, unit: str) -> str:
        if number == 1:
            return f"1 {unit}"
        return f"{number:d} {unit}s"

    delta = (datetime.now() - date).total_seconds()
    rounded_delta = round(delta)

    units = ["second", "minute", "hour", "day", "month"]
    factors = [60, 60, 24, 30, 12]
    selected_unit = "year"

    for i, next_factor in enumerate(factors):
        if rounded_delta < next_factor:
            selected_unit = units[i]
            break
        delta /= next_factor
        rounded_delta = round(delta)

    return formatn(rounded_delta, selected_unit)


def int_hours(data: str) -> int:
    try:
        return int(data.split(' ')[0])
    except ValueError:
        return int(data.split('+')[0].rstrip('h'))
