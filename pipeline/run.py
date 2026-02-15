import argparse

# Allow running both:
# - python3 -m pipeline.run  (recommended)
# - python3 pipeline/run.py  (works via path shim below)
if __package__ is None or __package__ == "":  # pragma: no cover
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.fetch_people import get_people

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Call an API with cookies and CSRF header")

    parser.add_argument("--cookie", required=True, help="Cookie value")
    parser.add_argument("--start")
    parser.add_argument("--school_id")
    parser.add_argument("--past_org")
    parser.add_argument("--keyword")
    parser.add_argument("--end", required=True)

    args = parser.parse_args()
    if args.start:
        start = int(args.start)
    else:
        start = 0
    end = int(args.end)
    while start < end:
        get_people(args.cookie, start, args.school_id, args.past_org, args.keyword)
        start= start + 3