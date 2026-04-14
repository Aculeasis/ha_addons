#!/usr/bin/with-contenv bashio
# AdGuard VPN CLI Installation Script for Home Assistant Add-on
set -e

#================================================================================
# CONFIGURATION
#================================================================================
CLI_PATH="/root/.local/share/adguardvpn-cli/adguardvpn-cli"
DATA_DIR="/root/.local/share/adguardvpn-cli"

#================================================================================
# DETECT ARCHITECTURE
#================================================================================

detect_arch() {
    local arch
    arch=$(uname -m)

    case "$arch" in
        x86_64|amd64)
            echo "x86_64"
            ;;
        aarch64|arm64)
            echo "aarch64"
            ;;
        *)
            bashio::log.fatal "Unsupported architecture: $arch"
            bashio::log.fatal "Supported: x86_64, aarch64"
            exit 1
            ;;
    esac
}

#================================================================================
# GET VERSION
#================================================================================

get_latest_version() {
    bashio::log.info "Fetching latest version from GitHub..."

    local version
    version=$(curl -s --connect-timeout 30 \
        "https://api.github.com/repos/AdguardTeam/AdGuardVPNCLI/releases/latest" 2>/dev/null \
        | grep '"tag_name"' \
        | sed -E 's/.*"v([^"]+)".*/\1/' \
        | head -1)

    if [ -z "$version" ]; then
        # Fallback: try to get from releases page
        bashio::log.warning "API failed, trying releases page..."
        version=$(curl -sL --connect-timeout 30 \
            "https://github.com/AdguardTeam/AdGuardVPNCLI/releases/latest" 2>/dev/null \
            | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' \
            | head -1 \
            | sed 's/^v//')
    fi

    if [ -z "$version" ]; then
        bashio::log.error "Failed to get latest version"
        exit 1
    fi

    echo "$version"
}

#================================================================================
# DOWNLOAD AND INSTALL
#================================================================================

download_and_install() {
    local version="$1"
    local arch="$2"

    # Extract version number without suffix (e.g., "1.7.12-release" -> "1.7.12", "1.7.13-beta" -> "1.7.13")
    local version_num
    version_num=$(echo "$version" | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+')

    # Build package name and URL
    local pkg_name="adguardvpn-cli-${version_num}-linux-${arch}.tar.gz"
    local url="https://github.com/AdguardTeam/AdGuardVPNCLI/releases/download/v${version}/${pkg_name}"

    bashio::log.debug "Version: $version"
    bashio::log.debug "Architecture: $arch"
    bashio::log.debug "Package: $pkg_name"
    bashio::log.debug "URL: $url"

    # Create directory if needed
    mkdir -p "$(dirname "$CLI_PATH")"

    # Download
    local tmp_dir="/tmp/adguard_install_$$"
    mkdir -p "$tmp_dir"

    bashio::log.info "Downloading..."
    if ! curl -fsSL --connect-timeout 60 --max-time 300 \
        -o "$tmp_dir/adguardvpn.tar.gz" "$url"; then
        bashio::log.error "Download failed"
        rm -rf "$tmp_dir"
        exit 1
    fi

    # Verify download
    if [ ! -s "$tmp_dir/adguardvpn.tar.gz" ]; then
        bashio::log.error "Downloaded file is empty"
        rm -rf "$tmp_dir"
        exit 1
    fi

    bashio::log.info "Downloaded successfully ($(du -h "$tmp_dir/adguardvpn.tar.gz" | cut -f1))"

    # Extract
    bashio::log.info "Extracting..."
    if ! tar -xzf "$tmp_dir/adguardvpn.tar.gz" -C "$tmp_dir"; then
        bashio::log.error "Extraction failed"
        rm -rf "$tmp_dir"
        exit 1
    fi

    # Find binary
    local binary_path
    binary_path=$(find "$tmp_dir" -name "adguardvpn-cli" -type f | head -1)

    if [ -z "$binary_path" ]; then
        # Try to find in subdirectory
        local subdir
        subdir=$(find "$tmp_dir" -type d -name "adguardvpn-cli*" | head -1)
        if [ -n "$subdir" ]; then
            binary_path="$subdir/adguardvpn-cli"
        fi
    fi

    if [ -z "$binary_path" ] || [ ! -f "$binary_path" ]; then
        bashio::log.error "Binary not found in archive"
        bashio::log.debug "Archive contents:"
        find "$tmp_dir" -type f || true
        rm -rf "$tmp_dir"
        exit 1
    fi

    # Install
    bashio::log.info "Installing to $CLI_PATH..."
    mv "$binary_path" "$CLI_PATH"
    chmod +x "$CLI_PATH"

    # Cleanup
    rm -rf "$tmp_dir"

    bashio::log.info "Installation complete!"
}

#================================================================================
# POST-INSTALL
#================================================================================

post_install() {
    # Show version
    local cli_version
    cli_version=$("$CLI_PATH" -v 2>/dev/null | head -1) || cli_version="unknown"
    if [ "$cli_version" != "unknown" ]; then
        bashio::log.info "AdGuard VPN CLI installed: $cli_version"
    else
        bashio::log.warning "Installation completed, but version check failed"
    fi
}

#================================================================================
# MAIN
#================================================================================

main() {
    bashio::log.info "AdGuard VPN CLI Installer starting..."

    # Get requested version from config or use latest
    local requested_version
    requested_version=$(bashio::config 'adguard.version')

    # Determine version
    local version
    if [ -n "$requested_version" ] && [ "$requested_version" != "latest" ]; then
        # Remove 'v' prefix if present
        version="${requested_version#v}"
        bashio::log.info "Using requested version: $version"
    else
        version=$(get_latest_version)
        bashio::log.info "Using latest version: $version"
    fi

    # Detect architecture
    local arch
    arch=$(detect_arch)

    # Download and install
    download_and_install "$version" "$arch"

    # Run post-install
    post_install

    bashio::log.info "Done!"
}

# Run main
main