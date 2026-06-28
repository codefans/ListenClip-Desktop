#!/usr/bin/env python3
"""
ListenClip Desktop — local Whisper transcription script.
Usage: python transcribe.py <audio_path> <model_size> [language]

Outputs a JSON array to stdout:
  [{"id": 0, "start": 0.0, "end": 3.2, "text": "Hello world"}, ...]

Progress lines (prefixed with PROGRESS:) are emitted to stderr so the
caller can parse them without interfering with the JSON output.
"""
import sys
import json
import os

def eprint(msg: str) -> None:
    print(f"PROGRESS:{msg}", file=sys.stderr, flush=True)

def transcribe_faster_whisper(audio_path: str, model_size: str, language: str | None):
    from faster_whisper import WhisperModel  # type: ignore

    eprint(f"加载模型 {model_size}（首次运行将自动下载）...")
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    eprint("模型已就绪，开始转录...")

    segments, _info = model.transcribe(
        audio_path,
        beam_size=5,
        language=language,
        vad_filter=True,          # skip silent parts
        vad_parameters={"min_silence_duration_ms": 500},
    )

    result = []
    for seg in segments:
        result.append({
            "id": seg.id,
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
            "text": seg.text.strip(),
        })
        eprint(f"SEGMENT:{seg.id}:{seg.start:.2f}:{seg.end:.2f}")

    return result


def transcribe_openai_whisper(audio_path: str, model_size: str, _language: str | None):
    """Fallback: standard openai-whisper package."""
    import whisper  # type: ignore

    eprint(f"加载 openai-whisper 模型 {model_size}...")
    model = whisper.load_model(model_size)
    eprint("模型已就绪，开始转录...")

    result_raw = model.transcribe(audio_path, verbose=False)
    result = []
    for seg in result_raw.get("segments", []):
        result.append({
            "id": seg["id"],
            "start": round(seg["start"], 3),
            "end": round(seg["end"], 3),
            "text": seg["text"].strip(),
        })
        eprint(f"SEGMENT:{seg['id']}:{seg['start']:.2f}:{seg['end']:.2f}")
    return result


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: transcribe.py <audio_path> <model_size> [language]"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    model_size = sys.argv[2]
    language = sys.argv[3] if len(sys.argv) > 3 else None

    if not os.path.exists(audio_path):
        print(json.dumps({"error": f"Audio file not found: {audio_path}"}))
        sys.exit(1)

    try:
        try:
            segments = transcribe_faster_whisper(audio_path, model_size, language)
        except ImportError:
            eprint("faster-whisper 未安装，尝试 openai-whisper...")
            segments = transcribe_openai_whisper(audio_path, model_size, language)

        print(json.dumps(segments, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stdout)
        sys.exit(1)
