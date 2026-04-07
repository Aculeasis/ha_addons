import hashlib
import json
from typing import Any, Generator

TOPIC = 'dev/remote_smart/sensor/{}'
AVAILABILITY = 'dev/remote_smart/availabilities/{}'
UID = hashlib.md5(bytes(TOPIC, "utf-8")).hexdigest()[:6]
DEVICE = {"ids": UID, "name": 'Remote S.M.A.R.T', "mf": "Aculeasis"}


def discovery(devices: dict) -> Generator[tuple[str, str], Any, None]:
    for val in devices.values():
        yield f'homeassistant/sensor/remote_smart_{val["id"]}/config',  json.dumps({
            'uniq_id': f'{val["id"]}_{UID}',
            'name': val.get('name', val['id']),
            'stat_t': TOPIC.format(val['id']),
            'json_attr_t': TOPIC.format(f'{val["id"]}_t'),
            'dev': DEVICE,
            'icon': 'mdi:harddisk',
            'avty_t': AVAILABILITY.format(val['id']),
        }, ensure_ascii=False)


def publish(state: str, smart: dict, device: dict) -> Generator[tuple[str, str], Any, None]:
    yield TOPIC.format(device['id']), state
    if smart:
        yield TOPIC.format('{}_t'.format(device['id'])), json.dumps(smart, ensure_ascii=False)


def availability(devices: dict, online: bool) -> Generator[tuple[str, str], Any, None]:
    for val in devices.values():
        yield AVAILABILITY.format(val['id']), 'online' if online else 'offline'
