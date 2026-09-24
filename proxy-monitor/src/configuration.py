"""Validate values that can stop the workers or delete retained history."""

import math


def validate_config(config: dict) -> None:
    if not isinstance(config, dict):
        raise ValueError("Config must be an object")
    for section in ("server", "monitoring", "storage"):
        if not isinstance(config.get(section, {}), dict):
            raise ValueError(f"{section} must be an object")

    limits = {
        "server": {"port": (1, 65535, True)},
        "monitoring": {
            "check_interval_seconds": (0.1, None, False),
            "check_timeout_seconds": (0.1, None, False),
            "concurrent_checks": (1, None, True),
            "recent_window_minutes": (1, None, False),
        },
        "storage": {
            "retention_days": (1, None, True),
            "cleanup_interval_minutes": (1, None, False),
        },
    }
    for section, fields in limits.items():
        for name, (minimum, maximum, integer) in fields.items():
            if name not in config.get(section, {}):
                continue
            value = config[section][name]
            if (type(value) not in (int, float) or not math.isfinite(value)
                    or (integer and type(value) is not int) or value < minimum
                    or (maximum is not None and value > maximum)):
                raise ValueError(f"Invalid {section}.{name}")

    server = config.get("server", {})
    if not isinstance(server.get("log_level", "INFO"), str):
        raise ValueError("server.log_level must be a string")
    for key in ("trusted_ips", "whitelist"):
        values = server.get(key, [])
        if not isinstance(values, list) or any(not isinstance(value, str) for value in values):
            raise ValueError(f"server.{key} must be a list of strings")

    proxies = config.get("proxies", [])
    if not isinstance(proxies, list):
        raise ValueError("proxies must be a list")
    seen = set()
    for proxy in proxies:
        if not isinstance(proxy, dict) or not isinstance(proxy.get("host"), str) or not proxy["host"].strip():
            raise ValueError("Each proxy needs a host")
        port = proxy.get("port")
        if type(port) is not int or not 1 <= port <= 65535:
            raise ValueError("Proxy port must be an integer from 1 to 65535")
        identifier = (proxy["host"], port)
        if identifier in seen:
            raise ValueError("Duplicate proxy host and port")
        seen.add(identifier)
        for kind in ("tcp", "udp"):
            if type(proxy.get(f"{kind}_check", kind == "tcp")) is not bool:
                raise ValueError(f"{kind}_check must be a boolean")
