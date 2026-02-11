from __future__ import annotations

from datetime import date, datetime

# Allow running both:
# - python -m app        (if you later package it)
# - python app.py        (common)
# - python path/to/app.py (works from other cwd)
if __package__ is None or __package__ == "":  # pragma: no cover
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parent))

from flask import Flask, jsonify, request

from db.models import get_db, init_db, Organization, Experience


app = Flask(__name__)


def parse_date(date_str: str | None):
    """
    Parse ISO-style date (YYYY-MM-DD) strings into datetime.date.
    Returns None if the input is falsy or invalid.
    """
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return None


@app.get("/organizations")
def search_organizations():
    """
    GET /organizations?org_name=...

    Query params:
    - org_name (str, required): partial name to search for (case-insensitive).

    Response:
    [
      {"id": 1, "name": "Acme Corp"},
      ...
    ]
    """
    org_name = request.args.get("org_name", type=str)
    if not org_name:
        return (
            jsonify(
                {
                    "error": "Missing required query parameter 'org_name'",
                }
            ),
            400,
        )

    for db in get_db():
        matches = (
            db.query(Organization)
            .filter(Organization.name.ilike(f"%{org_name.strip()}%"))
            .order_by(Organization.name.asc())
            .limit(50)
            .all()
        )

        return jsonify(
            [
                {
                    "id": org.id,
                    "name": org.name,
                }
                for org in matches
            ]
        )


@app.get("/org-transitions")
def org_transitions():
    """
    GET /org-transitions?org_id=...&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&hops=N

    Tracks career transitions after employees leave an organization.

    Query params:
    - org_id (int, required): ID of the source organization.
    - start_date (str, optional): only consider exits whose end_date is
      on/after this date (YYYY-MM-DD).
    - end_date (str, optional): only consider exits whose end_date is
      on/before this date (YYYY-MM-DD). If omitted, assumes "today".
    - hops (int, optional): maximum number of hops to track (default: 3).

    Returns:
    {
      "1": {"Org A": 5, "Org B": 3},  # 5 people went to Org A as 1st hop
      "2": {"Org C": 2, "Org D": 4},  # 2 people went to Org C as 2nd hop
      ...
    }
    """
    org_id = request.args.get("org_id", type=int)
    if not org_id:
        return jsonify({"error": "Missing required query parameter 'org_id' (int)"}), 400

    start_date_str = request.args.get("start_date")
    end_date_str = request.args.get("end_date")
    hops = request.args.get("hops", type=int, default=3)

    start_date = parse_date(start_date_str)
    end_date = parse_date(end_date_str) if end_date_str else date.today()

    if start_date_str and not start_date:
        return jsonify({"error": "Invalid 'start_date' format. Use YYYY-MM-DD."}), 400
    if end_date_str and not end_date:
        return jsonify({"error": "Invalid 'end_date' format. Use YYYY-MM-DD."}), 400

    for db in get_db():
        # 1) Find all exit events from target org in the period
        exit_query = db.query(Experience).filter(
            Experience.organization_id == org_id,
            Experience.end_date.isnot(None),
        )
        if start_date:
            exit_query = exit_query.filter(Experience.end_date >= start_date)
        if end_date:
            exit_query = exit_query.filter(Experience.end_date <= end_date)

        exit_stints = exit_query.all()
        if not exit_stints:
            return jsonify({})

        # Get all employee IDs who exited
        employee_ids = [e.employee_id for e in exit_stints]

        # 2) Fetch all experiences for these employees
        all_exps = (
            db.query(Experience)
            .filter(
                Experience.employee_id.in_(employee_ids),
                Experience.organization_id.isnot(None),
            )
            .order_by(Experience.employee_id, Experience.start_date, Experience.id)
            .all()
        )

        # Group by employee
        exps_by_emp = {}
        for exp in all_exps:
            exps_by_emp.setdefault(exp.employee_id, []).append(exp)

        # Track transitions: {hop_number: {org_id: {"count": N, "years": [2020, 2021, ...]}}}
        hop_counts = {}

        for exit_stint in exit_stints:
            emp_id = exit_stint.employee_id
            exit_end = exit_stint.end_date

            # Get this employee's experiences
            emp_exps = exps_by_emp.get(emp_id, [])

            # Find jobs that started after this exit
            subsequent_jobs = [
                exp for exp in emp_exps
                if exp.start_date and exp.start_date >= exit_end
                and exp.id != exit_stint.id  # Skip the exit stint itself
            ]

            # Sort by start date to get chronological order
            subsequent_jobs.sort(key=lambda x: (x.start_date, x.id))

            # Count hops (up to limit)
            for hop_idx, job in enumerate(subsequent_jobs[:hops], start=1):
                if hop_idx not in hop_counts:
                    hop_counts[hop_idx] = {}
                org_id_dest = job.organization_id
                if org_id_dest not in hop_counts[hop_idx]:
                    hop_counts[hop_idx][org_id_dest] = {"count": 0, "years": set()}
                hop_counts[hop_idx][org_id_dest]["count"] += 1
                # Track the year of transition (year of start_date)
                if job.start_date:
                    hop_counts[hop_idx][org_id_dest]["years"].add(job.start_date.year)

        # Fetch org names for all destination orgs
        all_dest_org_ids = set()
        for hop_map in hop_counts.values():
            all_dest_org_ids.update(hop_map.keys())

        if all_dest_org_ids:
            orgs = db.query(Organization).filter(Organization.id.in_(all_dest_org_ids)).all()
            org_name_by_id = {o.id: o.name for o in orgs}
        else:
            org_name_by_id = {}

        # Build final response with org names (sorted by count descending)
        result = {}
        for hop_num, org_map in sorted(hop_counts.items()):
            # Sort by count (descending), then by org name (ascending) for ties
            sorted_orgs = sorted(
                org_map.items(), 
                key=lambda x: (-x[1]["count"], org_name_by_id[x[0]])
            )
            # Return as list to preserve sort order
            result[str(hop_num)] = [
                {
                    "organization": org_name_by_id[org_id], 
                    "count": data["count"],
                    "years": sorted(list(data["years"]))  # Convert set to sorted list
                }
                for org_id, data in sorted_orgs
            ]

        return jsonify(result)


@app.get("/employee-transitions")
def employee_transitions():
    """
    GET /employee-transitions?source_org_id=...&dest_org_id=...&hop=N&start_date=...&end_date=...

    Find employees who transitioned from source org to destination org
    in exactly N hops within a specific timeframe.

    Query params:
    - source_org_id (int, required): ID of the source organization.
    - dest_org_id (int, required): ID of the destination organization.
    - hop (int, required): Exact hop number (1 = immediate next job, 2 = job after that, etc).
    - start_date (str, optional): only consider exits whose end_date is on/after this date (YYYY-MM-DD).
    - end_date (str, optional): only consider exits whose end_date is on/before this date (YYYY-MM-DD).

    Returns:
    [
      {
        "employee_id": 123,
        "employee_name": "John Doe",
        "exit_date": "2020-05-15",
        "transition_date": "2020-06-01"
      },
      ...
    ]
    """
    source_org_id = request.args.get("source_org_id", type=int)
    dest_org_id = request.args.get("dest_org_id", type=int)
    hop = request.args.get("hop", type=int)
    start_date_str = request.args.get("start_date")
    end_date_str = request.args.get("end_date")

    if not source_org_id:
        return jsonify({"error": "Missing required query parameter 'source_org_id' (int)"}), 400
    if not dest_org_id:
        return jsonify({"error": "Missing required query parameter 'dest_org_id' (int)"}), 400
    if not hop or hop < 1:
        return jsonify({"error": "Missing or invalid 'hop' parameter (must be >= 1)"}), 400

    start_date = parse_date(start_date_str)
    end_date = parse_date(end_date_str) if end_date_str else date.today()

    if start_date_str and not start_date:
        return jsonify({"error": "Invalid 'start_date' format. Use YYYY-MM-DD."}), 400
    if end_date_str and not end_date:
        return jsonify({"error": "Invalid 'end_date' format. Use YYYY-MM-DD."}), 400

    for db in get_db():
        # Find all exits from source org (with optional date filtering)
        exit_query = db.query(Experience).filter(
            Experience.organization_id == source_org_id,
            Experience.end_date.isnot(None),
        )
        if start_date:
            exit_query = exit_query.filter(Experience.end_date >= start_date)
        if end_date:
            exit_query = exit_query.filter(Experience.end_date <= end_date)
        
        exit_stints = exit_query.all()

        if not exit_stints:
            return jsonify([])

        # Get all employee IDs who exited
        employee_ids = [e.employee_id for e in exit_stints]

        # Fetch all experiences for these employees
        all_exps = (
            db.query(Experience)
            .filter(
                Experience.employee_id.in_(employee_ids),
                Experience.organization_id.isnot(None),
            )
            .order_by(Experience.employee_id, Experience.start_date, Experience.id)
            .all()
        )

        # Group by employee
        exps_by_emp = {}
        for exp in all_exps:
            exps_by_emp.setdefault(exp.employee_id, []).append(exp)

        # Find matching employees
        matching_employees = []

        for exit_stint in exit_stints:
            emp_id = exit_stint.employee_id
            exit_end = exit_stint.end_date

            # Get this employee's experiences
            emp_exps = exps_by_emp.get(emp_id, [])

            # Find jobs that started after this exit
            subsequent_jobs = [
                exp for exp in emp_exps
                if exp.start_date and exp.start_date >= exit_end
                and exp.id != exit_stint.id
            ]

            # Sort by start date
            subsequent_jobs.sort(key=lambda x: (x.start_date, x.id))

            # Check if the employee reached dest_org at exactly the specified hop
            if hop <= len(subsequent_jobs):
                target_job = subsequent_jobs[hop - 1]  # hop is 1-indexed
                if target_job.organization_id == dest_org_id:
                    # Build complete experience history in chronological order
                    history = []
                    for exp in emp_exps:
                        history.append({
                            "organization_id": exp.organization_id,
                            "role_id": exp.role_id,
                            "start_date": exp.start_date.isoformat() if exp.start_date else None,
                            "end_date": exp.end_date.isoformat() if exp.end_date else None,
                        })
                    
                    matching_employees.append({
                        "employee_id": emp_id,
                        "exit_date": exit_end.isoformat() if exit_end else None,
                        "transition_date": target_job.start_date.isoformat() if target_job.start_date else None,
                        "experience_history": history,
                    })

        # Fetch employee names, organization names, and role names
        if matching_employees:
            emp_ids = [e["employee_id"] for e in matching_employees]
            from db.models import Employee, Role
            employees = db.query(Employee).filter(Employee.id.in_(emp_ids)).all()
            emp_name_by_id = {e.id: e.name for e in employees}

            # Collect all org and role IDs from experience histories
            all_org_ids = set()
            all_role_ids = set()
            for emp in matching_employees:
                for exp in emp["experience_history"]:
                    if exp["organization_id"]:
                        all_org_ids.add(exp["organization_id"])
                    if exp["role_id"]:
                        all_role_ids.add(exp["role_id"])

            # Fetch org and role names
            orgs = db.query(Organization).filter(Organization.id.in_(all_org_ids)).all()
            org_name_by_id = {o.id: o.name for o in orgs}

            roles = db.query(Role).filter(Role.id.in_(all_role_ids)).all()
            role_name_by_id = {r.id: r.name for r in roles}

            # Add names to results
            for emp in matching_employees:
                emp["employee_name"] = emp_name_by_id.get(emp["employee_id"], "Unknown")
                # Add names to experience history
                for exp in emp["experience_history"]:
                    exp["organization"] = org_name_by_id.get(exp["organization_id"], "Unknown")
                    exp["role"] = role_name_by_id.get(exp["role_id"], "Unknown") if exp["role_id"] else None
                    # Remove IDs from response
                    del exp["organization_id"]
                    del exp["role_id"]

        # Sort by employee name
        matching_employees.sort(key=lambda x: x["employee_name"])

        return jsonify(matching_employees)


if __name__ == "__main__":
    # Ensure tables exist, then run the dev server.
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=True)