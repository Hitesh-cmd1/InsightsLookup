"""List all file paths in a folder."""
from pathlib import Path

from format_data import  format_text 

def list_file_names(folder_path: str | Path = "../link", include_subdirs: bool = False) -> list[Path]:
    """
    Return a list of Path objects for files in the given folder.
    folder_path: path to the folder (default: current directory)
    include_subdirs: if True, include files from subdirectories
    """
    folder = Path(folder_path).resolve()
    if not folder.is_dir():
        raise NotADirectoryError(f"Not a directory: {folder}")

    if include_subdirs:
        return sorted(p for p in folder.rglob("*") if p.is_file())
    return sorted(p for p in folder.iterdir() if p.is_file())


if __name__ == "__main__":
    import sys

    folder = sys.argv[1] if len(sys.argv) > 1 else "../link"
    subdirs = "--all" in sys.argv or "-a" in sys.argv

    paths = list_file_names(folder, include_subdirs=subdirs)
    for p in paths:
        print(p)
        format_text(p)
    print(f"\nTotal: {len(paths)} file(s)", file=sys.stderr)
