from datetime import date, datetime, timedelta, timezone
import random
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from functools import wraps

import jwt
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_file
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from sqlalchemy import func
from rapidfuzz import process, fuzz

from db.models import (
    get_db,
    init_db,
    Organization,
    Experience,
    Role,
    User,
    OTP,
    TrueOrganization,
    TrueRole,
    TrueSchool,
    TrueExperience,
    TrueEducation,
    TrueSkill,
    SessionLocal,
    Employee,
    School,
    Education,
)
from pipeline.format_data import parse_resume_for_user
from pipeline.save import parse_tenure, parse_degree

load_dotenv()


app = Flask(__name__)
JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "your-super-secret-key-change-it")

# Initialize Rate Limiter
limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    default_limits=["500 per day", "200 per hour"],
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
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    resp.headers["Access-Control-Allow-Credentials"] = "true"
    return resp

@app.route("/<path:path>", methods=["OPTIONS"])
@app.route("/", methods=["OPTIONS"])
def handle_options(path=""):
    """Handle CORS preflight requests from browser when calling Flask directly (cross-origin)."""
    return "", 204


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization")
        token = None
        
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]

        if not token:
            return jsonify({"error": "Auth token is missing"}), 401

        try:
            data = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
            # Attach minimal user context to the request for downstream handlers.
            request.current_user = {
                "id": data.get("user_id"),
                "email": data.get("email"),
            }
        except Exception:
            return jsonify({"error": "Token is invalid or expired"}), 401

        return f(*args, **kwargs)

    return decorated


def send_otp_email(receiver_email, otp_code):
    sender_email = os.environ.get("SMTP_EMAIL")
    sender_password = os.environ.get("SMTP_PASSWORD")
    smtp_host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.environ.get("SMTP_PORT", "465"))
    smtp_use_ssl = os.environ.get("SMTP_USE_SSL", "true").lower() == "true"
    smtp_use_tls = os.environ.get("SMTP_USE_TLS", "false").lower() == "true"

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
        if smtp_use_ssl:
            server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=10)
        else:
            server = smtplib.SMTP(smtp_host, smtp_port, timeout=10)
            if smtp_use_tls:
                server.starttls()

        with server:
            server.login(sender_email, sender_password)
            server.sendmail(sender_email, receiver_email, message.as_string())
        print(f"Email sent successfully to {receiver_email}")
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
        
        if not send_otp_email(email, code):
            db.rollback()
            return jsonify({"error": "Failed to send OTP email. Please try again."}), 502

        db.commit()

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
        is_new_user = False
        if not user:
            # Rules: Profile name = text before “@”
            name = email.split("@")[0]
            user = User(email=email, name=name)
            db.add(user)
            db.commit()
            db.refresh(user)
            is_new_user = True

        db.commit()

        # Issue JWT Token
        token = jwt.encode({
            "user_id": user.id,
            "email": user.email,
            "exp": datetime.now(timezone.utc) + timedelta(days=7)
        }, JWT_SECRET_KEY, algorithm="HS256")

        return jsonify({
            "message": "Logged in successfully",
            "token": token,
            "is_new_user": is_new_user,
            "user": {
                "id": user.id,
                "email": user.email,
                "name": user.name
            }
        }), 200


@app.post("/logout")
def logout():
    return jsonify({"message": "Logged out successfully"}), 200


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


def _parse_connection_filters():
    """Parse connection_filters from request (JSON). Returns None if missing/invalid."""
    raw = request.args.get("connection_filters")
    if not raw:
        return None
    try:
        import json
        data = json.loads(raw)
        if not isinstance(data, dict):
            return None
        return {
            "past_companies": list(data.get("past_companies") or []) if isinstance(data.get("past_companies"), list) else [],
            "past_roles": list(data.get("past_roles") or []) if isinstance(data.get("past_roles"), list) else [],
            "tenure_options": list(data.get("tenure_options") or []) if isinstance(data.get("tenure_options"), list) else [],
            "colleges": list(data.get("colleges") or []) if isinstance(data.get("colleges"), list) else [],
            "departments": list(data.get("departments") or []) if isinstance(data.get("departments"), list) else [],
            "batch_options": list(data.get("batch_options") or []) if isinstance(data.get("batch_options"), list) else [],
        }
    except Exception:
        return None


def _get_user_profile_filter_data(db, user_id):
    """Load current user's profile for connection filtering: companies, roles, colleges, degrees, and stints."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return None
    _ = user.true_experiences, user.true_educations
    company_stints = []
    company_names = set()
    role_names = set()
    for te in user.true_experiences:
        org_name = te.organization.name if te.organization else None
        role_name = te.role.name if te.role else None
        if org_name:
            company_names.add(org_name)
        if role_name:
            role_names.add(role_name)
        if org_name and (te.start_date or te.end_date):
            company_stints.append({
                "company": org_name,
                "start": te.start_date,
                "end": te.end_date,
            })
    education_stints = []
    college_names = set()
    degree_names = set()
    for ed in user.true_educations:
        school_name = ed.school.name if ed.school else None
        deg = (ed.degree or "").strip()
        if school_name:
            college_names.add(school_name)
        if deg:
            degree_names.add(deg)
        if school_name:
            education_stints.append({
                "college": school_name,
                "degree": deg,
                "start_year": ed.start_date.year if ed.start_date else None,
                "end_year": ed.end_date.year if ed.end_date else None,
            })
    return {
        "company_names": company_names,
        "role_names": role_names,
        "company_stints": company_stints,
        "college_names": college_names,
        "degree_names": degree_names,
        "education_stints": education_stints,
    }


def _alumni_pass_connection_filters(
    db,
    user_id,
    employee_ids,
    exps_by_emp,
    edus_by_emp,
    filters,
    org_names=None,
    role_names=None,
    school_names=None,
    return_details=False,
):
    """
    Return a map of employee_id -> bool (is_match) for connection filters.
    filters: dict with past_companies, past_roles, tenure_options, colleges, departments, batch_options (lists).
    Logic: (past_company OR) AND (past_role OR) AND (tenure OR) AND (college OR) AND (dept OR) AND (batch OR).
    """
    if not employee_ids:
        return ({}, {}) if return_details else {}
    if not filters:
        all_true = {emp_id: True for emp_id in employee_ids}
        if return_details:
            return all_true, {emp_id: {"work_matches": [], "education_matches": []} for emp_id in employee_ids}
        return all_true
    profile = _get_user_profile_filter_data(db, user_id)
    if not profile:
        all_true = {emp_id: True for emp_id in employee_ids}
        if return_details:
            return all_true, {emp_id: {"work_matches": [], "education_matches": []} for emp_id in employee_ids}
        return all_true

    past_companies = [str(x).strip() for x in (filters.get("past_companies") or []) if x]
    past_roles = [str(x).strip() for x in (filters.get("past_roles") or []) if x]
    tenure_opts = list(filters.get("tenure_options") or [])
    colleges = [str(x).strip() for x in (filters.get("colleges") or []) if x]
    departments = [str(x).strip() for x in (filters.get("departments") or []) if x]
    batch_opts = list(filters.get("batch_options") or [])

    user_stints_by_company = {s["company"]: (s["start"], s["end"]) for s in profile["company_stints"]}
    user_edu_ranges = profile["education_stints"]
    user_stints_by_company_id = {}
    user_edu_ranges_by_school_id = {}
    selected_company_org_ids = set()
    selected_school_ids = set()

    # Resolve selected profile names to matched IDs so filters still work when scraped names differ.
    user = db.query(User).filter(User.id == user_id).first() if user_id else None
    if user:
        _ = user.true_experiences, user.true_educations
        selected_company_names = set(past_companies)
        selected_college_names = set(colleges)
        for te in user.true_experiences:
            if not te.organization:
                continue
            mid = te.organization.matched_org_id
            if mid:
                user_stints_by_company_id[mid] = (te.start_date, te.end_date)
            if selected_company_names and te.organization.name in selected_company_names and mid:
                selected_company_org_ids.add(mid)
        for ed in user.true_educations:
            if not ed.school:
                continue
            sid = ed.school.matched_school_id
            if sid:
                user_edu_ranges_by_school_id.setdefault(sid, []).append({
                    "start_year": ed.start_date.year if ed.start_date else None,
                    "end_year": ed.end_date.year if ed.end_date else None,
                })
            if selected_college_names and ed.school.name in selected_college_names and sid:
                selected_school_ids.add(sid)

    if past_companies:
        for row in db.query(Organization.id).filter(Organization.name.in_(past_companies)).all():
            selected_company_org_ids.add(row[0])
    if colleges:
        for row in db.query(School.id).filter(School.name.in_(colleges)).all():
            selected_school_ids.add(row[0])

    def _norm(text):
        return " ".join(str(text or "").strip().lower().split())

    def _token_set(text):
        return {t for t in _norm(text).replace("/", " ").replace("-", " ").split(" ") if t}

    def _is_similar(a, b, threshold=60):
        a_n = _norm(a)
        b_n = _norm(b)
        if not a_n or not b_n:
            return False
        if a_n == b_n:
            return True
        ratio = fuzz.ratio(a_n, b_n)
        partial = fuzz.partial_ratio(a_n, b_n)
        a_tokens = _token_set(a_n)
        b_tokens = _token_set(b_n)
        overlap = 0
        if a_tokens or b_tokens:
            overlap = (len(a_tokens & b_tokens) / max(1, len(a_tokens | b_tokens))) * 100
        return max(ratio, partial, overlap) >= threshold

    def tenure_matches(alumni_start, alumni_end, user_start, user_end, option):
        if option == "any-time":
            return True
        if not user_start and not user_end:
            return True
        if option == "with-me":
            if not alumni_start or not alumni_end:
                return False
            return (alumni_start < (user_end or date.max)) and ((alumni_end or date.min) > (user_start or date.min))
        if option == "near-me":
            if not alumni_end:
                return False
            low = (user_start or date.min) - timedelta(days=365 * 2) if user_start else date.min
            high = (user_end or date.max) + timedelta(days=365 * 2) if user_end else date.max
            return low <= alumni_end <= high
        return False

    def batch_matches(alumni_start_year, alumni_end_year, alumni_school_name, alumni_school_id):
        if not batch_opts or "any" in batch_opts:
            return True
        for u in user_edu_ranges:
            if u["college"] != alumni_school_name:
                continue
            u_start = u["start_year"]
            u_end = u["end_year"]
            if "exact" in batch_opts and alumni_start_year == u_start and alumni_end_year == u_end:
                return True
            if "close" in batch_opts and u_start is not None and alumni_start_year is not None:
                if abs(alumni_start_year - u_start) <= 4:
                    return True
        for u in user_edu_ranges_by_school_id.get(alumni_school_id, []):
            u_start = u["start_year"]
            u_end = u["end_year"]
            if "exact" in batch_opts and alumni_start_year == u_start and alumni_end_year == u_end:
                return True
            if "close" in batch_opts and u_start is not None and alumni_start_year is not None:
                if abs(alumni_start_year - u_start) <= 4:
                    return True
        if "any" in batch_opts:
            return True
        return False

    if org_names is None:
        org_names = {}
    if role_names is None:
        role_names = {}
    if exps_by_emp and (not org_names or not role_names):
        all_org_ids = set()
        all_role_ids = set()
        for exps in exps_by_emp.values():
            for e in exps:
                if e.organization_id:
                    all_org_ids.add(e.organization_id)
                if e.role_id:
                    all_role_ids.add(e.role_id)
        if all_org_ids:
            for o in db.query(Organization).filter(Organization.id.in_(all_org_ids)).all():
                org_names[o.id] = o.name
        if all_role_ids:
            for r in db.query(Role).filter(Role.id.in_(all_role_ids)).all():
                role_names[r.id] = r.name

    if school_names is None:
        school_names = {}
    if edus_by_emp and not school_names:
        all_school_ids = set()
        for edus in edus_by_emp.values():
            for e in edus:
                if e.school_id:
                    all_school_ids.add(e.school_id)
        if all_school_ids:
            for s in db.query(School).filter(School.id.in_(all_school_ids)).all():
                school_names[s.id] = s.name

    has_work_filters = bool(past_companies or past_roles or (tenure_opts and "any-time" not in tenure_opts))
    has_edu_filters = bool(colleges or departments or (batch_opts and "any" not in batch_opts))

    match_map = {}
    match_details = {}
    for emp_id in employee_ids:
        emp_exps = exps_by_emp.get(emp_id, [])
        emp_edus = edus_by_emp.get(emp_id, [])
        work_matches = []
        edu_matches = []

        # --- Check Work Section ---
        work_match = False
        if has_work_filters:
            for exp in emp_exps:
                org_name = org_names.get(exp.organization_id, "")
                role_name = role_names.get(exp.role_id, "")
                
                # Check company (if any selected)
                comp_ok = (
                    not past_companies
                    or (org_name in past_companies)
                    or (exp.organization_id in selected_company_org_ids)
                )
                # Check role (if any selected)
                role_ok = (
                    not past_roles
                    or any(_is_similar(role_name, selected_role, threshold=60) for selected_role in past_roles)
                )
                # Check tenure (if any selected)
                tenure_ok = not tenure_opts or "any-time" in tenure_opts
                if tenure_opts and "any-time" not in tenure_opts:
                    user_start, user_end = user_stints_by_company.get(org_name, (None, None))
                    if (not user_start and not user_end) and exp.organization_id:
                        user_start, user_end = user_stints_by_company_id.get(exp.organization_id, (None, None))
                    for opt in tenure_opts:
                        if tenure_matches(exp.start_date, exp.end_date, user_start, user_end, opt):
                            tenure_ok = True
                            break
                
                if comp_ok and role_ok and tenure_ok:
                    matched_fields = []
                    if past_companies and comp_ok:
                        matched_fields.append("company")
                    if past_roles and role_ok:
                        matched_fields.append("role")
                    if tenure_opts and tenure_ok:
                        matched_fields.append("tenure")
                    work_matches.append({
                        "organization": org_name or "Unknown",
                        "role": role_name or None,
                        "start_date": exp.start_date.isoformat() if exp.start_date else None,
                        "end_date": exp.end_date.isoformat() if exp.end_date else None,
                        "matched_fields": matched_fields,
                    })
                    # In work section, we match if ANY experience matches the selected filters
                    work_match = True
                    break
        
        # --- Check Education Section ---
        edu_match = False
        if has_edu_filters:
            for edu in emp_edus:
                school_name = school_names.get(edu.school_id, "")
                deg = (edu.degree or "").strip()
                start_y = edu.start_date.year if edu.start_date else None
                end_y = edu.end_date.year if edu.end_date else None
                
                school_ok = (
                    not colleges
                    or (school_name in colleges)
                    or (edu.school_id in selected_school_ids)
                )
                dept_ok = (
                    not departments
                    or any(_is_similar(deg, selected_dept, threshold=60) for selected_dept in departments)
                )
                batch_ok = not batch_opts or "any" in batch_opts or batch_matches(start_y, end_y, school_name, edu.school_id)
                
                if school_ok and dept_ok and batch_ok:
                    matched_fields = []
                    if colleges and school_ok:
                        matched_fields.append("college")
                    if departments and dept_ok:
                        matched_fields.append("department")
                    if batch_opts and batch_ok:
                        matched_fields.append("batch")
                    edu_matches.append({
                        "school": school_name or "Unknown",
                        "degree": deg or None,
                        "start_year": start_y,
                        "end_year": end_y,
                        "matched_fields": matched_fields,
                    })
                    edu_match = True
                    break

        # --- OR Logic Between Sections ---
        if has_work_filters and has_edu_filters:
            match_map[emp_id] = bool(work_match or edu_match)
        elif has_work_filters:
            match_map[emp_id] = bool(work_match)
        elif has_edu_filters:
            match_map[emp_id] = bool(edu_match)
        else:
            # No filters selected, everyone passes
            match_map[emp_id] = True
        match_details[emp_id] = {"work_matches": work_matches, "education_matches": edu_matches}
    if return_details:
        return match_map, match_details
    return match_map


@app.get("/dashboard-data")
@token_required
def dashboard_data():
    """
    GET /dashboard-data?org_id=...&start_date=...&end_date=...

    Returns in one response: filter_options (from profile), org-transitions, and alumni.
    Use when profile is filled to load dashboard quickly. Transitions and alumni are unfiltered.
    """
    org_id = request.args.get("org_id", type=int)
    if not org_id:
        return jsonify({"error": "Missing required query parameter 'org_id' (int)"}), 400
    start_date_str = request.args.get("start_date")
    end_date_str = request.args.get("end_date")
    hops = request.args.get("hops", type=int, default=3)
    role_filter = request.args.get("role", type=str)
    user_id = request.current_user.get("id") if getattr(request, "current_user", None) else None

    start_date = parse_date(start_date_str)
    end_date = parse_date(end_date_str) if end_date_str else date.today()

    for db in get_db():
        filter_options = {"companies": [], "roles": [], "colleges": [], "departments": []}
        if user_id:
            user = db.query(User).filter(User.id == user_id).first()
            if user:
                _ = user.true_experiences, user.true_educations
                seen_c, seen_r, seen_col, seen_d = set(), set(), set(), set()
                for te in user.true_experiences:
                    if te.organization and te.organization.name not in seen_c:
                        filter_options["companies"].append(te.organization.name)
                        seen_c.add(te.organization.name)
                    if te.role and te.role.name not in seen_r:
                        filter_options["roles"].append(te.role.name)
                        seen_r.add(te.role.name)
                for ed in user.true_educations:
                    if ed.school and ed.school.name not in seen_col:
                        filter_options["colleges"].append(ed.school.name)
                        seen_col.add(ed.school.name)
                    if ed.degree and (ed.degree or "").strip() and (ed.degree or "").strip() not in seen_d:
                        filter_options["departments"].append((ed.degree or "").strip())
                        seen_d.add((ed.degree or "").strip())

        # Reuse org_transitions logic without connection_filters to get transitions
        matching_role_ids = set()
        if role_filter:
            matching_roles = db.query(Role).filter(Role.name.ilike(f"%{role_filter.strip()}%")).all()
            matching_role_ids = {r.id for r in matching_roles}

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
            return jsonify({
                "filter_options": filter_options,
                "transitions": {},
                "alumni": [],
                "related_by_dest": {},
            })

        employee_ids = list(set(e.employee_id for e in exit_stints))
        all_exps = (
            db.query(Experience)
            .filter(
                Experience.employee_id.in_(employee_ids),
                Experience.organization_id.isnot(None),
            )
            .order_by(Experience.employee_id, Experience.start_date, Experience.id)
            .all()
        )
        exps_by_emp = {}
        for exp in all_exps:
            exps_by_emp.setdefault(exp.employee_id, []).append(exp)

        hop_counts = {}
        role_match_org_ids = set()
        transition_emp_ids_by_org = {}  # {org_id: set(emp_ids)}
        for exit_stint in exit_stints:
            emp_exps = exps_by_emp.get(exit_stint.employee_id, [])
            subsequent = [
                e for e in emp_exps
                if e.start_date and e.start_date >= exit_stint.end_date and e.id != exit_stint.id
            ]
            subsequent.sort(key=lambda x: (x.start_date, x.id))
            unique_hops = []
            for job in subsequent:
                if not unique_hops or job.organization_id != unique_hops[-1]["org_id"]:
                    unique_hops.append({"org_id": job.organization_id, "start_date": job.start_date, "role_ids": {job.role_id} if job.role_id else set()})
                elif job.role_id:
                    unique_hops[-1]["role_ids"].add(job.role_id)
            while unique_hops and unique_hops[0]["org_id"] == org_id:
                unique_hops.pop(0)
            for hop_idx, h_data in enumerate(unique_hops[:hops], start=1):
                if hop_idx not in hop_counts:
                    hop_counts[hop_idx] = {}
                oid = h_data["org_id"]
                transition_emp_ids_by_org.setdefault(oid, set()).add(exit_stint.employee_id)
                if oid not in hop_counts[hop_idx]:
                    hop_counts[hop_idx][oid] = {"count": 0, "years": set()}
                hop_counts[hop_idx][oid]["count"] += 1
                if h_data["start_date"]:
                    hop_counts[hop_idx][oid]["years"].add(h_data["start_date"].year)
                if matching_role_ids and any(rid in matching_role_ids for rid in h_data["role_ids"]):
                    role_match_org_ids.add(oid)

        all_dest_org_ids = set()
        for hop_map in hop_counts.values():
            all_dest_org_ids.update(hop_map.keys())
        org_name_by_id = {}
        if all_dest_org_ids:
            for o in db.query(Organization).filter(Organization.id.in_(all_dest_org_ids)).all():
                org_name_by_id[o.id] = o.name
        total_counts_by_org_id = {}
        for hop_map in hop_counts.values():
            for oid, data in hop_map.items():
                total_counts_by_org_id[oid] = total_counts_by_org_id.get(oid, 0) + data["count"]

        transitions = {}
        for hop_num, org_map in sorted(hop_counts.items()):
            sorted_orgs = sorted(org_map.items(), key=lambda x: (-x[1]["count"], org_name_by_id.get(x[0], "")))
            transitions[str(hop_num)] = [
                {
                    "organization_id": oid,
                    "organization": org_name_by_id.get(oid, "Unknown"),
                    "count": data["count"],
                    "total_count": total_counts_by_org_id.get(oid, data["count"]),
                    "years": sorted(list(data["years"])),
                    "role_match": oid in role_match_org_ids,
                }
                for oid, data in sorted_orgs
            ]

        # Alumni list (now fetched on-demand by /alumni endpoint)
        alumni_list = []

        # Compute related background counts for all dest orgs (batch, efficient)
        related_by_dest_raw = _compute_related_counts_for_dests(db, all_dest_org_ids, user_id, transition_emp_ids_by_org)
        # Serialize: keys must be strings for JSON, values keep count + related list
        related_by_dest = {
            str(org_id): {
                "count": v["count"],
                "match_count": v.get("match_count", v["count"]),
                "related": v["related"],
            }
            for org_id, v in related_by_dest_raw.items()
        }

        return jsonify({
            "filter_options": filter_options,
            "transitions": transitions,
            "alumni": alumni_list,
            "related_by_dest": related_by_dest,
        })


@app.get("/organizations")
def search_organizations():
    """
    GET /organizations?org_name=...

    Query params:
    - org_name (str, required): partial name to search for (case-insensitive).

    Response:
    [
      {"id": 1, "name": "Acme Corp", "alumni_count": 42},
      ...
    ]
    alumni_count = distinct employees who have left this org (experience with end_date set).
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

        if not matches:
            return jsonify([])

        org_ids = [org.id for org in matches]
        # Alumni = distinct employees who have left this org (experience with end_date set)
        count_rows = (
            db.query(
                Experience.organization_id,
                func.count(func.distinct(Experience.employee_id)),
            )
            .filter(
                Experience.organization_id.in_(org_ids),
                Experience.end_date.isnot(None),
            )
            .group_by(Experience.organization_id)
            .all()
        )
        alumni_count_by_org = {org_id: count for org_id, count in count_rows}

        return jsonify(
            [
                {
                    "id": org.id,
                    "name": org.name,
                    "alumni_count": alumni_count_by_org.get(org.id, 0),
                }
                for org in matches
                if alumni_count_by_org.get(org.id, 0) > 15
            ]
        )


@app.post("/linkedin-org-ids")
@token_required
def get_linkedin_org_ids():
    """
    POST /linkedin-org-ids
    Payload: {"company_names": ["Company A", "Company B", ...]}

    Returns numeric linkedin_org_id values for exact company-name matches (case-insensitive).
    Non-numeric/empty linkedin_org_id values are omitted.
    """
    data = request.json or {}
    names = data.get("company_names")
    if not isinstance(names, list):
        return jsonify({"error": "company_names must be an array"}), 400

    cleaned_names = [str(n).strip() for n in names if str(n).strip()]
    if not cleaned_names:
        return jsonify({"linkedin_org_ids": [], "by_company": {}})

    lower_to_original = {}
    for name in cleaned_names:
        key = name.lower()
        if key not in lower_to_original:
            lower_to_original[key] = name

    for db in get_db():
        rows = (
            db.query(Organization.name, Organization.linkedin_org_id)
            .filter(func.lower(Organization.name).in_(list(lower_to_original.keys())))
            .all()
        )

        by_company = {}
        ids = []
        for org_name, linkedin_org_id in rows:
            lid = str(linkedin_org_id).strip() if linkedin_org_id is not None else ""
            if not lid.isdigit():
                continue
            by_company[org_name] = lid
            ids.append(lid)

        unique_ids = list(dict.fromkeys(ids))
        return jsonify({"linkedin_org_ids": unique_ids, "by_company": by_company})


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
    include_related = request.args.get("include_related", type=str, default="")
    include_related = str(include_related).strip().lower() in ("1", "true", "yes")
    connection_filters = _parse_connection_filters()
    user_id = request.current_user.get("id") if getattr(request, "current_user", None) else None

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
        employee_ids = list(set(e.employee_id for e in exit_stints))

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
        transition_emp_ids_by_org = {}  # {org_id: set(emp_ids)}

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
            # (internal role changes at the same company do not count as separate hops)
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

            # Only count company changes: drop leading hops that are same as source org
            # (e.g. A Role1 -> A Role2 -> B: A->A is internal, so first transition is A->B = hop 1)
            effective_hops = list(unique_hops)
            while effective_hops and effective_hops[0]["org_id"] == org_id:
                effective_hops.pop(0)

            # Count hops (up to limit)
            for hop_idx, h_data in enumerate(effective_hops[:hops], start=1):
                if hop_idx not in hop_counts:
                    hop_counts[hop_idx] = {}
                org_id_dest = h_data["org_id"]
                transition_emp_ids_by_org.setdefault(org_id_dest, set()).add(emp_id)
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

        if include_related and user_id:
            # Batch-compute related background counts for all dest orgs
            all_dest_org_ids_set = set()
            for hop_map in hop_counts.values():
                all_dest_org_ids_set.update(hop_map.keys())
            related_by_dest_raw = _compute_related_counts_for_dests(
                db,
                all_dest_org_ids_set,
                user_id,
                transition_emp_ids_by_org,
                connection_filters=connection_filters,
            )
            related_by_dest = {
                str(org_id): {
                    "count": v["count"],
                    "match_count": v.get("match_count", v["count"]),
                    "related": v["related"],
                }
                for org_id, v in related_by_dest_raw.items()
            }
            result["related_by_dest"] = related_by_dest

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
    connection_filters = _parse_connection_filters()
    user_id = request.current_user.get("id") if getattr(request, "current_user", None) else None

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

            # Group consecutive jobs at same org (internal role changes don't count as hops)
            groups = []
            for job in subsequent_jobs:
                if not groups or job.organization_id != groups[-1][0].organization_id:
                    groups.append([job])
                else:
                    groups[-1].append(job)

            # Only count company changes: drop leading groups that are same as source org
            effective_groups = list(groups)
            while effective_groups and effective_groups[0][0].organization_id == source_org_id:
                effective_groups.pop(0)

            # Check if the employee reached dest_org at exactly the specified hop
            if hop <= len(effective_groups):
                target_group = effective_groups[hop - 1]
                target_job = target_group[0]
                if target_job.organization_id == dest_org_id:
                    # Segment each experience for highlighting: source, internal_at_source, hop_1, hop_2, prior
                    segment_by_exp_id = {}
                    segment_by_exp_id[exit_stint.id] = "source"
                    # Leading groups that match source org = internal (not counted as a hop)
                    n_dropped = 0
                    for grp in groups:
                        if grp[0].organization_id == source_org_id:
                            n_dropped += 1
                        else:
                            break
                    for exp in (e for grp in groups[:n_dropped] for e in grp):
                        segment_by_exp_id[exp.id] = "internal_at_source"
                    for i, grp in enumerate(groups[n_dropped:]):
                        for exp in grp:
                            segment_by_exp_id[exp.id] = f"hop_{i + 1}"

                    # Build complete experience history with transition_segment
                    history = []
                    for exp in emp_exps:
                        seg = segment_by_exp_id.get(exp.id, "prior")
                        history.append({
                            "organization_id": exp.organization_id,
                            "role_id": exp.role_id,
                            "start_date": exp.start_date.isoformat() if exp.start_date else None,
                            "end_date": exp.end_date.isoformat() if exp.end_date else None,
                            "transition_segment": seg,
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

        # Apply connection filters to transition people as match flags/details only (no removals).
        if matching_employees:
            transition_emp_ids = [emp["employee_id"] for emp in matching_employees]
            transition_exps_by_emp = {
                eid: exps_by_emp.get(eid, [])
                for eid in transition_emp_ids
            }
            all_edus = (
                db.query(Education)
                .filter(Education.employee_id.in_(transition_emp_ids))
                .all()
            )
            edus_by_emp = {}
            for edu in all_edus:
                edus_by_emp.setdefault(edu.employee_id, []).append(edu)
            for eid in transition_emp_ids:
                edus_by_emp.setdefault(eid, [])

            school_names = {}
            school_ids = {edu.school_id for edu in all_edus if edu.school_id}
            if school_ids:
                for s in db.query(School).filter(School.id.in_(school_ids)).all():
                    school_names[s.id] = s.name

            if connection_filters and user_id:
                transition_match_map, transition_match_details = _alumni_pass_connection_filters(
                    db,
                    user_id,
                    transition_emp_ids,
                    transition_exps_by_emp,
                    edus_by_emp,
                    connection_filters,
                    org_names=org_name_by_id if matching_employees else None,
                    role_names=role_name_by_id if matching_employees else None,
                    school_names=school_names,
                    return_details=True,
                )
            else:
                transition_match_map = {eid: False for eid in transition_emp_ids}
                transition_match_details = {eid: {"work_matches": [], "education_matches": []} for eid in transition_emp_ids}

            for emp in matching_employees:
                eid = emp["employee_id"]
                emp["is_match"] = bool(transition_match_map.get(eid, False))
                emp["filter_match_details"] = transition_match_details.get(
                    eid, {"work_matches": [], "education_matches": []}
                )

        # Sort by employee name
        matching_employees.sort(
            key=lambda x: (
                not x.get("is_match", False),
                not x.get("role_match", False),
                x["employee_name"],
            )
        )

        return jsonify(matching_employees)


@app.get("/alumni")
@token_required
def get_alumni():
    """
    GET /alumni?org_id=...&start_date=...&end_date=...&connection_filters=...

    Returns employees who worked at the organization and their career paths.
    Optional connection_filters (JSON) filters by profile-based connections.
    """
    org_id = request.args.get("org_id", type=int)
    if not org_id:
        return jsonify({"error": "Missing required query parameter 'org_id' (int)"}), 400

    start_date_str = request.args.get("start_date")
    end_date_str = request.args.get("end_date")
    connection_filters = _parse_connection_filters()
    user_id = request.current_user.get("id") if getattr(request, "current_user", None) else None

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

        # Connection filters: load educations and mark alumni matches (do not filter out)
        alumni_match_map = {eid: True for eid in employee_ids}
        if connection_filters and user_id:
            all_edus = (
                db.query(Education)
                .filter(Education.employee_id.in_(employee_ids))
                .all()
            )
            edus_by_emp = {}
            for edu in all_edus:
                edus_by_emp.setdefault(edu.employee_id, []).append(edu)
            for eid in employee_ids:
                if eid not in edus_by_emp:
                    edus_by_emp[eid] = []
            alumni_match_map = _alumni_pass_connection_filters(
                db, user_id, employee_ids, exps_by_emp, edus_by_emp, connection_filters
            )

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

            # Only count company changes: drop leading same as source (internal moves)
            path_jobs_effective = list(path_jobs)
            while path_jobs_effective and path_jobs_effective[0].organization_id == org_id:
                path_jobs_effective.pop(0)

            path = [org_name_by_id.get(j.organization_id, "Unknown") for j in path_jobs_effective]

            alumni_list.append({
                "id": emp_id,
                "name": emp_name_by_id.get(emp_id, "Unknown"),
                "exited_year": target_exit.end_date.year,
                "path": path,
                "current_company": path[-1] if path else org_name_by_id.get(org_id),
                "is_match": bool(alumni_match_map.get(emp_id, False)),
            })

        alumni_list.sort(key=lambda x: (not x.get("is_match", False), x["name"]))
        return jsonify(alumni_list)


def _get_user_matched_ids(db, user_id):
    """
    Returns (org_ids: set[int], school_ids: set[int]) from the user's true_organizations
    and true_schools via their matched_org_id / matched_school_id columns.
    These are already resolved IDs into the scraped organizations/schools tables.
    Falls back to name-based lookup if matched_*_id is NULL.
    """
    if not user_id:
        return set(), set()

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return set(), set()

    # Load true_experiences → true_organizations → matched_org_id
    _ = user.true_experiences, user.true_educations

    org_ids = set()
    unmatched_org_names = set()
    for te in user.true_experiences:
        if te.organization:
            if te.organization.matched_org_id:
                org_ids.add(te.organization.matched_org_id)
            else:
                unmatched_org_names.add(te.organization.name)

    school_ids = set()
    unmatched_school_names = set()
    for ed in user.true_educations:
        if ed.school:
            if ed.school.matched_school_id:
                school_ids.add(ed.school.matched_school_id)
            else:
                unmatched_school_names.add(ed.school.name)

    # Fallback: name-based lookup for unmatched entries
    if unmatched_org_names:
        for o in db.query(Organization).filter(Organization.name.in_(unmatched_org_names)).all():
            org_ids.add(o.id)
    if unmatched_school_names:
        for s in db.query(School).filter(School.name.in_(unmatched_school_names)).all():
            school_ids.add(s.id)

    return org_ids, school_ids


def _compute_related_counts_for_dests(db, dest_org_ids, user_id, exclude_emp_ids_by_org=None, connection_filters=None):
    """
    For a set of destination org IDs, find current employees (end_date IS NULL) who share
    the user's background (worked at any of user's true_organizations OR studied at any of
    user's true_schools). Returns a dict:
        { dest_org_id: {"count": N, "related": [{"employee_id", "employee_name",
                         "connection_type", "experience_history"}, ...]} }

    This is the batch version used to sort and annotate company cards on the dashboard.
    exclude_emp_ids_by_org (dict): {org_id: set(emp_ids)} to exclude from related results.
    """
    if not dest_org_ids or not user_id:
        return {}

    org_ids_user, school_ids_user = _get_user_matched_ids(db, user_id)
    if not org_ids_user and not school_ids_user:
        return {}

    dest_org_ids = set(dest_org_ids)

    # Step 1: Get all current employees at any of the dest orgs (end_date IS NULL)
    current_rows = (
        db.query(Experience.employee_id, Experience.organization_id)
        .filter(
            Experience.organization_id.in_(dest_org_ids),
            Experience.end_date.is_(None),
        )
        .distinct()
        .all()
    )
    if not current_rows:
        return {}

    # Map: employee_id -> set of dest_org_ids they currently work at
    emp_to_dest_orgs = {}
    all_current_emp_ids = set()
    for emp_id, org_id in current_rows:
        # Check if we should exclude this employee for this destination
        if exclude_emp_ids_by_org and emp_id in exclude_emp_ids_by_org.get(org_id, set()):
            continue
        emp_to_dest_orgs.setdefault(emp_id, set()).add(org_id)
        all_current_emp_ids.add(emp_id)

    if not all_current_emp_ids:
        return {}

    # Step 2: Check which of these employees share org background
    emp_ids_with_company_match = set()
    if org_ids_user:
        company_match_rows = (
            db.query(Experience.employee_id)
            .filter(
                Experience.employee_id.in_(all_current_emp_ids),
                Experience.organization_id.in_(org_ids_user),
            )
            .distinct()
            .all()
        )
        emp_ids_with_company_match = {row[0] for row in company_match_rows}

    # Step 3: Check which share school background
    emp_ids_with_school_match = set()
    if school_ids_user:
        school_match_rows = (
            db.query(Education.employee_id)
            .filter(
                Education.employee_id.in_(all_current_emp_ids),
                Education.school_id.in_(school_ids_user),
            )
            .distinct()
            .all()
        )
        emp_ids_with_school_match = {row[0] for row in school_match_rows}

    related_emp_ids = emp_ids_with_company_match | emp_ids_with_school_match
    if not related_emp_ids:
        return {}

    # Step 4: Build per-dest counts
    result = {}
    for emp_id in related_emp_ids:
        for dest_org_id in emp_to_dest_orgs.get(emp_id, set()):
            if dest_org_id not in result:
                result[dest_org_id] = {"count": 0, "emp_ids": set(),
                                       "emp_ids_company": set(), "emp_ids_school": set()}
            result[dest_org_id]["count"] += 1
            result[dest_org_id]["emp_ids"].add(emp_id)
            if emp_id in emp_ids_with_company_match:
                result[dest_org_id]["emp_ids_company"].add(emp_id)
            if emp_id in emp_ids_with_school_match:
                result[dest_org_id]["emp_ids_school"].add(emp_id)

    if not result:
        return {}

    # Step 5: Fetch employee names + full experience history for all related employees
    employees = db.query(Employee).filter(Employee.id.in_(related_emp_ids)).all()
    emp_name_by_id = {e.id: e.name for e in employees}

    rel_exps = (
        db.query(Experience)
        .filter(
            Experience.employee_id.in_(related_emp_ids),
            Experience.organization_id.isnot(None),
        )
        .order_by(Experience.employee_id, Experience.start_date, Experience.id)
        .all()
    )
    rel_org_ids = {e.organization_id for e in rel_exps if e.organization_id}
    rel_role_ids = {e.role_id for e in rel_exps if e.role_id}
    rel_org_names = {}
    rel_role_names = {}
    if rel_org_ids:
        for o in db.query(Organization).filter(Organization.id.in_(rel_org_ids)).all():
            rel_org_names[o.id] = o.name
    if rel_role_ids:
        for r in db.query(Role).filter(Role.id.in_(rel_role_ids)).all():
            rel_role_names[r.id] = r.name
    rel_exps_by_emp = {}
    for exp in rel_exps:
        rel_exps_by_emp.setdefault(exp.employee_id, []).append(exp)

    # Step 6: Load educations and precompute match map once (for speed)
    rel_edus = (
        db.query(Education)
        .filter(Education.employee_id.in_(related_emp_ids))
        .all()
    )
    rel_edus_by_emp = {}
    for edu in rel_edus:
        rel_edus_by_emp.setdefault(edu.employee_id, []).append(edu)
    for eid in related_emp_ids:
        rel_edus_by_emp.setdefault(eid, [])

    rel_school_ids = {e.school_id for e in rel_edus if e.school_id}
    rel_school_names = {}
    if rel_school_ids:
        for s in db.query(School).filter(School.id.in_(rel_school_ids)).all():
            rel_school_names[s.id] = s.name

    if connection_filters:
        global_match_map, global_match_details = _alumni_pass_connection_filters(
            db,
            user_id,
            list(related_emp_ids),
            rel_exps_by_emp,
            rel_edus_by_emp,
            connection_filters,
            org_names=rel_org_names,
            role_names=rel_role_names,
            school_names=rel_school_names,
            return_details=True,
        )
    else:
        global_match_map = {eid: True for eid in related_emp_ids}
        global_match_details = {eid: {"work_matches": [], "education_matches": []} for eid in related_emp_ids}

    # Step 7: Build final output per dest org
    final = {}
    for dest_org_id, data in result.items():
        dest_emp_ids = list(data["emp_ids"])
        related_list = []
        for eid in dest_emp_ids:
            in_company = eid in data["emp_ids_company"]
            in_school = eid in data["emp_ids_school"]
            if in_company and in_school:
                conn_type = "past_company_and_college"
            elif in_company:
                conn_type = "past_company"
            else:
                conn_type = "college"
            history = []
            for exp in rel_exps_by_emp.get(eid, []):
                history.append({
                    "organization": rel_org_names.get(exp.organization_id, "Unknown"),
                    "role": rel_role_names.get(exp.role_id) if exp.role_id else None,
                    "start_date": exp.start_date.isoformat() if exp.start_date else None,
                    "end_date": exp.end_date.isoformat() if exp.end_date else None,
                })
            related_list.append({
                "employee_id": eid,
                "employee_name": emp_name_by_id.get(eid, "Unknown"),
                "connection_type": conn_type,
                "experience_history": history,
                "is_match": bool(global_match_map.get(eid, False)),
                "filter_match_details": global_match_details.get(eid, {"work_matches": [], "education_matches": []}),
            })
        related_list.sort(key=lambda x: (not x["is_match"], x["employee_name"]))
        match_count = sum(1 for person in related_list if person.get("is_match"))
        final[dest_org_id] = {
            "count": data["count"],
            "match_count": match_count,
            "related": related_list,
        }
    return final


def _compute_related_background(db, source_org_id, dest_org_id, start_date, end_date, user_id):
    """
    Returns {"transition_employee_ids": list[int], "related": list[dict]} for one (source, dest) pair.
    Used by /related-background and by dashboard-data / org-transitions to include related for all dests.
    """
    if not user_id:
        return {"transition_employee_ids": [], "related": []}
    profile = _get_user_profile_filter_data(db, user_id)
    user_company_names = set(profile["company_names"]) if profile else set()
    user_school_names = set(profile["college_names"]) if profile else set()

    # 1) Get transition employee IDs (people who moved source -> dest in period)
    exit_query = db.query(Experience).filter(
        Experience.organization_id == source_org_id,
        Experience.end_date.isnot(None),
    )
    if start_date:
        exit_query = exit_query.filter(Experience.end_date >= start_date)
    if end_date:
        exit_query = exit_query.filter(Experience.end_date <= end_date)
    exit_stints = exit_query.all()
    transition_employee_ids = set()
    if exit_stints:
        emp_ids = list(set(e.employee_id for e in exit_stints))
        all_exps = (
            db.query(Experience)
            .filter(
                Experience.employee_id.in_(emp_ids),
                Experience.organization_id.isnot(None),
            )
            .order_by(Experience.employee_id, Experience.start_date)
            .all()
        )
        exps_by_emp = {}
        for exp in all_exps:
            exps_by_emp.setdefault(exp.employee_id, []).append(exp)
        for exit_stint in exit_stints:
            emp_exps = exps_by_emp.get(exit_stint.employee_id, [])
            subsequent = [
                e for e in emp_exps
                if e.start_date and e.start_date >= exit_stint.end_date and e.id != exit_stint.id
            ]
            subsequent.sort(key=lambda x: (x.start_date, x.id))
            groups = []
            for job in subsequent:
                if not groups or job.organization_id != groups[-1][0].organization_id:
                    groups.append([job])
                else:
                    groups[-1].append(job)
            while groups and groups[0][0].organization_id == source_org_id:
                groups.pop(0)
            for hop_idx, grp in enumerate(groups, start=1):
                if grp[0].organization_id == dest_org_id:
                    transition_employee_ids.add(exit_stint.employee_id)
                    break
                if hop_idx >= 3:
                    break

    # 2) People who have an experience at dest_org (current or past)
    dest_exps = (
        db.query(Experience)
        .filter(Experience.organization_id == dest_org_id)
        .all()
    )
    emp_ids_at_dest = list(set(e.employee_id for e in dest_exps))
    candidate_emp_ids = [eid for eid in emp_ids_at_dest if eid not in transition_employee_ids]
    if not candidate_emp_ids:
        return {"transition_employee_ids": list(transition_employee_ids), "related": []}

    org_ids_user, school_ids_user = _get_user_matched_ids(db, user_id)
    if not org_ids_user and not school_ids_user:
        return {"transition_employee_ids": list(transition_employee_ids), "related": []}

    all_exps_cand = (
        db.query(Experience)
        .filter(
            Experience.employee_id.in_(candidate_emp_ids),
            Experience.organization_id.isnot(None),
        )
        .all()
    )
    all_edus_cand = (
        db.query(Education)
        .filter(Education.employee_id.in_(candidate_emp_ids))
        .all()
    )
    emp_ids_with_company_match = set()
    emp_ids_with_school_match = set()
    for exp in all_exps_cand:
        if exp.organization_id and exp.organization_id in org_ids_user:
            emp_ids_with_company_match.add(exp.employee_id)
    for edu in all_edus_cand:
        if edu.school_id and edu.school_id in school_ids_user:
            emp_ids_with_school_match.add(edu.employee_id)

    related_emp_ids = emp_ids_with_company_match | emp_ids_with_school_match

    # NEW: keep only employees who are currently working at dest_org (end_date is NULL)
    current_dest_emp_ids = (
        db.query(Experience.employee_id)
        .filter(
            Experience.organization_id == dest_org_id,
            Experience.end_date.is_(None),
            Experience.employee_id.in_(related_emp_ids),
        )
        .distinct()
        .all()
    )
    current_dest_emp_ids = {row[0] for row in current_dest_emp_ids}
    related_emp_ids = related_emp_ids & current_dest_emp_ids

    if not related_emp_ids:
        return {"transition_employee_ids": list(transition_employee_ids), "related": []}

    employees = db.query(Employee).filter(Employee.id.in_(related_emp_ids)).all()
    emp_name_by_id = {e.id: e.name for e in employees}

    rel_exps = (
        db.query(Experience)
        .filter(
            Experience.employee_id.in_(related_emp_ids),
            Experience.organization_id.isnot(None),
        )
        .order_by(Experience.employee_id, Experience.start_date, Experience.id)
        .all()
    )
    rel_org_ids = set(e.organization_id for e in rel_exps if e.organization_id)
    rel_role_ids = set(e.role_id for e in rel_exps if e.role_id)
    rel_org_names = {}
    rel_role_names = {}
    if rel_org_ids:
        for o in db.query(Organization).filter(Organization.id.in_(rel_org_ids)).all():
            rel_org_names[o.id] = o.name
    if rel_role_ids:
        for r in db.query(Role).filter(Role.id.in_(rel_role_ids)).all():
            rel_role_names[r.id] = r.name
    rel_exps_by_emp = {}
    for exp in rel_exps:
        rel_exps_by_emp.setdefault(exp.employee_id, []).append(exp)

    related_list = []
    for eid in related_emp_ids:
        connection_type = "past_company" if eid in emp_ids_with_company_match else "college"
        if eid in emp_ids_with_company_match and eid in emp_ids_with_school_match:
            connection_type = "past_company_and_college"
        history = []
        for exp in rel_exps_by_emp.get(eid, []):
            history.append({
                "organization": rel_org_names.get(exp.organization_id, "Unknown"),
                "role": rel_role_names.get(exp.role_id, "Unknown") if exp.role_id else None,
                "start_date": exp.start_date.isoformat() if exp.start_date else None,
                "end_date": exp.end_date.isoformat() if exp.end_date else None,
            })
        related_list.append({
            "employee_id": eid,
            "employee_name": emp_name_by_id.get(eid, "Unknown"),
            "connection_type": connection_type,
            "experience_history": history,
        })
    related_list.sort(key=lambda x: x["employee_name"])
    return {"transition_employee_ids": list(transition_employee_ids), "related": related_list}


@app.get("/related-background")
@token_required
def related_background():
    """
    GET /related-background?source_org_id=...&dest_org_id=...&start_date=...&end_date=...

    For a destination company, returns:
    - transition_employee_ids: list of employee IDs who transitioned from source to dest (in the period).
    - related: list of people at dest_org who did NOT transition from source but match the current user's
      background (same past company or same college). Each item: { employee_id, employee_name, connection_type }.
    """
    source_org_id = request.args.get("source_org_id", type=int)
    dest_org_id = request.args.get("dest_org_id", type=int)
    start_date_str = request.args.get("start_date")
    end_date_str = request.args.get("end_date")
    if not source_org_id or not dest_org_id:
        return jsonify({"error": "Missing source_org_id or dest_org_id"}), 400
    start_date = parse_date(start_date_str)
    end_date = parse_date(end_date_str) if end_date_str else date.today()
    user_id = request.current_user.get("id") if getattr(request, "current_user", None) else None
    if not user_id:
        return jsonify({"transition_employee_ids": [], "related": []})

    for db in get_db():
        out = _compute_related_background(db, source_org_id, dest_org_id, start_date, end_date, user_id)
        return jsonify(out)
    return jsonify({"transition_employee_ids": [], "related": []})


def _fuzzy_match_name(session, model, name_value, threshold=85, cache=None):
    """
    Fuzzy match a name against a reference model (Organization or School).
    If cache is provided (dict {model: (names, ids)}), use it.
    """
    if not name_value:
        return None
    name_value = str(name_value).strip()
    if not name_value:
        return None

    # Exact match first (fast)
    exact = session.query(model.id).filter(func.lower(model.name) == name_value.lower()).first()
    if exact:
        return exact.id

    # Fuzzy match
    if cache is not None and model in cache:
        names, ids = cache[model]
    else:
        all_refs = session.query(model.id, model.name).all()
        names = [r.name for r in all_refs]
        ids = [r.id for r in all_refs]
        if cache is not None:
            cache[model] = (names, ids)

    if not names:
        return None

    match = process.extractOne(name_value, names, scorer=fuzz.WRatio)
    if match and match[1] >= threshold:
        return ids[match[2]]
    return None


def _get_or_create_true_lookup(session, model, name_field, name_value, reference_model=None, matched_id_field=None, cache=None):
    """
    get_or_create helper for true_* lookup tables.
    Optionally performs fuzzy matching against a reference_model.
    """
    if not name_value or not str(name_value).strip():
        return None

    name_value = str(name_value).strip()
    column = getattr(model, name_field)
    obj = session.query(model).filter(column == name_value).first()
    
    if obj:
        # If it exists but matched_id is missing, try to fill it
        if matched_id_field and hasattr(obj, matched_id_field) and getattr(obj, matched_id_field) is None and reference_model:
            matched_id = _fuzzy_match_name(session, reference_model, name_value, cache=cache)
            if matched_id:
                setattr(obj, matched_id_field, matched_id)
                session.flush()
        return obj

    # Create new
    params = {name_field: name_value}
    if matched_id_field and reference_model:
        matched_id = _fuzzy_match_name(session, reference_model, name_value, cache=cache)
        if matched_id:
            params[matched_id_field] = matched_id

    obj = model(**params)
    session.add(obj)
    session.flush()
    return obj


def _serialize_profile(user):
    """
    Serialize User + true_* relations into a profile JSON shape
    understood by the frontend Profile Page.
    """
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "profile_id": user.profile_id,
        "work_experiences": [
            {
                "id": exp.id,
                "company": exp.organization.name if exp.organization else None,
                "role": exp.role.name if exp.role else None,
                "start_date": exp.start_date.isoformat() if exp.start_date else None,
                "end_date": exp.end_date.isoformat() if exp.end_date else None,
            }
            for exp in sorted(user.true_experiences, key=lambda e: (e.start_date or date.min))
        ],
        "educations": [
            {
                "id": edu.id,
                "college": edu.school.name if edu.school else None,
                "degree": edu.degree,
                "start_date": edu.start_date.isoformat() if edu.start_date else None,
                "end_date": edu.end_date.isoformat() if edu.end_date else None,
            }
            for edu in sorted(user.true_educations, key=lambda e: (e.start_date or date.min))
        ],
        "skills": [s.skill for s in user.true_skills],
    }


@app.get("/profile")
@token_required
def get_profile_endpoint():
    """
    GET /profile

    Returns the current user's profile, including:
    - Basic info (name, email, profile_id)
    - true_experiences (work_experiences)
    - true_educations (educations)
    - true_skills (skills)
    """
    current = getattr(request, "current_user", None)
    if not current or not current.get("id"):
        return jsonify({"error": "Unauthorized"}), 401

    with SessionLocal() as db:
        user = db.query(User).filter(User.id == current["id"]).first()
        if not user:
            return jsonify({"error": "User not found"}), 404
        # Ensure relationships are loaded
        _ = user.true_experiences, user.true_educations, user.true_skills
        return jsonify(_serialize_profile(user))


@app.put("/profile")
@token_required
def update_profile_endpoint():
    """
    PUT /profile

    Payload:
    {
      "name": "New Name",
      "work_experiences": [
        {"company": "...", "role": "...", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD"},
        ...
      ],
      "educations": [
        {"college": "...", "degree": "...", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD"},
        ...
      ],
      "skills": ["React", "SQL", ...]
    }

    Email is intentionally immutable and cannot be changed here.
    """
    current = getattr(request, "current_user", None)
    if not current or not current.get("id"):
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json or {}
    with SessionLocal() as db:
        user = db.query(User).filter(User.id == current["id"]).first()
        if not user:
            return jsonify({"error": "User not found"}), 404

        # Basic info
        new_name = (data.get("name") or "").strip()
        if new_name:
            user.name = new_name

        # Clear existing true_* data so we can fully replace with payload
        db.query(TrueExperience).filter(TrueExperience.user_id == user.id).delete()
        db.query(TrueEducation).filter(TrueEducation.user_id == user.id).delete()
        db.query(TrueSkill).filter(TrueSkill.user_id == user.id).delete()

        fuzzy_cache = {}

        # Work experiences
        for item in data.get("work_experiences") or []:
            company = (item.get("company") or "").strip()
            role_name = (item.get("role") or "").strip()
            start_str = item.get("start_date")
            end_str = item.get("end_date")

            org = _get_or_create_true_lookup(db, TrueOrganization, "name", company, reference_model=Organization, matched_id_field="matched_org_id", cache=fuzzy_cache)
            role = _get_or_create_true_lookup(db, TrueRole, "name", role_name)

            start_date_val = parse_date(start_str)
            end_date_val = parse_date(end_str)

            exp = TrueExperience(
                user_id=user.id,
                organization=org,
                role=role,
                start_date=start_date_val,
                end_date=end_date_val,
            )
            db.add(exp)

        # Educations
        for item in data.get("educations") or []:
            college = (item.get("college") or "").strip()
            degree = (item.get("degree") or "").strip()
            start_str = item.get("start_date")
            end_str = item.get("end_date")

            school = _get_or_create_true_lookup(db, TrueSchool, "name", college, reference_model=School, matched_id_field="matched_school_id", cache=fuzzy_cache)
            start_date_val = parse_date(start_str)
            end_date_val = parse_date(end_str)

            edu = TrueEducation(
                user_id=user.id,
                school=school,
                degree=degree or None,
                start_date=start_date_val,
                end_date=end_date_val,
            )
            db.add(edu)

        # Skills (max 10 enforced)
        skills = data.get("skills") or []
        skills = [str(s).strip() for s in skills if str(s).strip()]
        skills = skills[:10]
        for skill in skills:
            db.add(TrueSkill(user_id=user.id, skill=skill))

        db.commit()
        db.refresh(user)
        _ = user.true_experiences, user.true_educations, user.true_skills
        return jsonify(_serialize_profile(user))


@app.post("/profile/resume")
@token_required
def upload_resume_endpoint():
    """
    POST /profile/resume

    Multipart form-data:
      - resume: PDF file

    Behaviour:
      - Stores the resume file on disk (or external storage in production)
      - Parses it via the existing resume-parsing pipeline
      - Maps parsed data into true_* tables and updates the User record
      - Returns the updated profile JSON
    """
    current = getattr(request, "current_user", None)
    if not current or not current.get("id"):
        return jsonify({"error": "Unauthorized"}), 401

    if "resume" not in request.files:
        return jsonify({"error": "Missing 'resume' file"}), 400

    file = request.files["resume"]
    if not file.filename:
        return jsonify({"error": "Empty filename"}), 400

    filename = file.filename.lower()
    if not filename.endswith(".pdf"):
        return jsonify({"error": "Only PDF resumes are supported"}), 400

    # Store resume to a local uploads folder.
    # In production you would use cloud/object storage instead.
    uploads_dir = os.path.join(os.path.dirname(__file__), "uploads")
    os.makedirs(uploads_dir, exist_ok=True)

    safe_name = f"user_{current['id']}_{int(datetime.now(timezone.utc).timestamp())}.pdf"
    file_path = os.path.join(uploads_dir, safe_name)
    file.save(file_path)

    parsed = parse_resume_for_user(file_path)
    if not parsed or not parsed.get("name"):
        return jsonify({"error": "Could not parse resume. Please upload a LinkedIn exported PDF."}), 400

    with SessionLocal() as db:
        user = db.query(User).filter(User.id == current["id"]).first()
        if not user:
            return jsonify({"error": "User not found"}), 404

        # Store a reference to the uploaded resume. In a real deployment this
        # might be a public/storage URL instead of a local filename.
        user.profile_id = safe_name

        # Optionally update the user's display name from resume if it's empty.
        if not user.name and parsed.get("name"):
            user.name = parsed["name"]

        # Clear existing true_* entries before re-populating from resume
        db.query(TrueExperience).filter(TrueExperience.user_id == user.id).delete()
        db.query(TrueEducation).filter(TrueEducation.user_id == user.id).delete()
        # We intentionally do NOT touch skills here; those are user-entered.

        fuzzy_cache = {}

        # Map experiences from parsed resume.
        for exp in parsed.get("experiences") or []:
            # exp format: [org, title, tenure, address]
            org_raw = exp[0] if len(exp) > 0 else None
            role_raw = exp[1] if len(exp) > 1 else None
            tenure_raw = exp[2] if len(exp) > 2 else None
            address_raw = exp[3] if len(exp) > 3 else None

            org = _get_or_create_true_lookup(db, TrueOrganization, "name", org_raw, reference_model=Organization, matched_id_field="matched_org_id", cache=fuzzy_cache)
            role = _get_or_create_true_lookup(db, TrueRole, "name", role_raw)
            start_dt, end_dt, duration = parse_tenure(tenure_raw)

            exp_row = TrueExperience(
                user_id=user.id,
                organization=org,
                role=role,
                start_date=start_dt.date() if start_dt else None,
                end_date=end_dt.date() if end_dt else None,
                duration_text=duration,
                address=address_raw,
            )
            db.add(exp_row)

        # Map educations from parsed resume.
        for edu in parsed.get("educations") or []:
            # edu format: [school, degree_str]
            school_raw = edu[0] if len(edu) > 0 else None
            degree_raw = edu[1] if len(edu) > 1 else None

            school = _get_or_create_true_lookup(db, TrueSchool, "name", school_raw, reference_model=School, matched_id_field="matched_school_id", cache=fuzzy_cache)
            degree, start_dt, end_dt = parse_degree(degree_raw)

            edu_row = TrueEducation(
                user_id=user.id,
                school=school,
                degree=degree,
                start_date=start_dt.date() if start_dt else None,
                end_date=end_dt.date() if end_dt else None,
            )
            db.add(edu_row)

        db.commit()
        db.refresh(user)
        _ = user.true_experiences, user.true_educations, user.true_skills
        return jsonify(_serialize_profile(user))


@app.get("/profile/resume")
@token_required
def download_resume_endpoint():
    """
    GET /profile/resume

    Serves the user's uploaded resume PDF for download.
    """
    current = getattr(request, "current_user", None)
    if not current or not current.get("id"):
        return jsonify({"error": "Unauthorized"}), 401

    with SessionLocal() as db:
        user = db.query(User).filter(User.id == current["id"]).first()
        if not user or not user.profile_id:
            return jsonify({"error": "No resume uploaded"}), 404

        uploads_dir = os.path.join(os.path.dirname(__file__), "uploads")
        file_path = os.path.join(uploads_dir, user.profile_id)
        if not os.path.isfile(file_path):
            return jsonify({"error": "Resume file not found"}), 404

        return send_file(
            file_path,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=user.profile_id,
        )


@app.delete("/profile/resume")
@token_required
def delete_resume_endpoint():
    """
    DELETE /profile/resume

    Removes the user's resume from storage and clears profile_id in the database.
    Returns the updated profile JSON.
    """
    current = getattr(request, "current_user", None)
    if not current or not current.get("id"):
        return jsonify({"error": "Unauthorized"}), 401

    with SessionLocal() as db:
        user = db.query(User).filter(User.id == current["id"]).first()
        if not user:
            return jsonify({"error": "User not found"}), 404

        if user.profile_id:
            uploads_dir = os.path.join(os.path.dirname(__file__), "uploads")
            file_path = os.path.join(uploads_dir, user.profile_id)
            if os.path.isfile(file_path):
                try:
                    os.remove(file_path)
                except OSError:
                    pass
            user.profile_id = None

        db.commit()
        db.refresh(user)
        _ = user.true_experiences, user.true_educations, user.true_skills
        return jsonify(_serialize_profile(user))


if __name__ == "__main__":
    # Ensure tables exist, then run the dev server.
    init_db()
    app.run(host="0.0.0.0", port=5001, debug=True)
