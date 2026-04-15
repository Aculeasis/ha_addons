# Remote S.M.A.R.T.

A Home Assistant add-on that reads S.M.A.R.T. data from storage devices and publishes it to MQTT for monitoring.

## Features

- **SMART monitoring** – Temperature, health status, power-on hours, and more
- **MQTT auto-discovery** – Sensors appear automatically in Home Assistant
- **Multiple devices** – Monitor SSDs, HDDs, NVMe drives
- **Custom commands** – Override default smartctl arguments per device
- **Sleep detection** – Handles drives in standby mode gracefully

## Quick Start

1. Install the add-on
2. Configure your storage devices in the add-on options
3. Start the add-on
4. Sensors appear under `sensor.remote_smart_*` in Home Assistant

## Device Configuration

Each device requires:
- **device** – Linux device name (e.g., `sda`, `nvme0`)
- **id** – Unique sensor identifier
- **name** – Friendly name (optional)

For detailed configuration, see [DOCS.md](DOCS.md).