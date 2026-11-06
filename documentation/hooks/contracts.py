"""Pull service API contracts into the site at build time.

A service's OpenAPI contract belongs to the service, not to the documentation:
`stock-app/openapi.yaml` is what generates that service's models and what it
serves at `/openapi.yaml`. Copying it under `docs/` would create a second copy
to keep in step, so it is read from its own directory and injected into the
built site instead. There is still exactly one file.

The path is resolved relative to `mkdocs.yml`, and the documentation image
mirrors the repository layout so the same expression works in both.
"""

from pathlib import Path

from mkdocs.structure.files import File

# Site path -> path of the contract, relative to the repository root.
CONTRACTS = {"services/stock-app-openapi.yaml": "stock-app/openapi.yaml"}


def on_files(files, config):
    """Add every service contract to the site as a generated file.

    Args:
        files: The file collection MkDocs has gathered from ``docs_dir``.
        config: The MkDocs configuration, used to locate the repository root.

    Returns:
        The collection with each contract appended.

    Raises:
        FileNotFoundError: If a declared contract is missing, which would
            otherwise surface as an empty API page.
    """
    root = Path(config.config_file_path).resolve().parent.parent
    for site_path, source_path in CONTRACTS.items():
        contract = root / source_path
        if not contract.is_file():
            raise FileNotFoundError(f"contract {contract} declared in hooks/contracts.py is missing")
        files.append(File.generated(config, site_path, content=contract.read_text(encoding="utf-8")))
    return files
