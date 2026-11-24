# Changelog

## 1.0.3

- Prevent watchdog bootloop by waiting indefinitely in non-normal modes (`reinstall`, `login`, `logout`, `locations`)
- Prevent script termination on reinstallation or login errors

## 1.0.2

- Move external IP detection from `run.sh` to `connect.sh`

## 1.0.1

- Add hidden debug mode
- Refactor watchdog: replace `test_host`/`test_port` with `test_url` option
- Documentation improvements

## 1.0.0

- Initial release
