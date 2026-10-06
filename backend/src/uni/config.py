from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="UNI_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://uni:uni@localhost:5433/uni"
    secret_key: str
    public_url: str = "http://localhost:8000"
    app_scheme: str = "uni"
    usos_base_url: str = "https://usosapps.amu.edu.pl"
    usos_consumer_key: str = ""
    usos_consumer_secret: str = ""
    moodle_base_url: str = "https://lms.amu.edu.pl/sci"
    session_days: int = 90
    cache_minutes: int = 15


@lru_cache
def settings() -> Settings:
    return Settings()
