# AdguardVPN Home Assistant Add-on

> ⚠️ **This is an unofficial community add-on and is not affiliated with, endorsed by, or connected to AdGuard in any way.**

A Home Assistant add-on that runs AdGuard VPN as a SOCKS5 proxy. Route traffic from Home Assistant, other add-ons, or network devices through AdGuard VPN servers for privacy and geo-location access.

Uses the official [AdGuard VPN CLI](https://github.com/AdguardTeam/AdGuardVPNCLI).

## Quick Start

1. Install → Set mode to `login` → Start
2. Open logs, copy the authorization link
3. Open the link in browser and login
4. Wait a few minutes for authorization to complete
5. Set mode to `normal` → Restart

## Usage

Proxy available at: `YOUR_HA_IP:15554` (default auth: user/user)

From inside HAOS: `socks5://user:user@89e82855_adguardvpn:15554`

