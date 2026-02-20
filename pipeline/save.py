import re
from datetime import datetime

from db.models import (
    SessionLocal,
    init_db,
    Employee,
    Organization,
    Role,
    School,
    Experience,
    Education,
)
from scraping import search_org_candidates, choose_best_match

LINKEDIN_MATCH_MIN_SCORE = 78.0


def _parse_date_part(s):
    """Parse 'May 2010' or '2014' into a datetime for Excel sorting."""
    if not s or not str(s).strip():
        return None
    s = str(s).strip()
    # Try "Month Year" e.g. May 2010, April 2014
    for fmt in ('%B %Y', '%b %Y'):  # full month, abbreviated month
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    # Try "Year" only e.g. 2014, 2021
    try:
        return datetime.strptime(s, '%Y')
    except ValueError:
        return None

def parse_degree(degree_str):
    """Parse 'Bachelor of Science, Biochemistry · (August 2016 - December 2021)' into Degree, Start (date), End (date)."""
    if not degree_str or not str(degree_str).strip():
        return None, None, None
    s = str(degree_str).strip()
    degree = None
    start, end = None, None
    # Match "Degree · (Start - End)" or "Degree • (Start - End)"
    m = re.match(r'^(.+?)\s*[·•]\s*\((.+?)\s*-\s*(.+?)\)\s*$', s)
    if m:
        degree = m.group(1).strip()
        start_str, end_str = m.group(2).strip(), m.group(3).strip()
        start = _parse_date_part(start_str)
        end = _parse_date_part(end_str)
    else:
        # No date part - whole string is degree
        degree = s
    return degree, start, end

def parse_tenure(tenure_str):
    """Parse tenure like 'May 2010 - April 2014 (4 years)' into Start (date), End (date), Duration."""
    if not tenure_str or not str(tenure_str).strip():
        return None, None, None
    s = str(tenure_str).strip()
    start_str, end_str, duration = None, None, None
    # Match "X - Y (Z)" e.g. "May 2010 - April 2014 (4 years)" or "2014 - 2021 (7 years)"
    m = re.match(r'^(.+?)\s*-\s*(.+?)\s*\((.+)\)\s*$', s)
    if m:
        start_str, end_str, duration = m.group(1).strip(), m.group(2).strip(), m.group(3).strip()
    else:
        m = re.match(r'^(.+?)\s*-\s*(.+)$', s)
        if m:
            start_str, end_str = m.group(1).strip(), m.group(2).strip()
        else:
            start_str = s
    start = _parse_date_part(start_str)
    end = _parse_date_part(end_str)
    return start, end, duration

def get_or_create_lookup(session, model, name_field, name_value):
    """
    If name exists in lookup table, return the instance.
    Otherwise add it and return new instance.
    Returns None if name_value is empty.
    """
    if not name_value or not str(name_value).strip():
        return None

    name_value = str(name_value).strip()
    column = getattr(model, name_field)

    obj = session.query(model).filter(column == name_value).first()
    if obj:
        return obj

    obj = model(**{name_field: name_value})
    session.add(obj)
    session.flush()  # assign PK

    # For new organizations, resolve and store LinkedIn org id immediately.
    if model is Organization:
        try:
            candidates = search_org_candidates(name_value)
            best, score = choose_best_match(name_value, candidates)
            if best and score >= LINKEDIN_MATCH_MIN_SCORE:
                obj.linkedin_org_id = str(best.get("id"))
                session.add(obj)
                session.flush()
        except Exception:
            # Keep insert path resilient; unresolved LinkedIn id can be filled later.
            pass

    return obj


def save(name, profile_id, exp_list, edu_list):
    # Ensure tables exist
    init_db()

    db = SessionLocal()
    try:
        # Check if employee with this profile_id already exists
        if profile_id:
            existing = db.query(Employee).filter(Employee.profile_id == profile_id).first()
            if existing:
                print(f"Skipping: Employee with profile_id '{profile_id}' already exists (id={existing.id})")
                return existing.id
        
        # Create employee
        employee = Employee(name=name, profile_id=profile_id)
        db.add(employee)
        db.flush()  # get employee.id

        # Save experience entries (interns are skipped like before)
        if exp_list:
            for exp in exp_list:
                # exp format: [org, title, tenure, address]
                org_raw = exp[0] if len(exp) > 0 else None
                role_raw = exp[1] if len(exp) > 1 else None
                tenure_raw = exp[2] if len(exp) > 2 else None

                organization = get_or_create_lookup(db, Organization, "name", org_raw)
                role = get_or_create_lookup(db, Role, "name", role_raw)
                start, end, duration = parse_tenure(tenure_raw)
                is_intern = role_raw and "intern" in str(role_raw).lower()

                if not is_intern:
                    experience = Experience(
                        employee=employee,
                        organization=organization,
                        role=role,
                        start_date=start.date() if start else None,
                        end_date=end.date() if end else None,
                        duration_text=duration,
                        address=exp[3] if len(exp) > 3 else None,
                    )
                    db.add(experience)

        # Save education entries
        if edu_list:
            for edu in edu_list:
                # edu format: [school, degree] e.g. degree = "Bachelor of Science, Biochemistry · (August 2016 - December 2021)"
                school_raw = edu[0] if len(edu) > 0 else None
                degree_raw = edu[1] if len(edu) > 1 else None

                school = get_or_create_lookup(db, School, "name", school_raw)
                degree, start, end = parse_degree(degree_raw)

                education = Education(
                    employee=employee,
                    school=school,
                    degree=degree,
                    start_date=start.date() if start else None,
                    end_date=end.date() if end else None,
                )
                db.add(education)

        db.commit()
        print("done")
        return employee.id
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
