"""List all file paths in a folder."""
from pathlib import Path

try:
    from pipeline.format_data import format_text
except ModuleNotFoundError:
    import os
    import sys

    current_dir = os.path.dirname(__file__)
    project_root = os.path.dirname(current_dir)
    if project_root not in sys.path:
        sys.path.insert(0, project_root)

    from pipeline.format_data import format_text

def list_file_names() -> list[Path]:
    """
    Return a list of Path objects for files in the given folder.
    folder_path: path to the folder (default: current directory)
    include_subdirs: if True, include files from subdirectories
    """
    folder = Path("link2").resolve()
    print(folder)
    if not folder.is_dir():
        raise NotADirectoryError(f"Not a directory: {folder}")
    return sorted(p for p in folder.iterdir() if p.is_file())


if __name__ == "__main__":
    import sys


    paths = list_file_names()
    for p in paths:
        print(p)
        format_text(p)
    print(f"\nTotal: {len(paths)} file(s)", file=sys.stderr)
