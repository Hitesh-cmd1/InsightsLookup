import argparse
import json
import re
import time
from typing import Dict, List, Optional, Tuple

import requests
from dotenv import load_dotenv
from rapidfuzz import fuzz
from sqlalchemy import text

from db.models import Organization, SessionLocal, engine

load_dotenv()

SEARCH_URL = "https://www.ghostgenius.fr/tools/search-sales-navigator-companies-id"

DEFAULT_HEADERS = {
    "accept": "text/x-component",
    "accept-language": "en-IN,en;q=0.6",
    "content-type": "text/plain;charset=UTF-8",
    "next-action": "7f302ccf52e68f401ec9ac42d1d417ce5e8d9ad35c",
    "next-router-state-tree": "%5B%22%22%2C%7B%22children%22%3A%5B%22(home)%22%2C%7B%22children%22%3A%5B%22tools%22%2C%7B%22children%22%3A%5B%5B%22slug%22%2C%22search-sales-navigator-companies-id%22%2C%22d%22%5D%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2C%22%2Ftools%2Fsearch-sales-navigator-companies-id%22%2C%22refresh%22%5D%7D%5D%7D%5D%7D%5D%7D%2Cnull%2Cnull%2Ctrue%5D",
    "origin": "https://www.ghostgenius.fr",
    "priority": "u=1, i",
    "referer": "https://www.ghostgenius.fr/tools/search-sales-navigator-companies-id",
    "sec-ch-ua": '"Not:A-Brand";v="99", "Brave";v="145", "Chromium";v="145"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "sec-gpc": "1",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    "x-deployment-id": "dpl_4gHFvNX8xPXnn9vKqnzcCouXZF29",
}

LEGAL_SUFFIXES = {
    "inc",
    "inc.",
    "llc",
    "l.l.c",
    "ltd",
    "ltd.",
    "limited",
    "corp",
    "corp.",
    "corporation",
    "co",
    "co.",
    "company",
    "group",
    "holdings",
    "plc",
    "pvt",
    "pvt.",
    "private",
}


def ensure_column_exists() -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE organizations "
                "ADD COLUMN IF NOT EXISTS linkedin_org_id VARCHAR NULL"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_organizations_linkedin_org_id "
                "ON organizations (linkedin_org_id)"
            )
        )


def parse_x_component_payload(raw_text: str) -> List[Dict]:
    results: List[Dict] = []

    for line in raw_text.splitlines():
        line = line.strip()
        if not line:
            continue

        payload = line
        match = re.match(r"^\d+:(.*)$", line)
        if match:
            payload = match.group(1).strip()

        try:
            obj = json.loads(payload)
        except json.JSONDecodeError:
            continue

        if isinstance(obj, dict) and isinstance(obj.get("data"), list):
            for item in obj["data"]:
                if (
                    isinstance(item, dict)
                    and item.get("id") is not None
                    and item.get("name")
                ):
                    results.append(item)

    return results


def normalize_org_name(name: str) -> str:
    text_value = (name or "").lower()
    text_value = re.sub(r"[^\w\s]", " ", text_value)
    parts = [p for p in text_value.split() if p and p not in LEGAL_SUFFIXES]
    return " ".join(parts).strip()


def score_match(source_name: str, candidate_name: str) -> float:
    source_norm = normalize_org_name(source_name)
    candidate_norm = normalize_org_name(candidate_name)

    if not source_norm or not candidate_norm:
        return 0.0

    if source_norm == candidate_norm:
        return 100.0

    wratio = fuzz.WRatio(source_norm, candidate_norm)
    token_set = fuzz.token_set_ratio(source_norm, candidate_norm)
    partial = fuzz.partial_ratio(source_norm, candidate_norm)

    return 0.5 * wratio + 0.35 * token_set + 0.15 * partial


def choose_best_match(
    org_name: str, candidates: List[Dict]
) -> Tuple[Optional[Dict], float]:
    best = None
    best_score = -1.0

    for candidate in candidates:
        candidate_name = str(candidate.get("name", "")).strip()
        if not candidate_name:
            continue
        score = score_match(org_name, candidate_name)
        if score > best_score:
            best_score = score
            best = candidate

    if best is None:
        return None, 0.0
    return best, best_score


def search_org_candidates(org_name: str, timeout: int = 30) -> List[Dict]:
    payload = json.dumps([{"keywords": org_name}])
    response = requests.post(
        SEARCH_URL,
        headers=DEFAULT_HEADERS,
        data=payload,
        timeout=timeout,
    )
    response.raise_for_status()
    return parse_x_component_payload(response.text)


def populate_linkedin_org_ids(
    min_score: float,
    limit: Optional[int],
    dry_run: bool,
    start_id: Optional[int],
    end_id: Optional[int],
    sleep_seconds: float,
) -> None:
    ensure_column_exists()
    db = SessionLocal()

    try:
        query = db.query(Organization).order_by(Organization.id.asc())
        query = query.filter(Organization.linkedin_org_id.is_(None))
        if start_id is not None:
            query = query.filter(Organization.id >= start_id)
        if end_id is not None:
            query = query.filter(Organization.id <= end_id)
        if limit:
            query = query.limit(limit)

        organizations = query.all()
        total = len(organizations)
        print(f"Found {total} organizations to process.")

        updated = 0
        skipped = 0
        failed = 0

        for idx, org in enumerate(organizations, start=1):
            org_name = (org.name or "").strip()
            if not org_name:
                skipped += 1
                continue
            if org.linkedin_org_id:
                skipped += 1
                print(f"[{idx}/{total}] SKIP  {org_name}: linkedin_org_id already exists")
                continue

            try:
                candidates = search_org_candidates(org_name)
            except Exception as exc:
                failed += 1
                print(f"[{idx}/{total}] ERROR {org_name}: {exc}")
                continue

            best, best_score = choose_best_match(org_name, candidates)

            if not best:
                skipped += 1
                print(f"[{idx}/{total}] SKIP  {org_name}: no candidates")
                time.sleep(sleep_seconds)
                continue

            best_id = str(best.get("id"))
            best_name = str(best.get("name", ""))

            if best_score < min_score:
                skipped += 1
                print(
                    f"[{idx}/{total}] SKIP  {org_name}: best '{best_name}' "
                    f"(id={best_id}, score={best_score:.1f}) below min_score={min_score}"
                )
                time.sleep(sleep_seconds)
                continue

            print(
                f"[{idx}/{total}] MATCH {org_name} -> {best_name} "
                f"(id={best_id}, score={best_score:.1f})"
            )

            if not dry_run:
                org.linkedin_org_id = best_id
                db.add(org)
                db.commit()
            updated += 1

            time.sleep(sleep_seconds)

        print(
            f"Done. updated={updated}, skipped={skipped}, failed={failed}, total={total}, "
            f"dry_run={dry_run}"
        )
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Populate organizations.linkedin_org_id by matching org names against "
            "GhostGenius Sales Navigator company id search."
        )
    )
    parser.add_argument(
        "--min-score",
        type=float,
        default=78.0,
        help="Minimum similarity score (0-100) to accept a match. Default: 78.0",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process only first N organizations.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show matches without saving to DB.",
    )
    parser.add_argument(
        "--start",
        type=int,
        default=None,
        help="Start organizations.id (inclusive).",
    )
    parser.add_argument(
        "--end",
        type=int,
        default=None,
        help="End organizations.id (inclusive).",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.35,
        help="Sleep between API calls in seconds. Default: 0.35",
    )

    args = parser.parse_args()
    populate_linkedin_org_ids(
        min_score=args.min_score,
        limit=args.limit,
        dry_run=args.dry_run,
        start_id=args.start,
        end_id=args.end,
        sleep_seconds=args.sleep,
    )


if __name__ == "__main__":
    main()
