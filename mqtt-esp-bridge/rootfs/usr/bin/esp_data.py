import hashlib
import uuid


def ssd_one():
    def summ(data_: list):
        return '{{' + 'value_json.a{}'.format(' + value_json.a'.join([str(x)for x in data_])) + '}}'

    name = 'ssd_evo_870'
    uid = hashlib.md5(bytes(name, "utf-8")).hexdigest()[:6]
    topic = 'dev/ssd/{}/'.format(name)
    cfg_topic = 'homeassistant/sensor/ssd_{}/config'
    device = {
        "ids": uid, "name": "870 EVO 500 GB", "sw": "1.0.0", "mdl": "SSD",
        "mf": "Samsung"
    }
#   5 Reallocated_Sector_Ct
#   9 Power_On_Hours
#  12 Power_Cycle_Count
# 177 Wear_Leveling_Count
# 179 Used_Rsvd_Blk_Cnt_Tot
# 181 Program_Fail_Cnt_Total
# 182 Erase_Fail_Count_Total
# 183 Runtime_Bad_Block
# 187 Uncorrectable_Error_Cnt
# 190 Airflow_Temperature_Cel
# 195 ECC_Error_Rate
# 199 CRC_Error_Count
# 235 POR_Recovery_Count
# 241 Total_LBAs_Written

    # lba = (1024 * 1024 * 1024) // 512
    # errors = summ([5, 179, 181, 182, 183])
    # warns = summ([195, 199, 187])
    # data = [
    #     {"unit_of_meas": "°C", "name": "Temperature", "dev_cla": "temperature", "stat_t": "sata",
    #      "val_tpl": '{{value_json.a190}}'},
    #     {"unit_of_meas": "%", "name": "Life", "dev_cla": "battery", "stat_t": "sata",
    #      "val_tpl": '{{value_json.a177|int}}'},
    #     {"unit_of_meas": "GB", "name": "Write", "icon": "hass:nas", "stat_t": "sata",
    #      "val_tpl": '{{' + '(value_json.a241 / {})|int'.format(lba) + '}}'},
    #     {"unit_of_meas": "Days", "name": "Age", "icon": "hass:baby-carriage", "stat_t": "sata",
    #      "val_tpl": '{{(value_json.a9 / 24)|int}}'},
    #     {"name": "Errors", "icon": "hass:alert-circle-outline", "stat_t": "sata",
    #      "val_tpl": errors},
    #     {"name": "Warns", "icon": "hass:alert-circle-outline", "stat_t": "sata",
    #      "val_tpl": warns},
    # ]
    lba = 32 / 1024
    errors = summ([5, 178, 181, 182, 196])
    warns = summ([195, 199, 181])
    data = [
        {"unit_of_meas": "°C", "name": "Temperature", "dev_cla": "temperature", "stat_t": "sata",
         "val_tpl": '{{value_json.a194}}'},
        {"unit_of_meas": "%", "name": "Life", "dev_cla": "battery", "stat_t": "sata",
         "val_tpl": '{{value_json.a169|int}}'},
        {"unit_of_meas": "GB", "name": "Write", "icon": "hass:nas", "stat_t": "sata",
         "val_tpl": '{{' + '(value_json.a241 * {})|int'.format(lba) + '}}'},
        {"unit_of_meas": "Days", "name": "Age", "icon": "hass:baby-carriage", "stat_t": "sata",
         "val_tpl": '{{(value_json.a9 / 24)|int}}'},
        {"name": "Errors", "icon": "hass:alert-circle-outline", "stat_t": "sata",
         "val_tpl": errors},
        {"name": "Warns", "icon": "hass:alert-circle-outline", "stat_t": "sata",
         "val_tpl": warns},
    ]
    return discovery_adapter(uid, data=data, topic=topic, cfg_topic=cfg_topic, device=device)


def discovery_adapter(uid: str, data=None, topic=None, cfg_topic=None, device=None, avty_t=False):
    uid = uid.lower()
    cfg_topic = cfg_topic or 'homeassistant/sensor/esp_{}/config'
    topic = topic or 'dev/esp/sensor/esp_{}/'.format(uid)
    device = device or {
        "ids": uid, "name": "ESP sensor {}".format(uid), "sw": "1.0.0", "mdl": "ESP Sensor",
        "mf": "Aculeasis"
    }
    data = data or [
        {"unit_of_meas": "°C", "name": "Temperature", "dev_cla": "temperature", "stat_t": "temperature"},
        {"unit_of_meas": "%", "name": "Humidity", "dev_cla": "humidity", "stat_t": "humidity"},
        {
            "unit_of_meas": "%", "name": "battery", "dev_cla": "battery", "stat_t": "battery",
            'ent_cat': 'diagnostic', 'stat_cla': 'measurement'
        },
        {
            "unit_of_meas": "V", "name": "voltage", "dev_cla": "voltage", "stat_t": "voltage",
            'ent_cat': 'diagnostic', 'stat_cla': 'measurement'
        },
    ]
    result = {}
    for idx, cfg in enumerate(data):
        id_ = '{}_{}'.format(uid, idx)
        cfg.update({'uniq_id': id_,
                    'stat_t': topic + cfg['stat_t'],
                    'dev': device,
                    'name': '{}_{}'.format(cfg['name'], uid[-6:])})
        if avty_t:
            cfg['avty_t'] = 'dev/esp/availabilities/esp_{}'.format(uid)
        result[cfg_topic.format(id_)] = cfg
    return result


if __name__ == '__main__':
    print(ssd_one())
