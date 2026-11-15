"""Build an original public pause contrast offline, using native Flite word boundaries.

Developer tool only. No settings, private audio, model API, ASR or network access.
Requires libflite.so.1 and libflite_cmu_us_slt.so.1 (available with the local FFmpeg build).
"""

import argparse
import ctypes
import hashlib
import json
import re
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent
TEXT = "At the old bridge the path turns toward the river."


def synthesize():
    """C signatures follow upstream include/flite.h, cst_item.h and cst_wave.h."""
    core = ctypes.CDLL("libflite.so.1", mode=ctypes.RTLD_GLOBAL)
    voice_library = ctypes.CDLL("libflite_cmu_us_slt.so.1", mode=ctypes.RTLD_GLOBAL)
    pointer, string = ctypes.c_void_p, ctypes.c_char_p

    def bind(library, name, result, arguments):
        function = getattr(library, name)
        function.restype, function.argtypes = result, arguments
        return function

    class Wave(ctypes.Structure):
        _fields_ = [
            ("type", string),
            ("sample_rate", ctypes.c_int),
            ("num_samples", ctypes.c_int),
            ("num_channels", ctypes.c_int),
            ("samples", ctypes.POINTER(ctypes.c_short)),
        ]

    bind(core, "flite_init", ctypes.c_int, [])()
    voice = bind(voice_library, "register_cmu_us_slt", pointer, [string])(None)
    if not voice:
        raise RuntimeError("Flite could not register the synthetic voice")
    utterance = bind(core, "flite_synth_text", pointer, [string, pointer])(TEXT.encode(), voice)
    if not utterance:
        raise RuntimeError("Flite could not synthesize the original sentence")
    try:
        relation = bind(core, "utt_relation", pointer, [pointer, string])(utterance, b"Word")
        item = bind(core, "relation_head", pointer, [pointer])(relation)
        name = bind(core, "item_feat_string", string, [pointer, string])
        feature = bind(core, "ffeature_float", ctypes.c_float, [pointer, string])
        next_item = bind(core, "item_next", pointer, [pointer])
        words = []
        while item:
            words.append(
                {
                    "word": name(item, b"name").decode(),
                    "end_seconds": float(feature(item, b"R:SylStructure.daughtern.daughtern.end")),
                }
            )
            item = next_item(item)
        wave_pointer = bind(core, "utt_wave", ctypes.POINTER(Wave), [pointer])(utterance)
        wave = wave_pointer.contents
        if wave.num_channels != 1 or wave.sample_rate not in (16000, 32000) or wave.num_samples <= 0:
            raise RuntimeError("Unexpected Flite waveform format")
        signal = np.ctypeslib.as_array(wave.samples, shape=(wave.num_samples,)).copy()
        rate = wave.sample_rate
    finally:
        bind(core, "delete_utterance", None, [pointer])(utterance)
    if [w["word"] for w in words] != re.findall(r"[a-z]+", TEXT.lower()):
        raise RuntimeError("Synthetic word labels do not match the original sentence")
    ends = [w["end_seconds"] for w in words]
    if not all(a < b for a, b in zip([0.0, *ends], ends)) or ends[-1] >= len(signal) / rate:
        raise RuntimeError("Synthetic word boundaries are invalid")
    return signal, rate, words


def build(version):
    if not re.fullmatch(r"v[1-9][0-9]*", version):
        raise ValueError("Use a version such as v1; existing example IDs are immutable")
    signal, rate, words = synthesize()
    cuts = {"a": round(words[3]["end_seconds"] * rate), "b": round(words[1]["end_seconds"] * rate)}
    base = signal.astype(np.float64) / max(1, np.abs(signal.astype(np.int32)).max()) * 0.75
    fade = round(0.003 * rate)
    # Both outputs use this identical, gently de-clicked base. Only the silence location differs.
    for cut in cuts.values():
        base[cut - fade : cut] *= np.linspace(1, 0, fade)
        base[cut : cut + fade] *= np.linspace(0, 1, fade)
    base = np.round(base * 32767).astype(np.int16)
    pad, pause = round(0.15 * rate), round(0.7 * rate)
    choices, files = [], {}
    with tempfile.TemporaryDirectory(prefix="voice-listening-examples-") as temp:
        for label, word_index in (("a", 3), ("b", 1)):
            cut = cuts[label]
            samples = np.concatenate(
                (
                    np.zeros(pad, dtype=np.int16),
                    base[:cut],
                    np.zeros(pause, dtype=np.int16),
                    base[cut:],
                    np.zeros(pad, dtype=np.int16),
                )
            )
            path = Path(temp) / (label + ".wav")
            sf.write(path, samples, rate, subtype="PCM_16")
            encoded = path.read_bytes()
            digest = hashlib.sha256(encoded).hexdigest()
            filename = f"{label}-{digest[:16]}.wav"
            files[filename] = encoded
            choices.append(
                {
                    "id": label,
                    "label": label.upper(),
                    "audio_url": f"/practice-examples/pauses-{version}/{filename}",
                    "sha256": digest,
                    "duration_seconds": round(len(samples) / rate, 5),
                    "sample_rate": rate,
                    "pause_after_word_index": word_index,
                    "inserted_pause_start_sample": pad + cut,
                    "inserted_pause_samples": pause,
                    "paused_text": " ".join(TEXT.split()[: word_index + 1])
                    + " / "
                    + " ".join(TEXT.split()[word_index + 1 :]),
                }
            )
    try:
        package = subprocess.run(
            ["dpkg-query", "-W", "-f=${Version}", "libflite1"], capture_output=True, text=True, check=True
        ).stdout
    except (FileNotFoundError, subprocess.CalledProcessError):
        package = "unreported"
    example = {
        "id": f"pauses-thought-groups-{version}",
        "version": version,
        "exercise_id": "E08",
        "source": "synthetic",
        "title": "Hear where a pause falls",
        "text": TEXT,
        "question": "Which version keeps ‘the old bridge’ together?",
        "grouped_choice": "a",
        "explanation": "A pauses after ‘bridge’, leaving ‘the old bridge’ together. B puts the same added silence after ‘the’, splitting that group. Notice the position rather than copying the length.",
        "transfer_prompt": "Choose one thought boundary in your own text to listen for. Keep short word groups connected when that supports the meaning.",
        "provenance_note": "Synthesized speech for comparing pause positions, not a target voice or an assessment of your speech.",
        "synthesizer": "Flite/cmu_us_slt",
        "synthesizer_package_version": package,
        "notice_url": "/practice-examples/NOTICE.txt",
        "inserted_pause_seconds": 0.7,
        "base_pcm_sha256": hashlib.sha256(base.tobytes()).hexdigest(),
        "base_samples": len(base),
        "edge_padding_samples": pad,
        "choices": choices,
    }
    return example, files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", default="v1")
    parser.add_argument("--output-root", type=Path, default=ROOT / "frontend/public/practice-examples")
    parser.add_argument("--manifest", type=Path, default=ROOT / "app/content/listening-examples.json")
    args = parser.parse_args()
    example, files = build(args.version)
    manifest = (
        json.loads(args.manifest.read_text())
        if args.manifest.exists()
        else {"schema_version": "listening-examples-v1", "default_by_exercise": {}, "examples": {}}
    )
    prior = manifest["examples"].get(example["id"])
    if prior is not None and prior != example:
        raise RuntimeError("An immutable example would change. Use a new --version instead.")
    directory = args.output_root / ("pauses-" + args.version)
    for filename, data in files.items():
        path = directory / filename
        if path.exists() and path.read_bytes() != data:
            raise RuntimeError("Existing audio differs from the generated bytes")
    directory.mkdir(parents=True, exist_ok=True)
    for filename, data in files.items():
        (directory / filename).write_bytes(data)
    manifest["examples"][example["id"]] = example
    manifest["default_by_exercise"][example["exercise_id"]] = example["id"]
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(
        json.dumps(
            {
                "example_id": example["id"],
                "files": list(files),
                "duration_seconds": example["choices"][0]["duration_seconds"],
                "network_calls": 0,
            }
        )
    )


if __name__ == "__main__":
    main()
