#!/bin/bash
set -e

if [[ "$EUID" -ne '0' ]]; then
    echo "Error: You must run this script as root!"
    exit 1
fi

# Detect CPU architecture
arch=$(uname -m)
case $arch in
    x86_64)   cpu_arch="64" ;;
    aarch64)  cpu_arch="arm64-v8a" ;;
    armv7*)   cpu_arch="arm32-v7a" ;;
    armv6*)   cpu_arch="arm32-v6" ;;
    *) echo "Unsupported architecture: $arch" && exit 1 ;;
esac

echo "Fetching latest Xray release for linux-${cpu_arch}..."
url=$(curl -s "https://api.github.com/repos/XTLS/Xray-core/releases/latest" | \
    grep -oE '"browser_download_url": "[^"]+Xray-linux-'"${cpu_arch}"'\.zip"' | \
    cut -d'"' -f4 | head -n 1)

if [[ -z "$url" ]]; then
    echo "Error: Could not find download URL for linux-${cpu_arch}"
    exit 1
fi

echo "Downloading $url..."
curl -fsSL -o /tmp/xray.zip "$url"

echo "Installing..."
tmp_dir=$(mktemp -d)
unzip -q /tmp/xray.zip -d "$tmp_dir"

mv "$tmp_dir/xray" /usr/local/bin/xray
chmod +x /usr/local/bin/xray

# Install geo data files to a stable location
mkdir -p /usr/local/share/xray
mv "$tmp_dir/geoip.dat"   /usr/local/share/xray/geoip.dat
mv "$tmp_dir/geosite.dat" /usr/local/share/xray/geosite.dat

rm -rf "$tmp_dir" /tmp/xray.zip

echo "Xray successfully installed!"
xray version
