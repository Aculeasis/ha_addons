# HA Shadowsocks & GOST Runner

A Home Assistant add-on that automatically discovers and launches any number of [shadowsocks-libev](https://github.com/shadowsocks/shadowsocks-libev) or [GOST](https://gost.run/) instances based on standard config files placed in the add-on's configuration directory.

## Features

- Runs **any mix** of `ss-local`, `ss-server`, `ss-redir`, `ss-tunnel` and `gost` instances
- Supports running **multiple instances** simultaneously
- Zero add-on configuration required — everything is driven by the config files
- File extension dictates the runtime (`.json` for Shadowsocks, `.yaml` or `.yml` for GOST)

## Installation

1. In Home Assistant, go to **Settings → Add-ons → Add-on Store**.
2. Click the three-dot menu (⋮) in the top-right corner and select **Repositories**.
3. Add this repository URL:
   ```
   https://github.com/Aculeasis/ha_addons
   ```
4. Find **HA Shadowsocks & GOST Runner** in the store and click **Install**.

## Configuration

For detailed setup instructions, file naming conventions, config file format examples, and port mapping — see **[DOCS.md](DOCS.md)**.

## How It Works

On startup, `run.sh`:

1. Scans `/config/` (mapped from `/addon_configs/89e82855_gost-ss/`) for all `*.json` and `*.yaml` files.
2. For `.json` files, parses each filename to extract `TYPE` and `NAME`, and launches `ss-<TYPE> -c <config_file>`. Invalid types are skipped.
3. For `.yaml` files, parses the filename as `<NAME>`, and launches `gost -C <config_file>`.
4. Prefixes each instance's stdout/stderr with `[NAME]` for log clarity.
5. Waits for a stop signal (`SIGTERM`/`SIGINT`/`SIGHUP`) and gracefully terminates all child processes.

If no config files are found, the add-on exits with an error.

## Supported Architectures

| Architecture | Supported |
|-------------|-----------|
| `amd64`     | ✅        |
| `aarch64`   | ✅        |

## See Also

- [ss-libev-docker](https://github.com/Aculeasis/ss-libev-docker) — the same idea as a plain Docker image, for use outside of Home Assistant.

## License

MIT — see [LICENSE](LICENSE).
