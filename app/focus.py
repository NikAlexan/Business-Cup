"""Listener questions for transferring a chosen change into a new story, not skill scores."""

RUBRICS = {
    "word_endings": {
        "label": "Word endings",
        "question": "Can you hear the final sound of the key words without extra force?",
        "exercise_ids": ["E03"],
    },
    "consonants": {
        "label": "Clear sound groups",
        "question": "Can you follow the sound groups in the phrase without losing the thought?",
        "exercise_ids": ["E02", "E04", "E05"],
    },
    "pace": {
        "label": "Comfortable pace",
        "question": "Can you follow the idea while the words stay comfortably connected?",
        "exercise_ids": ["E06", "E07"],
    },
    "pauses": {
        "label": "Meaningful pauses",
        "question": "Does your chosen pause help one thought land before the next begins?",
        "exercise_ids": ["E08"],
    },
    "intonation": {
        "label": "Intonation",
        "question": "Can you hear which phrase is a question, a statement or a change of thought?",
        "exercise_ids": ["E09"],
    },
    "emphasis": {
        "label": "Meaning through emphasis",
        "question": "Can you hear the word you chose to carry the meaning, without extra loudness?",
        "exercise_ids": ["E10"],
    },
    "breath": {
        "label": "Comfortable phrasing",
        "question": "Does the phrase sound complete and comfortable, with room to breathe when needed?",
        "exercise_ids": ["E11"],
    },
    "delivery": {
        "label": "Story delivery",
        "question": "Can a listener follow the change or discovery in the story?",
        "exercise_ids": ["E12"],
    },
}
RUBRIC_VERSION = "story-listening-v1"
STORY_STEPS = [
    "Choose one phrase where your change could help the listener follow the meaning.",
    "Read the story once, keeping your voice comfortable.",
    "Listen to that phrase. In an optional repeat, change just one thing and compare both takes.",
]


def suggested_skill(exercise_id):
    return next((key for key, rubric in RUBRICS.items() if exercise_id in rubric["exercise_ids"]), "delivery")
