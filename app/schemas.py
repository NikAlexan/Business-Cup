from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator

Goal = Literal["clear_speech", "expressive_voice", "confident_delivery"]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Consent(Input):
    audio_processing: bool
    policy_version: Literal["2026-11-14"]


class Preferences(Input):
    goal: Goal | None = None
    timezone: str | None = None
    locale: Literal["en-US"] | None = None

    @field_validator("timezone")
    @classmethod
    def timezone_valid(cls, v):
        if v is not None:
            try:
                ZoneInfo(v)
            except (ZoneInfoNotFoundError, ValueError):
                raise ValueError("Invalid IANA timezone") from None
        return v


class GuestInput(Preferences):
    timezone: str = "America/New_York"
    locale: Literal["en-US"] = "en-US"
    goal: Goal = "clear_speech"
    consent: Consent


class RecordingConditions(Input):
    device_label: str | None = Field(default=None, max_length=200)
    distance_cm: int | None = Field(default=None, ge=1, le=200)
    environment: Literal["quiet_room", "some_noise", "noisy", "unknown"] = "unknown"
    notes: str | None = Field(default=None, max_length=500)


class AssessmentInput(Input):
    kind: Literal["initial", "reassessment"]
    recording_conditions: RecordingConditions
    demo_override: bool = False


class Empty(Input):
    pass


class CancelUploadInput(Input):
    plan_item_id: UUID


class PracticeFocusInput(Input):
    source_attempt_id: UUID
    intent: Literal["experiment", "keep"] | None = None
    note: str = Field(min_length=1, max_length=500)
    skill: (
        Literal[
            "word_endings", "consonants", "pace", "pauses", "intonation", "emphasis", "breath", "delivery"
        ]
        | None
    ) = None


class ListeningPlanInput(Input):
    example_id: str = Field(min_length=1, max_length=100)
    answer: Literal["a", "b", "unsure"]
    boundary_index: int = Field(ge=0, le=100, strict=True)


class FocusCheckInput(Input):
    outcome: Literal["heard", "partly", "not_yet", "unsure"]


class AttemptInput(Input):
    plan_item_id: UUID
    practice_only: bool = False
    based_on_attempt_id: UUID | None = None
    elapsed_seconds: float | None = Field(default=None, ge=0, le=3600, allow_inf_nan=False)
    self_confirmed: bool | None = None
    recording_id: UUID | None = None


class CompleteInput(Input):
    status: Literal["completed"]


class Observation(Input):
    category: Literal[
        "clarity", "pace", "intonation", "expressiveness", "breath", "delivery", "articulation", "pauses"
    ]
    text: str = Field(min_length=1, max_length=1000)
    source: Literal["audio_model"] = "audio_model"


class Priority(Input):
    tag: Literal[
        "clarity", "pace", "intonation", "expressiveness", "breath", "delivery", "articulation", "pauses"
    ]
    reason: str = Field(min_length=1, max_length=500)
    exercise_ids: list[str] = Field(min_length=1, max_length=4)


class VoiceReport(Input):
    summary: str = Field(min_length=1, max_length=1500)
    observations: list[Observation] = Field(max_length=8)
    limitations: list[str] = Field(min_length=1, max_length=8)
    priorities: list[Priority] = Field(min_length=1, max_length=2)
    recommended_exercise_ids: list[str] = Field(min_length=1, max_length=12)


class ReflectionInput(Input):
    note: str = Field(max_length=500)
    intent: Literal["experiment", "keep", "undecided"] | None = None


class SpeechObservation(Input):
    text: str = Field(min_length=1, max_length=500)
    evidence_quote: str = Field(min_length=1, max_length=180)
    occurrence: int = Field(default=1, ge=1, le=20)


class ExerciseReview(Input):
    summary: str = Field(min_length=1, max_length=350)
    observation: SpeechObservation | None
    next_step: str = Field(min_length=1, max_length=350)
    listening_question: str = Field(min_length=1, max_length=200)
    limitations: list[str] = Field(min_length=1, max_length=3)
