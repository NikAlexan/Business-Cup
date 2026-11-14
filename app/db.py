import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, ForeignKey, Index, String, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


def new_id():
    return str(uuid.uuid4())


def utcnow():
    return datetime.now(UTC)


def iso(dt=None):
    return (dt or utcnow()).isoformat().replace("+00:00", "Z")


class Base(DeclarativeBase):
    pass


class Guest(Base):
    __tablename__ = "guest_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    subject_id: Mapped[str] = mapped_column(String(36), unique=True, default=new_id)
    creation_key: Mapped[str] = mapped_column(String(64), unique=True)
    data: Mapped[dict] = mapped_column(JSON)


class Resource(Base):
    """Versioned JSON aggregates, indexed by owner and kind; no public filesystem paths."""

    __tablename__ = "resources"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    guest_id: Mapped[str] = mapped_column(ForeignKey("guest_sessions.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(24))
    created_at: Mapped[str] = mapped_column(String(32), default=iso)
    data: Mapped[dict] = mapped_column(JSON)
    __table_args__ = (Index("ix_resource_owner_kind_created", "guest_id", "kind", "created_at", "id"),)


class Job(Base):
    __tablename__ = "analysis_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    guest_id: Mapped[str] = mapped_column(ForeignKey("guest_sessions.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    lease_until: Mapped[float | None] = mapped_column(default=None)
    lease_token: Mapped[str | None] = mapped_column(String(36), default=None)
    data: Mapped[dict] = mapped_column(JSON)


class Idempotency(Base):
    __tablename__ = "idempotency_keys"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    guest_id: Mapped[str] = mapped_column(ForeignKey("guest_sessions.id", ondelete="CASCADE"), index=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    status: Mapped[int]
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(String(32), default=iso)


class DailyBudget(Base):
    """Anonymous service counters survive deletion of individual guests."""

    __tablename__ = "daily_budgets"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    count: Mapped[int] = mapped_column(default=0)


class Database:
    def __init__(self, url):
        self.engine = create_engine(
            url,
            pool_pre_ping=True,
            **(
                {"connect_args": {"check_same_thread": False, "timeout": 30}}
                if url.startswith("sqlite")
                else {}
            ),
        )
        if url.startswith("sqlite"):

            @event.listens_for(self.engine, "connect")
            def enable_fk(connection, _):
                connection.execute("PRAGMA foreign_keys=ON")

        self.session = sessionmaker(self.engine, expire_on_commit=False)
