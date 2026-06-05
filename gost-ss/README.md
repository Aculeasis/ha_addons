# Shadowsocks, GOST & Glider Runner

A [Home Assistant](https://www.home-assistant.io/) add-on for running multiple Shadowsocks, GOST, and Glider proxy instances directly on your Home Assistant system.

**Why use this add-on?** If your Home Assistant needs to connect through a proxy to reach external services — or if you want to run a proxy server on your HA machine — this add-on provides a simple, file-based way to manage any number of proxy instances without complex configuration.

## Features

- Runs **any mix** of `ss-local`, `ss-server`, `ss-redir`, `ss-tunnel`, `gost`, and `glider` instances
- Supports running **multiple instances** simultaneously
- Zero add-on configuration required — everything is driven by the config files
- File extension dictates the runtime:
  - `.json` → Shadowsocks
  - `.yaml` / `.yml` → GOST
  - `.conf` → Glider

## Installation

1. In Home Assistant, go to **Settings → Add-ons → Add-on Store**.
2. Click the three-dot menu (⋮) in the top-right corner and select **Repositories**.
3. Add this repository URL:
   ```
   https://github.com/Aculeasis/ha_addons
   ```
4. Find **Shadowsocks, GOST & Glider Runner** in the store and click **Install**.

## Configuration

For detailed setup instructions, file naming conventions, config file format examples, and port mapping — see **[DOCS.md](DOCS.md)**.

## How It Works

On startup, `run.sh`:

1. Scans `/config/` (mapped from `/addon_configs/89e82855_gost-ss/`) for all `*.json`, `*.yaml`, and `*.conf` files.
2. For `.json` files, parses each filename to extract `TYPE` and `NAME`, and launches `ss-<TYPE> -c <config_file>`. Invalid types are skipped.
3. For `.yaml` / `.yml` files, parses the filename as `<NAME>`, and launches `gost -C <config_file>`.
4. For `.conf` files, parses the filename as `<NAME>`, and launches `glider -config <config_file>`.
5. Prefixes each instance's stdout/stderr with `[NAME]` for log clarity.
6. Waits for a stop signal (`SIGTERM`/`SIGINT`/`SIGHUP`) and gracefully terminates all child processes.

If no config files are found, the add-on logs a warning and remains idle.

## Supported Architectures

| Architecture | Supported |
|-------------|-----------|
| `amd64`     | ✅        |
| `aarch64`   | ✅        |

## See Also

- [ss-libev-docker](https://github.com/Aculeasis/ss-libev-docker) — the same idea as a plain Docker image, for use outside of Home Assistant.

## License

MIT — see [LICENSE](LICENSE).
