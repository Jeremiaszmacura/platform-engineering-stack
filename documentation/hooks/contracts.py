"""MkDocs hook: add stock-app/openapi.yaml to the site at build time instead of copying it into docs/."""

from pathlib import Path

from mkdocs.structure.files import File

# Site path -> path of the contract, relative to the repository root.
CONTRACTS = {"services/stock-app-openapi.yaml": "stock-app/openapi.yaml"}


def on_files(files, config):
    """Add each contract to the site files; raise FileNotFoundError if one is missing."""
    root = Path(config.config_file_path).resolve().parent.parent
    for site_path, source_path in CONTRACTS.items():
        contract = root / source_path
        if not contract.is_file():
            raise FileNotFoundError(f"contract {contract} declared in hooks/contracts.py is missing")
        files.append(File.generated(config, site_path, content=contract.read_text(encoding="utf-8")))
    return files
