#!/usr/bin/python3

import subprocess

# {'Reallocated_Sector_Ct': 0, 'Power_On_Hours': 21, 'Power_Cycle_Count': 19, 'Wear_Leveling_Count': 1,
# 'Used_Rsvd_Blk_Cnt_Tot': 0, 'Program_Fail_Cnt_Total': 0, 'Erase_Fail_Count_Total': 0,
# 'Runtime_Bad_Block': 0, 'Reported_Uncorrect': 0, 'Airflow_Temperature_Cel': 41, 'Hardware_ECC_Recovered': 0,
# 'UDMA_CRC_Error_Count': 0, 'Unknown_Attribute': 17, 'Total_LBAs_Written': 469173407}
# KEYS =
# ['Reallocated_Sector_Ct', 'Power_On_Hours', 'Wear_Leveling_Count', 'Airflow_Temperature_Cel', 'Total_LBAs_Written']


def get_smart() -> dict:
    try:
        data_result = subprocess.run(
            ['/usr/sbin/smartctl', '-d', 'sat', '-a', '/dev/sda'], check=True, capture_output=True).stdout
    except subprocess.CalledProcessError as e:
        if e.returncode in [4, 68, 64]:
            data_result = e.output
        else:
            raise e
    data_result = data_result.split(b'\n')

    found = False
    result = {}
    for line in data_result:
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

