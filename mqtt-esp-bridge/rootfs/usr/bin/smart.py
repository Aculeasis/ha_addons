#!/usr/bin/python3

import os
import subprocess

# SATA example:
# {'Reallocated_Sector_Ct': 0, 'Power_On_Hours': 21, 'Power_Cycle_Count': 19, 'Wear_Leveling_Count': 1,
# 'Used_Rsvd_Blk_Cnt_Tot': 0, 'Program_Fail_Cnt_Total': 0, 'Erase_Fail_Count_Total': 0,
# 'Runtime_Bad_Block': 0, 'Reported_Uncorrect': 0, 'Airflow_Temperature_Cel': 41, 'Hardware_ECC_Recovered': 0,
# 'UDMA_CRC_Error_Count': 0, 'Unknown_Attribute': 17, 'Total_LBAs_Written': 469173407}
# KEYS =
# ['Reallocated_Sector_Ct', 'Power_On_Hours', 'Wear_Leveling_Count', 'Airflow_Temperature_Cel', 'Total_LBAs_Written']

# NVMe key mapping: smartctl field name -> SATA-compatible attribute ID
# This allows esp_data.py templates (value_json.aXXX) to work with NVMe data
NVME_KEY_MAP = {
    'Temperature':                     194,
    'Percentage Used':                 177,  # wear leveling equivalent
    'Power On Hours':                    9,
    'Power Cycles':                     12,
    'Data Units Written':              241,
    'Data Units Read':                 242,
    'Media and Data Integrity Errors':   5,  # maps to Reallocated_Sector_Ct equivalent
    'Unsafe Shutdowns':                192,
    'Critical Warning':                199,
    'Host Read Commands':              243,
    'Host Write Commands':             244,
    'Controller Busy Time':            245,
    'Error Information Log Entries':   196,
}


def _run_smartctl(device: str) -> bytes:
    try:
        return subprocess.run(
            ['/usr/sbin/smartctl', '-a', device], check=True, capture_output=True).stdout
    except subprocess.CalledProcessError as e:
        if e.returncode in [4, 68, 64]:
            return e.output
        raise


def _is_nvme(device: str, data: list[bytes]) -> bool:
    """Detect NVMe by device path or by output content."""
    if 'nvme' in device.lower():
        return True
    for line in data:
        if b'NVMe' in line or b'nvme' in line:
            return True
    return False


def _parse_sata(data: list[bytes]) -> dict:
    """Parse SATA smartctl output (table with ID# header, 10-column rows)."""
    found = False
    result = {}
    for line in data:
        if line.startswith(b'ID#'):
            found = True
            continue
        if found and line.startswith(b'SMART Error Log'):
            break
        if found:
            line = [x for x in line.decode('UTF-8').split(' ') if x]
            if len(line) == 10:
                result[f"a{line[0]}"] = [line[3], line[4], line[5], line[9]]

    # # govnofix
    # if 'a177' in result:
    #     result['a177'][-1] = result['a177'][0]
    return {k: int(v[-1]) for k, v in result.items()}


def _parse_nvme(data: list[bytes]) -> dict:
    """Parse NVMe smartctl output (key: value pairs)."""
    result = {}
    for line in data:
        decoded = line.decode('UTF-8').strip()
        if ':' not in decoded:
            continue
        key, _, value = decoded.partition(':')
        key = key.strip()
        value = value.strip()

        if key not in NVME_KEY_MAP:
            continue

        attr_id = NVME_KEY_MAP[key]
        try:
            # Handle values like "39 Celsius" -> 39
            # Handle values like "100%" -> 100
            # Handle values like "17,121,182 [8.76 TB]" -> 17121182
            # Handle plain integers like "130"
            # Handle hex like "0x00" -> 0
            value = value.split()[0]  # take first token
            value = value.rstrip('%')
            value = value.replace(',', '')
            if value.startswith('0x'):
                parsed = int(value, 16)
            else:
                parsed = int(value)
        except (ValueError, IndexError):
            continue

        result[f"a{attr_id}"] = parsed

    # Compute Life (a169) from Percentage Used (a177): Life = 100% - wear%
    if 'a177' in result:
        result['a169'] = max(0, 100 - result['a177'])

    # Normalize Data Units Written/Read for esp_data.py formula: a241 * (32/1024) = GB
    # NVMe unit = 1000 * 512 = 512,000 bytes = 0.000512 GB
    # SATA formula unit = 32/1024 GB = 0.03125 GB
    # Factor: 0.000512 / 0.03125 = 0.016384
    for key in ('a241', 'a242'):
        if key in result:
            result[key] = int(result[key] * 0.016384)

    # Zero-fill SATA attributes used in esp_data.py sum templates (errors/warns)
    # that have no NVMe equivalent, so Jinja templates don't break
    # errors: a5 + a178 + a181 + a182 + a196
    # warns:  a195 + a199 + a181
    for attr_id in (178, 181, 182, 195):
        key = f"a{attr_id}"
        if key not in result:
            result[key] = 0

    return result


def get_smart() -> dict:
    smart_device = os.environ.get('SMART_DEVICE', '/dev/sda')
    data_result = _run_smartctl(smart_device)
    data_result = data_result.split(b'\n')

    if _is_nvme(smart_device, data_result):
        return _parse_nvme(data_result)
    return _parse_sata(data_result)
