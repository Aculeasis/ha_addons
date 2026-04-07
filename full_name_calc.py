#!/usr/bin/env python3
"""
full_name_calc.py

Calculates the full Home Assistant Supervisor addon name (with repo hash) for
every addon found in subdirectories of the repository.

HA Supervisor full name format:  {repo_hash}_{slug}
  repo_hash = first 8 chars of SHA1( repository_url )
  slug      = value of "slug" field in addon's config.yaml

Usage:
    python full_name_calc.py [repo_root_dir]

    repo_root_dir defaults to the directory containing this script.
"""

import hashlib
import os
import sys

import yaml  # pip install pyyaml


def sha1_first8(text: str) -> str:
    """Return first 8 hex chars of SHA1 hash of the given text.

    HA Supervisor lowercases the URL before hashing — see:
    supervisor/store/utils.py :: get_hash_from_repository()
    """
    return hashlib.sha1(text.lower().encode("utf-8")).hexdigest()[:8]


def find_repo_url(repo_root: str) -> str:
    """Read repository.yaml and return the 'url' field."""
    repo_yaml_path = os.path.join(repo_root, "repository.yaml")
    if not os.path.isfile(repo_yaml_path):
        raise FileNotFoundError(f"repository.yaml not found in: {repo_root}")

    with open(repo_yaml_path, encoding="utf-8") as f:
        data = yaml.safe_load(f)

    url = data.get("url")
    if not url:
        raise ValueError("'url' field is missing or empty in repository.yaml")

    return url.rstrip("/")  # HA trims trailing slashes before hashing


def find_addons(repo_root: str):
    """
    Walk direct subdirectories of repo_root looking for config.yaml files
    that contain a 'slug' field.

    Yields (subdir_name, slug) tuples.
    """
    try:
        entries = os.listdir(repo_root)
    except PermissionError as exc:
        print(f"[WARN] Cannot list {repo_root}: {exc}", file=sys.stderr)
        return

    for entry in sorted(entries):
        subdir = os.path.join(repo_root, entry)
        if not os.path.isdir(subdir):
            continue

        config_path = os.path.join(subdir, "config.yaml")
        if not os.path.isfile(config_path):
            continue

        try:
            with open(config_path, encoding="utf-8") as f:
                cfg = yaml.safe_load(f)
        except yaml.YAMLError as exc:
            print(f"[WARN] Failed to parse {config_path}: {exc}", file=sys.stderr)
            continue

        if not isinstance(cfg, dict):
            continue

        slug = cfg.get("slug")
        if slug:
            yield entry, slug


def main():
    repo_root = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(repo_root)

    print(f"Repository root : {repo_root}")

    try:
        repo_url = find_repo_url(repo_root)
    except (FileNotFoundError, ValueError) as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)

    repo_hash = sha1_first8(repo_url)
    print(f"Repository URL  : {repo_url}")
    print(f"Repository hash : {repo_hash}")
    print()

    results = list(find_addons(repo_root))
    if not results:
        print("No addons with 'slug' field found in subdirectories.")
        return

    print(f"{'Subdir':<30} {'Slug':<30} Full name")
    print("-" * 80)
    for subdir_name, slug in results:
        full_name = f"{repo_hash}_{slug}"
        print(f"{subdir_name:<30} {slug:<30} {full_name}")


if __name__ == "__main__":
    main()
