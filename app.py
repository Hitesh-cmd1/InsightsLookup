from datetime import date, datetime, timedelta, timezone
import random
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv
import jwt
from functools import wraps

load_dotenv()

# ... (rest of path setup remains same)

from flask import Flask, jsonify, request
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from db.models import get_db, init_db, Organization, Experience, Role, User, OTP


app = Flask(__name__)
JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "your-super-secret-key-change-it")

# Initialize Rate Limiter
limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    default_limits=["500 per day", "100 per hour"],
    storage_uri="memory://",
)

@limiter.request_filter
def exempt_options():
    return request.method == "OPTIONS"

@app.errorhandler(429)
def ratelimit_handler(e):
    return jsonify({"error": "Too many requests. Please try again later.", "description": str(e.description)}), 429

@app.after_request
def _add_cors(resp):
    # For security with credentials=True, we cannot use "*"
    origin = request.headers.get("Origin")
    if origin:
        resp.headers["Access-Control-Allow-Origin"] = origin
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Credentials"] = "true"
    return resp

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.cookies.get("auth_token")

        if not token:
            return jsonify({"error": "Auth token is missing"}), 401

        try:
            data = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
            # In a production app, you might query the user from the DB here:
            # current_user = db.query(User).filter(User.id == data["user_id"]).first()
            # But for simple stateless auth, the token data is enough.
        except Exception:
            return jsonify({"error": "Token is invalid or expired"}), 401

        return f(*args, **kwargs)

    return decorated


def send_otp_email(receiver_email, otp_code):
    sender_email = "insightslookup@gmail.com"
    sender_password = "chxh lmbs fuhb ertp"

    if not sender_email or not sender_password:
        print("SMTP_EMAIL or SMTP_PASSWORD not set. Cannot send email.")
        return False

    message = MIMEMultipart("alternative")
    message["Subject"] = f"Your Insights Login Code: {otp_code}"
    message["From"] = sender_email
    message["To"] = receiver_email

    text = f"Your one-time password is: {otp_code} It will expire in 10 minutes."
    html = f"""
    <html>
      <body style="font-family: sans-serif; color: #1C1917;">
        <div style="max-width: 400px; padding: 20px; border: 1px solid #E7E5E4; border-radius: 12px;">
          <h2 style="font-family: 'Playfair Display', serif; color: #1C1917;">Insights Login</h2>
          <p>Your one-time password is:</p>
          <div style="background-color: #F5F5F4; padding: 15px; border-radius: 8px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 4px;">
            {otp_code}
          </div>
          <p style="color: #78716C; font-size: 14px; margin-top: 20px;">This code will expire in 10 minutes.</p>
        </div>
      </body>
    </html>
    """
    message.attach(MIMEText(text, "plain"))
    message.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(sender_email, sender_password)
            server.sendmail(sender_email, receiver_email, message.as_string())
        return True
    except Exception as e:
        print(f"Error sending email: {e}")
        return False


@app.post("/request-otp")
@limiter.limit("5 per minute")
def request_otp():
    """
    POST /request-otp
    Payload: {"email": "..."}
    """
    data = request.json
    email = data.get("email")
    if not email:
        return jsonify({"error": "Email is required"}), 400

    for db in get_db():
        # Check for existing OTP request
        existing_otp = db.query(OTP).filter(OTP.email == email).first()
        now = datetime.now(timezone.utc)

        if existing_otp:
            # If the last attempt was over an hour ago OR the current OTP is expired, 
            # we can consider resetting the resend count to allow a fresh start.
            was_long_ago = existing_otp.last_sent_at and now > existing_otp.last_sent_at + timedelta(hours=1)
            
            if was_long_ago:
                existing_otp.resend_count = 0

            # Rule: OTP resend allowed after 60 sec
            if existing_otp.last_sent_at and now < existing_otp.last_sent_at + timedelta(seconds=60):
                seconds_left = int((existing_otp.last_sent_at + timedelta(seconds=60) - now).total_seconds())
                return jsonify({"error": f"Please wait {seconds_left} seconds before resending"}), 429
            
            # Rule: Max resend = 5 times
            if existing_otp.resend_count >= 5:
                return jsonify({"error": "Max resend limit reached. Try again later after an hour."}), 429
            
            # Update existing OTP
            code = f"{random.randint(100000, 999999)}"
            existing_otp.code = code
            existing_otp.resend_count += 1
            existing_otp.last_sent_at = now
            existing_otp.expires_at = now + timedelta(minutes=10)
        else:
            # Create new OTP entry
            code = f"{random.randint(100000, 999999)}"
            new_otp = OTP(
                email=email,
                code=code,
                expires_at=now + timedelta(minutes=10),
                last_sent_at=now,
                resend_count=0
            )
            db.add(new_otp)
        
        db.commit()
        # In a real app, send actual email. For now, we print to console.
        print(f"DEBUG: OTP for {email} is {code}")
        
        # Send actual SMTP email
        sent = send_otp_email(email, code)
        if not sent:
             # If email fails but we have no credentials, we still log for debug
             # but maybe notify the client that delivery might be delayed if we expect it to work.
             pass

        return jsonify({"message": "OTP sent successfully"}), 200


@app.post("/verify-otp")
@limiter.limit("5 per minute")
def verify_otp():
    """
    POST /verify-otp
    Payload: {"email": "...", "code": "..."}
    """
    data = request.json
    email = data.get("email")
    code = data.get("code")

    if not email or not code:
        return jsonify({"error": "Email and code are required"}), 400

    for db in get_db():
        otp_entry = db.query(OTP).filter(OTP.email == email, OTP.code == code).first()
        
        if not otp_entry:
            return jsonify({"error": "Invalid OTP"}), 400
        
        if otp_entry.expires_at < datetime.now(timezone.utc):
            return jsonify({"error": "OTP expired"}), 400

        # Success! Clear OTP
        db.delete(otp_entry)

        # Handle user creation/lookup
        user = db.query(User).filter(User.email == email).first()
        if not user:
            # Rules: Profile name = text before “@”
            name = email.split("@")[0]
            user = User(email=email, name=name)
            db.add(user)
            db.commit()
            db.refresh(user)
        
        db.commit()
        
        # Issue JWT Token
        token = jwt.encode({
            "user_id": user.id,
            "email": user.email,
            "exp": datetime.now(timezone.utc) + timedelta(days=7)
        }, JWT_SECRET_KEY, algorithm="HS256")

        response = jsonify({
            "message": "Logged in successfully",
            "user": {
                "id": user.id,
                "email": user.email,
                "name": user.name
            }
        })
        
        # Set token in an HttpOnly cookie
        response.set_cookie(
            "auth_token",
            token,
            httponly=True,
            secure=False,  # Set to True in production (HTTPS)
            samesite="Lax",
            max_age=7 * 24 * 60 * 60  # 7 days
        )
        
        return response, 200


@app.post("/logout")
def logout():
    response = jsonify({"message": "Logged out successfully"})
    response.set_cookie("auth_token", "", expires=0)
    return response, 200


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
@token_required
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
    role_filter = request.args.get("role", type=str)

    start_date = parse_date(start_date_str)
    end_date = parse_date(end_date_str) if end_date_str else date.today()

    if start_date_str and not start_date:
        return jsonify({"error": "Invalid 'start_date' format. Use YYYY-MM-DD."}), 400
    if end_date_str and not end_date:
        return jsonify({"error": "Invalid 'end_date' format. Use YYYY-MM-DD."}), 400

    for db in get_db():
        # Resolve role IDs that match the optional role filter (if any)
        matching_role_ids: set[int] = set()
        if role_filter:
            role_filter_clean = role_filter.strip()
            if role_filter_clean:
                matching_roles = (
                    db.query(Role)
                    .filter(Role.name.ilike(f"%{role_filter_clean}%"))
                    .all()
                )
                matching_role_ids = {r.id for r in matching_roles}

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
        # Track which destination orgs have at least one hire into a role
        # matching the optional role filter (across any hop).
        role_match_org_ids: set[int] = set()

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

            # Collapse consecutive jobs at same org into a single 'hop'
            unique_hops = []
            for job in subsequent_jobs:
                if not unique_hops or job.organization_id != unique_hops[-1]["org_id"]:
                    unique_hops.append({
                        "org_id": job.organization_id,
                        "start_date": job.start_date,
                        "role_ids": {job.role_id} if job.role_id else set()
                    })
                else:
                    # Same company consecutively - append role to this hop
                    if job.role_id:
                        unique_hops[-1]["role_ids"].add(job.role_id)

            # Count hops (up to limit)
            for hop_idx, h_data in enumerate(unique_hops[:hops], start=1):
                if hop_idx not in hop_counts:
                    hop_counts[hop_idx] = {}
                org_id_dest = h_data["org_id"]
                if org_id_dest not in hop_counts[hop_idx]:
                    hop_counts[hop_idx][org_id_dest] = {"count": 0, "years": set()}
                hop_counts[hop_idx][org_id_dest]["count"] += 1
                # Track the year of transition (year of start_date)
                if h_data["start_date"]:
                    hop_counts[hop_idx][org_id_dest]["years"].add(h_data["start_date"].year)
                # If we have a role filter, mark orgs if ANY role in this hop matches.
                if matching_role_ids:
                    if any(rid in matching_role_ids for rid in h_data["role_ids"]):
                        role_match_org_ids.add(org_id_dest)

        # Fetch org names for all destination orgs
        all_dest_org_ids = set()
        for hop_map in hop_counts.values():
            all_dest_org_ids.update(hop_map.keys())

        if all_dest_org_ids:
            orgs = db.query(Organization).filter(Organization.id.in_(all_dest_org_ids)).all()
            org_name_by_id = {o.id: o.name for o in orgs}
        else:
            org_name_by_id = {}

        # Build a helper map of total counts across all hops for each destination org
        total_counts_by_org_id: dict[int, int] = {}
        for hop_num, org_map in hop_counts.items():
            for org_id_dest, data in org_map.items():
                total_counts_by_org_id[org_id_dest] = (
                    total_counts_by_org_id.get(org_id_dest, 0) + data["count"]
                )

        # Build final response with org ids/names (sorted by hop-specific count descending)
        result = {}
        for hop_num, org_map in sorted(hop_counts.items()):
            # Sort by hop-specific count (descending), then by org name (ascending) for ties
            sorted_orgs = sorted(
                org_map.items(),
                key=lambda x: (-x[1]["count"], org_name_by_id[x[0]])
            )
            # Return as list to preserve sort order
            result[str(hop_num)] = [
                {
                    "organization_id": org_id,
                    "organization": org_name_by_id[org_id],
                    "count": data["count"],
                    # Total number of people who reached this org across *all* hops
                    "total_count": total_counts_by_org_id.get(org_id, data["count"]),
                    "years": sorted(list(data["years"])),  # Convert set to sorted list
                    # True if at least one hire from the source org into a role
                    # whose name matches the optional `role` filter (any hop).
                    "role_match": org_id in role_match_org_ids,
                }
                for org_id, data in sorted_orgs
            ]

        return jsonify(result)


@app.get("/employee-transitions")
@token_required
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
    - role (str, optional): if provided, only return employees whose experience
      history contains this role name (case-insensitive match).

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
    role_filter = request.args.get("role", type=str)

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

            # Collapse consecutive jobs at same org into a single 'hop'
            unique_hops = []
            for job in subsequent_jobs:
                if not unique_hops or job.organization_id != unique_hops[-1].organization_id:
                    unique_hops.append(job)

            # Check if the employee reached dest_org at exactly the specified hop
            if hop <= len(unique_hops):
                target_job = unique_hops[hop - 1]  # hop is 1-indexed
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

        # Highlight employees who match the role filter (fuzzy match)
        # We NO LONGER filter out non-matching employees. We just flag them.
        if role_filter:
            role_filter_lower = role_filter.strip().lower()
            if role_filter_lower:
                for emp in matching_employees:
                    history = emp.get("experience_history", [])
                    has_role = any(
                        role_filter_lower in (exp.get("role") or "").lower()
                        for exp in history
                    )
                    emp["role_match"] = has_role
        else:
            # If no filter provided, no one is "highlighted" specifically (or all false)
            for emp in matching_employees:
                emp["role_match"] = False

        # Sort by employee name
        matching_employees.sort(key=lambda x: x["employee_name"])

        return jsonify(matching_employees)


@app.get("/alumni")
@token_required
def get_alumni():
    """
    GET /alumni?org_id=...&start_date=...&end_date=...

    Returns all employees who worked at the organization and their career paths.
    """
    org_id = request.args.get("org_id", type=int)
    if not org_id:
        return jsonify({"error": "Missing required query parameter 'org_id' (int)"}), 400

    start_date_str = request.args.get("start_date")
    end_date_str = request.args.get("end_date")

    start_date = parse_date(start_date_str)
    end_date = parse_date(end_date_str) if end_date_str else date.today()

    for db in get_db():
        # 1) Find all exit events from target org
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
            return jsonify([])

        employee_ids = list(set(e.employee_id for e in exit_stints))

        # 2) Fetch all experiences and employee names
        from db.models import Employee, School
        employees = db.query(Employee).filter(Employee.id.in_(employee_ids)).all()
        emp_name_by_id = {e.id: e.name for e in employees}

        all_exps = (
            db.query(Experience)
            .filter(
                Experience.employee_id.in_(employee_ids),
                Experience.organization_id.isnot(None),
            )
            .order_by(Experience.employee_id, Experience.start_date, Experience.id)
            .all()
        )

        org_ids = set(e.organization_id for e in all_exps if e.organization_id)
        orgs = db.query(Organization).filter(Organization.id.in_(org_ids)).all()
        org_name_by_id = {o.id: o.name for o in orgs}

        # 3) Group by employee and build transition path
        exps_by_emp = {}
        for exp in all_exps:
            exps_by_emp.setdefault(exp.employee_id, []).append(exp)

        alumni_list = []
        for emp_id in employee_ids:
            emp_exps = exps_by_emp.get(emp_id, [])
            # Find the exit from our target org
            target_exit = next((e for e in exit_stints if e.employee_id == emp_id), None)
            if not target_exit:
                continue

            # Path: jobs after the exit (collapsed consecutive orgs)
            path_jobs = []
            current_raw_jobs = [
                e for e in emp_exps
                if e.start_date and e.start_date >= target_exit.end_date
                and e.id != target_exit.id
            ]
            current_raw_jobs.sort(key=lambda x: (x.start_date, x.id))
            
            for job in current_raw_jobs:
                if not path_jobs or job.organization_id != path_jobs[-1].organization_id:
                    path_jobs.append(job)

            path = [org_name_by_id.get(j.organization_id, "Unknown") for j in path_jobs]

            alumni_list.append({
                "id": emp_id,
                "name": emp_name_by_id.get(emp_id, "Unknown"),
                "exited_year": target_exit.end_date.year,
                "path": path,
                "current_company": path[-1] if path else org_name_by_id.get(org_id)
            })

        alumni_list.sort(key=lambda x: x["name"])
        return jsonify(alumni_list)


if __name__ == "__main__":
    # Ensure tables exist, then run the dev server.
    init_db()
    app.run(host="0.0.0.0", port=5001, debug=True)