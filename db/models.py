import os
from datetime import date
from dotenv import load_dotenv

load_dotenv()

from sqlalchemy import (
    create_engine,
    Column,
    Integer,
    String,
    ForeignKey,
    Date,
    Text,
    DateTime,
    UniqueConstraint,
)
from sqlalchemy.sql import func
from sqlalchemy.orm import declarative_base, relationship, sessionmaker, scoped_session

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    # Use the pooler host as the direct host is experiencing DNS resolution issues
    DATABASE_URL= "postgresql+psycopg2://postgres.htpevovdkkvgjamnguuf:edd0ef31fdc784f9309438a325b64d0aba4c59649d2f4be1de036d7f669880e9@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"
#DATABASE_URL= "postgresql+psycopg2://postgres:edd0ef31fdc784f9309438a325b64d0aba4c59649d2f4be1de036d7f669880e9@db.htpevovdkkvgjamnguuf.supabase.co:5432/postgres"
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL must be set (e.g. your Supabase Postgres connection string)."
    )

# Example:
# postgresql+psycopg2://postgres:YOUR_PASSWORD@YOUR_HOST:5432/postgres
engine = create_engine(DATABASE_URL, echo=False, future=True)
SessionLocal = scoped_session(
    sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
)



Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=True)
    profile_id = Column(String, nullable=True)  # Supabase resume URL, set when user uploads resume later
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class OTP(Base):
    __tablename__ = "otps"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, nullable=False, index=True)
    code = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)
    resend_count = Column(Integer, default=0)
    last_sent_at = Column(DateTime(timezone=True), server_default=func.now())


class Employee(Base):
    __tablename__ = "employees"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    profile_id = Column(String, unique=True, nullable=True)

    experiences = relationship(
        "Experience", back_populates="employee", cascade="all, delete-orphan"
    )
    educations = relationship(
        "Education", back_populates="employee", cascade="all, delete-orphan"
    )


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)

    experiences = relationship("Experience", back_populates="organization")


class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)

    experiences = relationship("Experience", back_populates="role")


class School(Base):
    __tablename__ = "schools"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)

    educations = relationship("Education", back_populates="school")


class Experience(Base):
    __tablename__ = "experiences"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=True)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=True)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    duration_text = Column(Text, nullable=True)
    address = Column(Text, nullable=True)

    employee = relationship("Employee", back_populates="experiences")
    organization = relationship("Organization", back_populates="experiences")
    role = relationship("Role", back_populates="experiences")


class Education(Base):
    __tablename__ = "educations"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=True)
    degree = Column(String, nullable=True)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)

    employee = relationship("Employee", back_populates="educations")
    school = relationship("School", back_populates="educations")


# --- True tables: user-generated data, linked via users.id only. No links to scraped tables. ---

class TrueOrganization(Base):
    __tablename__ = "true_organizations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)

    experiences = relationship("TrueExperience", back_populates="organization")


class TrueRole(Base):
    __tablename__ = "true_roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)

    experiences = relationship("TrueExperience", back_populates="role")


class TrueSchool(Base):
    __tablename__ = "true_schools"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)

    educations = relationship("TrueEducation", back_populates="school")


class TrueExperience(Base):
    __tablename__ = "true_experiences"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    organization_id = Column(Integer, ForeignKey("true_organizations.id"), nullable=True)
    role_id = Column(Integer, ForeignKey("true_roles.id"), nullable=True)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    duration_text = Column(Text, nullable=True)
    address = Column(Text, nullable=True)

    user = relationship("User", back_populates="true_experiences")
    organization = relationship("TrueOrganization", back_populates="experiences")
    role = relationship("TrueRole", back_populates="experiences")


class TrueEducation(Base):
    __tablename__ = "true_educations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    school_id = Column(Integer, ForeignKey("true_schools.id"), nullable=True)
    degree = Column(String, nullable=True)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)

    user = relationship("User", back_populates="true_educations")
    school = relationship("TrueSchool", back_populates="educations")


class TrueSkill(Base):
    """One skill per row. Max 10 skills per user enforced in application."""
    __tablename__ = "true_skills"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    skill = Column(String, nullable=False)

    user = relationship("User", back_populates="true_skills")


# Add reverse relationships on User for true_* tables
User.true_experiences = relationship(
    "TrueExperience", back_populates="user", cascade="all, delete-orphan"
)
User.true_educations = relationship(
    "TrueEducation", back_populates="user", cascade="all, delete-orphan"
)
User.true_skills = relationship(
    "TrueSkill", back_populates="user", cascade="all, delete-orphan"
)


def get_db():
    """FastAPI-style dependency helper if needed later."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Create tables in the target database if they don't exist yet."""
    Base.metadata.create_all(bind=engine)


__all__ = [
    "Base",
    "SessionLocal",
    "init_db",
    "Employee",
    "Organization",
    "Role",
    "School",
    "Experience",
    "Education",
    "User",
    "OTP",
    "TrueOrganization",
    "TrueRole",
    "TrueSchool",
    "TrueExperience",
    "TrueEducation",
    "TrueSkill",
]

