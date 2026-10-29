#!/bin/bash
set -e

DRY_RUN=false
VERSION=""

for arg in "$@"; do
    case "$arg" in
        --dry-run|-d|-n)
            DRY_RUN=true
            ;;
        -h|--help)
            echo "Usage: $0 [--dry-run] <version>"
            echo ""
            echo "Arguments:"
            echo "  <version>    Xray-core version to install (e.g., 26.10.21 or v26.10.21)"
            echo ""
            echo "Options:"
            echo "  --dry-run    Print the resolved download URL and exit without downloading"
            echo "  -h, --help   Show this help message"
            exit 0
            ;;
        -*)
            echo "Error: Unknown option: $arg" >&2
            echo "Usage: $0 [--dry-run] <version>" >&2
            exit 1
            ;;
        *)
            if [[ -z "$VERSION" ]]; then
                VERSION="$arg"
            else
                echo "Error: Unexpected argument: $arg" >&2
                echo "Usage: $0 [--dry-run] <version>" >&2
                exit 1
            fi
            ;;
    esac
done

VERSION="${VERSION:-$XRAY_VERSION}"

if [[ -z "$VERSION" ]]; then
    echo "Error: Xray version not specified!" >&2
    echo "Usage: $0 [--dry-run] <version>" >&2
    exit 1
fi

VERSION="${VERSION#v}"

# Detect CPU architecture
arch="${ARCH:-$(uname -m)}"
case $arch in
    x86_64|amd64)  cpu_arch="64" ;;
    aarch64|arm64) cpu_arch="arm64-v8a" ;;
    armv7*|armhf)  cpu_arch="arm32-v7a" ;;
    armv6*)        cpu_arch="arm32-v6" ;;
    *)
        echo "Error: Unsupported architecture: $arch" >&2
        exit 1
        ;;
esac

url="https://github.com/XTLS/Xray-core/releases/download/v${VERSION}/Xray-linux-${cpu_arch}.zip"

if [[ "$DRY_RUN" == "true" ]]; then
    echo "$url"
    exit 0
fi

if [[ "$EUID" -ne '0' ]]; then
    echo "Error: You must run this script as root!" >&2
    exit 1
fi

echo "Installing Xray-core v${VERSION} for linux-${cpu_arch}..."
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
