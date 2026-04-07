import json
import os
import re
import subprocess
from datetime import datetime, timedelta
from utils import relative_time, pretty_size, int_hours

_UN = 'unavailable'


def get_smart(dev: str, cmd: list | None, r_dev: str | None, missing_attribute: bool) -> tuple[str, dict]:
    r_dev = _get_physical_disk(r_dev)
    return _parse_smart(*_read_smart(r_dev or dev, cmd), missing_attribute)


# "SMART Ref": "https://www.backblaze.com/blog/what-smart-stats-indicate-hard-drive-failures/",
def _parse_smart(code: int, data_: dict, missing_attribute: bool) -> tuple[str, dict]:
    if code == 9999:
        return 'Error', {}
    elif code == 255:
        return 'Sleep', {}
    elif code not in (0, 4, 64):
        return str(code), {}
    data = {}
    try:
        data = {
            'Last updated': f'{datetime.now():%H:%M, %d.%m.%Y}',
            'Model name': data_.get('model_name', _UN),
            'Device': data_.get('device', {}).get('name', _UN),
            'Size': pretty_size(data_.get("user_capacity", {}).get("bytes", 0)),
            'temperature': data_.get('temperature', {}).get('current', _UN),
            'Smart status': 'Healthy' if data_.get('smart_status', {}).get('passed', False) else 'Failed',
        }

        atr = {}
        for val in data_.get('ata_smart_attributes', {}).get('table', []):
            atr[val['id']] = val['raw']['value'] if val['id'] != 9 else int_hours(val['raw']['string'])
        attr_data = {
            'Power on time': relative_time(datetime.now() - timedelta(hours=atr[9])) if 9 in atr else _UN,
            'Power cycle count': atr.get(12, _UN),
            'Start stop count': atr.get(4, _UN),
            'Reallocated_Sector_Ct': atr.get(5, _UN),
            'Reported_Uncorrect': atr.get(187, _UN),
            'Command_Timeout': atr.get(188, _UN),
            'Current_Pending_Sector': atr.get(197, _UN),
            'Offline_Uncorrectable': atr.get(198, _UN),
        }
        if not missing_attribute:
            attr_data = {k: v for k, v in attr_data.items() if v != _UN}
        data.update(attr_data)

        logs = data_.get('ata_smart_self_test_log', {})
        for values in [logs.get('standard', {}).get('table', []), logs.get('extended', {}).get('table', [])]:
            for idx, val in enumerate(values):
                test = val.get('type', {}).get('string', _UN)
                result = val.get('status', {}).get('string', _UN)
                if test == 'Short offline':
                    test = 'Short'
                if result == 'Completed without error':
                    result = 'OK'
                data[f'Test #{idx}'] = f'{test}, {result} @ {val.get("lifetime_hours", _UN)} hrs'
    except Exception as e:
        print(f'SMART PARSE ERROR: {e}')
        return 'Error', data
    return 'Awake', data


def _read_smart(device: str, cmd: list | None) -> tuple[int, dict]:
    call = ['/usr/sbin/smartctl']
    call += cmd or ['-ai', '--json=c', '-n', 'standby,255', f'/dev/{device}']
    try:
        data = subprocess.run(call, check=True, capture_output=True, timeout=30).stdout
    except subprocess.CalledProcessError as e:
        if e.returncode in [4, 68, 64]:
            data = e.output
        else:
            print(f'SMART READ ERROR {e.returncode}:{e.output}')
            return e.returncode, {}
    try:
        data = json.loads(data)
        return data['smartctl']['exit_status'], data
    except Exception as e:
        print(f'SMART DECODE ERROR: {e}')
        return 9999, {}


def _get_physical_disk(device_path: str | None) -> str | None:
    if not device_path:
        return None
    if not device_path.startswith("/dev/"):
        device_path = f"/dev/{device_path}"
    try:
        real_path = os.path.realpath(device_path)
        result = subprocess.run(['lsblk', '-s', '-n', '-o', 'NAME,TYPE', real_path],
                                capture_output=True, text=True, check=True, timeout=10
                                )
        for line in result.stdout.strip().split('\n'):
            parts = line.split()
            if len(parts) >= 2:
                name = re.sub(r'[├└─│\s]', '', parts[0])
                dev_type = parts[1]
                if dev_type == 'disk' and name:
                    return name
        raise ValueError(f"No physical disk found for {device_path}")
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f'_get_physical_disk ERROR: {e}')
    return None
