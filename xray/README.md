# HA Xray Runner

A Home Assistant add-on that launches an [Xray-core](https://github.com/XTLS/Xray-core) instance based on a standard `config.json` placed in the add-on's configuration directory.

## Installation

1. In Home Assistant, go to **Settings → Add-ons → Add-on Store**.
2. Click the three-dot menu (⋮) in the top-right corner and select **Repositories**.
3. Add this repository URL:
   ```
   https://github.com/Aculeasis/ha_addons
   ```
4. Find **HA Xray Runner** in the store and click **Install**.

## Configuration

For detailed setup instructions, file placement, and port mapping — see **[DOCS.md](DOCS.md)**.

## How It Works

On startup, the add-on:

1. Looks for `/config/config.json` (mapped from `/addon_configs/89e82855_xray/`).
2. If the file is not found, the add-on will wait without exiting until the file is created.
3. Once the configuration file is present, it launches `xray run -config /config/config.json`.

## Supported Architectures

| Architecture | Supported |
|-------------|-----------|
| `amd64`     | ✅        |
| `aarch64`   | ✅        |

## License

MIT
