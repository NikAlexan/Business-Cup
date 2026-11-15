from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "sqlite:///./voice.db"
    app_secret: SecretStr  # required: APP_SECRET from .env or the environment
    openai_api_key: SecretStr = SecretStr("")
    audio_model: str = "gpt-audio-1.5"
    transcribe_model: str = "whisper-1"
    normalize_model: str = "gpt-4o-mini"
    openai_base_url: str = "https://api.openai.com/v1"
    audio_data: Path = Path("audio_data")
    vad_model_path: Path = Path("models/silero_vad.onnx")
    asr_model_dir: Path = Path("models/asr")
    ffmpeg_path: str = "ffmpeg"
    reassessment_days: int = Field(default=14, ge=1)
    max_recording_seconds: int = Field(default=180, ge=1, le=180)
    max_file_bytes: int = Field(default=25 * 1024 * 1024, ge=1, le=25 * 1024 * 1024)
    max_uploads_per_day: int = Field(default=60, ge=1)
    max_assessments_per_day: int = Field(default=3, ge=1)
    max_total_uploads_per_day: int = Field(default=300, ge=1)
    max_total_assessments_per_day: int = Field(default=20, ge=1)
    exercise_reviews_enabled: bool = True
    max_exercise_reviews_per_day: int = Field(default=10, ge=1)
    max_total_exercise_reviews_per_day: int = Field(default=100, ge=1)
    demo_mode: bool = False
    billing_provider: Literal["none", "stripe_test"] = "none"
    stripe_secret_key: SecretStr = SecretStr("")
    stripe_webhook_secret: SecretStr = SecretStr("")
    stripe_price_monthly: str = ""
    stripe_price_yearly: str = ""
    stripe_trial_days: int = Field(default=7, ge=0, le=730)
    cookie_secure: bool = False
    allowed_origins: str = "http://localhost:8000,http://localhost:3000,http://localhost:5173"
    job_lease_seconds: int = Field(default=600, ge=120)
    job_max_attempts: int = Field(default=3, ge=1, le=5)
    job_max_retry_batches: int = Field(default=1, ge=0, le=3)
    worker_poll_seconds: float = Field(default=1, gt=0)

    @field_validator("app_secret")
    @classmethod
    def validate_secret(cls, value):
        if len(value.get_secret_value()) < 32:
            raise ValueError("APP_SECRET must contain at least 32 characters")
        return value

    @model_validator(mode="after")
    def validate_billing(self):
        if self.billing_provider == "stripe_test":
            if not self.stripe_secret_key.get_secret_value().startswith("sk_test_"):
                raise ValueError(
                    "BILLING_PROVIDER=stripe_test requires a test STRIPE_SECRET_KEY (sk_test_...)"
                )
            if not (
                self.stripe_webhook_secret.get_secret_value()
                and self.stripe_price_monthly
                and self.stripe_price_yearly
            ):
                raise ValueError(
                    "Stripe needs STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_YEARLY"
                )
        return self

    @property
    def origins(self):
        return [s.strip().rstrip("/") for s in self.allowed_origins.split(",") if s.strip()]
