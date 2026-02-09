import argparse
from fetch_people import get_people

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Call an API with cookies and CSRF header")

    parser.add_argument("--queryId", required=True, help="Query ID")
    parser.add_argument("--cookie", required=True, help="Cookie value")
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)

    args = parser.parse_args()
    start = int(args.start)
    end = int(args.end)
    while start < end:
        get_people(args.queryId, args.cookie, start)
        start= start + 10