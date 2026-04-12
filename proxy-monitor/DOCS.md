# Configuration

All configuration is done via a single `config.yaml` file in the add-on's configuration directory.

## Config Directory

The file should be placed at:

```
/addon_configs/89e82855_proxy-monitor/config.yaml
```

On first start, if no `config.yaml` is found, a default one is created automatically.

> **Note:** This is **not** the main Home Assistant config folder. Access it via File Editor, Samba (`addon_configs` share) or SSH.

All settings can also be changed live from the **Settings** panel in the web UI.
