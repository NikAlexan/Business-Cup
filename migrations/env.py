from alembic import context

from app.config import Settings
from app.db import Base, Database

config = context.config


def online():
    database = Database(Settings().database_url)
    with database.engine.connect() as connection:
        # web and worker may start concurrently: only one migrator may change PostgreSQL schema.
        if connection.dialect.name == "postgresql":
            from sqlalchemy import text

            connection.execute(text("SELECT pg_advisory_lock(823114709)"))
            connection.commit()
        try:
            context.configure(connection=connection, target_metadata=Base.metadata)
            with context.begin_transaction():
                context.run_migrations()
        finally:
            if connection.dialect.name == "postgresql":
                connection.execute(text("SELECT pg_advisory_unlock(823114709)"))
                connection.commit()
    database.engine.dispose()


if context.is_offline_mode():
    context.configure(url=Settings().database_url, target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    online()
