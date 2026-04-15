# Configuration

## MQTT Settings

| Option | Default | Description |
|--------|---------|-------------|
| `mqtt_auto` | `true` | Auto-discover MQTT from Home Assistant |
| `mqtt.host` | `core-mosquitto` | MQTT broker host |
| `mqtt.port` | `1883` | MQTT broker port |
| `mqtt.username` | `""` | MQTT username (optional) |
| `mqtt.password` | `""` | MQTT password (optional) |

When `mqtt_auto` is enabled, credentials are fetched automatically from the integrated MQTT service.

## Monitoring Settings

| Option | Default | Description |
|--------|---------|-------------|
| `update_interval` | `600` | Seconds between SMART readings |
| `missing_attribute` | `false` | Show unavailable attributes as "unavailable" |

## Device Configuration

Add devices to monitor in the `devices` list. Each device supports:

| Option | Required | Description |
|--------|----------|-------------|
| `device` | Yes | Linux device name (`sda`, `nvme0n1`, etc.) |
| `id` | Yes | Unique identifier for MQTT sensor |
| `name` | No | Friendly name in Home Assistant |
| `cmd` | No | Custom smartctl arguments (as space-separated string) |

### Example Configuration

```yaml
devices:
  - device: sda
    id: sda
    name: "Main SSD 250GB"
  - device: sdb
    id: hdd_storage
    name: "Storage HDD 2TB"
  - device: nvme0n1
    id: nvme_system
    name: "NVMe System Drive"
    cmd: "-a --json=c"
```

## Custom Commands

The `cmd` option lets you override default smartctl arguments. Default: `-ai --json=c -n standby,255`

Useful overrides:
- `-a --json=c` – All SMART data, no standby check
- `-A --json=c` – Only attribute table
- `-n never --json=c` – Always wake drive from sleep

## Published Data

Each device creates a sensor with these attributes:

| Attribute | Description |
|-----------|-------------|
| `state` | `Awake`, `Sleep`, `Error`, or smartctl exit code |
| `temperature` | Current drive temperature |
| `Smart status` | `Healthy` or `Failed` |
| `Model name` | Device model |
| `Size` | Capacity in human-readable format |
| `Power on time` | Total power-on duration |
| `Power cycle count` | Number of power cycles |
| `Start stop count` | Total start/stop cycles |
| `Reallocated_Sector_Ct` | Reallocated sectors (indicator of failure) |
| `Current_Pending_Sector` | Pending sector count |
| `Test #N` | Self-test results |

## Device Mapping

For complex storage setups (RAID, LVM), the add-on automatically resolves logical device paths to physical disks. Set `device` to any valid path:

```yaml
devices:
  - device: sda
    id: physical_disk
  - device: /dev/disk/by-id/ata-Samsung_SSD_12345
    id: by_id_path
```

The add-on uses `lsblk` to find the underlying physical disk.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Device not found | Check device name exists in `/dev/` |
| Permission denied | Add-on requires `privileged` access |
| Always shows "Sleep" | Device in standby; use custom cmd without `-n` |
| Missing attributes | Enable `missing_attribute` option |
| MQTT connection fails | Check broker settings or enable `mqtt_auto` |