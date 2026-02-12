import os
from datetime import date

from sqlalchemy import (
    create_engine,
    Column,
    Integer,
    String,
    ForeignKey,
    Date,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker, scoped_session


# DATABASE_URL = os.environ.get("DATABASE_URL")
DATABASE_URL= "postgresql+psycopg2://postgres:edd0ef31fdc784f9309438a325b64d0aba4c59649d2f4be1de036d7f669880e9@db.htpevovdkkvgjamnguuf.supabase.co:5432/postgres"
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL must be set (e.g. your Supabase Postgres connection string)."
    )


# Workaround for Vercel/Supabase IPv6 issues: force IPv4 resolution
import socket
from urllib.parse import urlparse

if "supa" in DATABASE_URL or "postgres" in DATABASE_URL:
    try:
        # Parse the URL to get the hostname
        result = urlparse(DATABASE_URL)
        hostname = result.hostname
        if hostname:
             # Resolve to IPv4 address
            ip_address = socket.gethostbyname(hostname)
            # Add hostaddr to connect_args
            # We keep sslmode='require' as it was
            connect_args = {"sslmode": "require", "hostaddr": ip_address}
            
            # Print for debugging (optional, but helpful in logs)
            print(f"Verified IPv4 for {hostname}: {ip_address}")
        else:
             connect_args = {"sslmode": "require"}
    except Exception as e:
        print(f"Failed to resolve IPv4 for database host: {e}")
        # Fallback to default behavior
        connect_args = {"sslmode": "require"}
else:
    connect_args = {"sslmode": "require"}

# Example:
# postgresql+psycopg2://postgres:YOUR_PASSWORD@YOUR_HOST:5432/postgres
engine = create_engine(DATABASE_URL, echo=False, future=True, connect_args=connect_args)
SessionLocal = scoped_session(
    sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
)



Base = declarative_base()


class Employee(Base):
    __tablename__ = "employees"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)

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
]

