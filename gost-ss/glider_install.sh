#!/bin/bash
set -e

if [[ "$EUID" -ne '0' ]]; then
    echo "Error: You must run this script as root!"
    exit 1
fi

GLIDER_VERSION="0.16.4"

# Detect CPU architecture
arch=$(uname -m)
case $arch in
    x86_64) cpu_arch="amd64" ;;
    aarch64) cpu_arch="arm64" ;;
    armv7*) cpu_arch="armv7" ;;
    armv6*) cpu_arch="armv6" ;;
    *) echo "Unsupported architecture: $arch" && exit 1 ;;
esac

echo "Installing Glider ${GLIDER_VERSION} for ${cpu_arch}..."
url="https://github.com/nadoo/glider/releases/download/v${GLIDER_VERSION}/glider_${GLIDER_VERSION}_linux_${cpu_arch}.tar.gz"

echo "Downloading ${url}..."
curl -fsSL -o glider.tar.gz "${url}"

echo "Installing..."
tmp_dir=$(mktemp -d)
tar -xzf glider.tar.gz -C "${tmp_dir}"
mv "${tmp_dir}/glider" /usr/local/bin/glider
chmod +x /usr/local/bin/glider
rm -rf "${tmp_dir}" glider.tar.gz

echo "Glider ${GLIDER_VERSION} successfully installed!"
