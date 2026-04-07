#!/bin/bash
set -e

if [[ "$EUID" -ne '0' ]]; then
    echo "Error: You must run this script as root!"
    exit 1
fi

# Detect CPU architecture
arch=$(uname -m)
case $arch in
    x86_64) cpu_arch="amd64" ;;
    aarch64) cpu_arch="arm64" ;;
    armv*) cpu_arch="armv7" ;;
    *) echo "Unsupported architecture: $arch" && exit 1 ;;
esac

echo "Fetching latest GOST release for $cpu_arch..."
url=$(curl -s "https://api.github.com/repos/go-gost/gost/releases/latest" | \
    grep -oE '"browser_download_url": "[^"]+linux[-_]'"$cpu_arch"'\.tar\.gz"' | \
    cut -d'"' -f4 | head -n 1)

if [[ -z "$url" ]]; then
    echo "Error: Could not find download URL for $cpu_arch"
    exit 1
fi

echo "Downloading $url..."
curl -fsSL -o gost.tar.gz "$url"

echo "Installing..."
tmp_dir=$(mktemp -d)
tar -xzf gost.tar.gz -C "$tmp_dir"
mv "$tmp_dir/gost" /usr/local/bin/gost
chmod +x /usr/local/bin/gost
rm -rf "$tmp_dir" gost.tar.gz

echo "GOST successfully installed!"
