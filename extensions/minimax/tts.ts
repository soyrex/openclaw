import { requireInRange } from "openclaw/plugin-sdk/speech";

const DEFAULT_MINIMAX_BASE_URL = "https://api.minimax.io";

export const MINIMAX_TTS_MODELS = [
  "speech-2.8-hd",
  "speech-2.8-turbo",
  "speech-2.6-hd",
  "speech-2.6-turbo",
  "speech-02-hd",
  "speech-02-turbo",
] as const;

export const MINIMAX_TTS_EMOTIONS = [
  "happy",
  "sad",
  "angry",
  "fearful",
  "disgusted",
  "surprised",
  "calm",
  "fluent",
  "whisper",
] as const;

/** A few representative system voices for the gateway providers listing. */
export const MINIMAX_TTS_VOICES = [
  "English_expressive_narrator",
  "English_radiant_girl",
  "English_Trustworth_Man",
  "English_CalmWoman",
  "English_Graceful_Lady",
] as const;

export function isValidMinimaxModel(model: string): boolean {
  return MINIMAX_TTS_MODELS.includes(model as (typeof MINIMAX_TTS_MODELS)[number]);
}

type MiniMaxT2AResponse = {
  data?: {
    audio?: string;
    status?: number;
  };
  extra_info?: {
    audio_format?: string;
    audio_sample_rate?: number;
  };
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
};

export async function minimaxTTS(params: {
  text: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  voiceId: string;
  audioFormat: "mp3" | "pcm" | "flac";
  sampleRate?: number;
  speed: number;
  vol: number;
  pitch: number;
  emotion?: string;
  languageBoost?: string;
  timeoutMs: number;
}): Promise<Buffer> {
  const {
    text,
    apiKey,
    baseUrl,
    model,
    voiceId,
    audioFormat,
    sampleRate,
    speed,
    vol,
    pitch,
    emotion,
    languageBoost,
    timeoutMs,
  } = params;

  requireInRange(speed, 0.5, 2, "speed");
  requireInRange(vol, 0, 10, "vol");
  requireInRange(pitch, -12, 12, "pitch");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const normalizedBase = baseUrl.trim().replace(/\/+$/, "") || DEFAULT_MINIMAX_BASE_URL;
    // Strip trailing /v1 if present to avoid /v1/v1/t2a_v2 when the user
    // configures a versioned base URL (e.g. https://api.minimax.io/v1).
    const base = normalizedBase.replace(/\/v1$/, "");
    const url = `${base}/v1/t2a_v2`;

    const body: Record<string, unknown> = {
      model,
      text,
      stream: false,
      output_format: "hex",
      voice_setting: {
        voice_id: voiceId,
        speed,
        vol,
        pitch,
        ...(emotion ? { emotion } : {}),
      },
      audio_setting: {
        format: audioFormat,
        ...(sampleRate ? { sample_rate: sampleRate } : {}),
      },
    };
    if (languageBoost) {
      body.language_boost = languageBoost;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`MiniMax T2A API error (${response.status})`);
    }

    const json = (await response.json()) as MiniMaxT2AResponse;

    if (json.base_resp?.status_code && json.base_resp.status_code !== 0) {
      throw new Error(
        `MiniMax T2A error ${json.base_resp.status_code}: ${json.base_resp.status_msg ?? "unknown"}`,
      );
    }

    const hexAudio = json.data?.audio;
    if (!hexAudio) {
      throw new Error("MiniMax T2A returned no audio data");
    }

    if (hexAudio.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hexAudio)) {
      throw new Error("MiniMax T2A returned malformed hex audio data");
    }

    const audioBuffer = Buffer.from(hexAudio, "hex");
    if (audioBuffer.length === 0) {
      throw new Error("MiniMax T2A hex audio decoded to empty buffer");
    }

    return audioBuffer;
  } finally {
    clearTimeout(timeout);
  }
}
