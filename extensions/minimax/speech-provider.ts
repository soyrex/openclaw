import { execSync } from "node:child_process";
import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/secret-input";
import type {
  SpeechDirectiveTokenParseContext,
  SpeechProviderConfig,
  SpeechProviderOverrides,
  SpeechProviderPlugin,
} from "openclaw/plugin-sdk/speech";
import { requireInRange } from "openclaw/plugin-sdk/speech";
import {
  isValidMinimaxModel,
  MINIMAX_TTS_EMOTIONS,
  MINIMAX_TTS_MODELS,
  MINIMAX_TTS_VOICES,
  minimaxTTS,
} from "./tts.js";

const DEFAULT_MINIMAX_BASE_URL = "https://api.minimax.io";
const DEFAULT_MINIMAX_MODEL = "speech-2.8-hd";
const DEFAULT_MINIMAX_VOICE_ID = "English_expressive_narrator";
const DEFAULT_MINIMAX_SPEED = 1.0;
const DEFAULT_MINIMAX_VOL = 1.0;
const DEFAULT_MINIMAX_PITCH = 0;

type MiniMaxTtsProviderConfig = {
  apiKey?: string;
  baseUrl: string;
  model: string;
  voiceId: string;
  speed: number;
  vol: number;
  pitch: number;
  emotion?: string;
  languageBoost?: string;
};

function trimToUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseNumberValue(value: string): number | undefined {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeMiniMaxBaseUrl(baseUrl: string | undefined): string {
  const trimmed = baseUrl?.trim();
  return trimmed?.replace(/\/+$/, "") || DEFAULT_MINIMAX_BASE_URL;
}

function convertMp3ToOggOpus(mp3Buffer: Buffer): Buffer {
  try {
    return execSync("ffmpeg -y -i pipe:0 -ar 48000 -ac 1 -c:a libopus -b:a 64k -f ogg pipe:1", {
      input: mp3Buffer,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    throw new Error(
      `MiniMax MP3→OGG conversion failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function normalizeMiniMaxProviderConfig(
  rawConfig: Record<string, unknown>,
): MiniMaxTtsProviderConfig {
  const providers = asObject(rawConfig.providers);
  const raw = asObject(providers?.minimax) ?? asObject(rawConfig.minimax);
  return {
    apiKey: normalizeResolvedSecretInputString({
      value: raw?.apiKey,
      path: "messages.tts.providers.minimax.apiKey",
    }),
    baseUrl: normalizeMiniMaxBaseUrl(trimToUndefined(raw?.baseUrl)),
    model: trimToUndefined(raw?.model) ?? DEFAULT_MINIMAX_MODEL,
    voiceId: trimToUndefined(raw?.voiceId) ?? DEFAULT_MINIMAX_VOICE_ID,
    speed: asNumber(raw?.speed) ?? DEFAULT_MINIMAX_SPEED,
    vol: asNumber(raw?.vol) ?? DEFAULT_MINIMAX_VOL,
    pitch: asNumber(raw?.pitch) ?? DEFAULT_MINIMAX_PITCH,
    emotion: trimToUndefined(raw?.emotion),
    languageBoost: trimToUndefined(raw?.languageBoost),
  };
}

function readMiniMaxProviderConfig(config: SpeechProviderConfig): MiniMaxTtsProviderConfig {
  const defaults = normalizeMiniMaxProviderConfig({});
  return {
    apiKey: trimToUndefined(config.apiKey) ?? defaults.apiKey,
    baseUrl: normalizeMiniMaxBaseUrl(trimToUndefined(config.baseUrl) ?? defaults.baseUrl),
    model: trimToUndefined(config.model) ?? defaults.model,
    voiceId: trimToUndefined(config.voiceId) ?? defaults.voiceId,
    speed: asNumber(config.speed) ?? defaults.speed,
    vol: asNumber(config.vol) ?? defaults.vol,
    pitch: asNumber(config.pitch) ?? defaults.pitch,
    emotion: trimToUndefined(config.emotion) ?? defaults.emotion,
    languageBoost: trimToUndefined(config.languageBoost) ?? defaults.languageBoost,
  };
}

function parseDirectiveToken(ctx: SpeechDirectiveTokenParseContext): {
  handled: boolean;
  overrides?: SpeechProviderOverrides;
  warnings?: string[];
} {
  try {
    switch (ctx.key) {
      case "minimax_voice":
      case "minimaxvoice":
        if (!ctx.policy.allowVoice) {
          return { handled: true };
        }
        return {
          handled: true,
          overrides: { ...(ctx.currentOverrides ?? {}), voiceId: ctx.value },
        };
      case "model":
      case "minimax_model":
      case "minimaxmodel":
        if (!ctx.policy.allowModelId) {
          return { handled: true };
        }
        if (!isValidMinimaxModel(ctx.value)) {
          return { handled: false };
        }
        return {
          handled: true,
          overrides: { ...(ctx.currentOverrides ?? {}), model: ctx.value },
        };
      case "emotion": {
        if (!ctx.policy.allowVoiceSettings) {
          return { handled: true };
        }
        if (!(MINIMAX_TTS_EMOTIONS as readonly string[]).includes(ctx.value.toLowerCase())) {
          return {
            handled: true,
            warnings: [`invalid MiniMax emotion "${ctx.value}"`],
          };
        }
        return {
          handled: true,
          overrides: { ...(ctx.currentOverrides ?? {}), emotion: ctx.value.toLowerCase() },
        };
      }
      case "speed": {
        if (!ctx.policy.allowVoiceSettings) {
          return { handled: true };
        }
        const value = parseNumberValue(ctx.value);
        if (value == null) {
          return { handled: true, warnings: ["invalid speed value"] };
        }
        requireInRange(value, 0.5, 2, "speed");
        return {
          handled: true,
          overrides: { ...(ctx.currentOverrides ?? {}), speed: value },
        };
      }
      case "vol":
      case "volume": {
        if (!ctx.policy.allowVoiceSettings) {
          return { handled: true };
        }
        const value = parseNumberValue(ctx.value);
        if (value == null) {
          return { handled: true, warnings: ["invalid vol value"] };
        }
        requireInRange(value, 0, 10, "vol");
        return {
          handled: true,
          overrides: { ...(ctx.currentOverrides ?? {}), vol: value },
        };
      }
      case "pitch": {
        if (!ctx.policy.allowVoiceSettings) {
          return { handled: true };
        }
        const value = parseNumberValue(ctx.value);
        if (value == null) {
          return { handled: true, warnings: ["invalid pitch value"] };
        }
        if (!Number.isInteger(value)) {
          return { handled: true, warnings: ["pitch must be an integer"] };
        }
        requireInRange(value, -12, 12, "pitch");
        return {
          handled: true,
          overrides: { ...(ctx.currentOverrides ?? {}), pitch: value },
        };
      }
      case "language_boost":
      case "languageboost":
        if (!ctx.policy.allowNormalization) {
          return { handled: true };
        }
        return {
          handled: true,
          overrides: { ...(ctx.currentOverrides ?? {}), languageBoost: ctx.value },
        };
      default:
        return { handled: false };
    }
  } catch (error) {
    return {
      handled: true,
      warnings: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export function buildMiniMaxSpeechProvider(): SpeechProviderPlugin {
  return {
    id: "minimax",
    label: "MiniMax",
    aliases: ["minimax-speech"],
    autoSelectOrder: 25,
    models: MINIMAX_TTS_MODELS,
    voices: MINIMAX_TTS_VOICES,
    resolveConfig: ({ rawConfig }) => normalizeMiniMaxProviderConfig(rawConfig),
    parseDirectiveToken,
    resolveTalkConfig: ({ baseTtsConfig, talkProviderConfig }) => {
      const base = normalizeMiniMaxProviderConfig(baseTtsConfig);
      return {
        ...base,
        ...(talkProviderConfig.apiKey === undefined
          ? {}
          : {
              apiKey: normalizeResolvedSecretInputString({
                value: talkProviderConfig.apiKey,
                path: "talk.providers.minimax.apiKey",
              }),
            }),
        ...(trimToUndefined(talkProviderConfig.baseUrl) == null
          ? {}
          : { baseUrl: normalizeMiniMaxBaseUrl(trimToUndefined(talkProviderConfig.baseUrl)) }),
        ...(trimToUndefined(talkProviderConfig.voiceId) == null
          ? {}
          : { voiceId: trimToUndefined(talkProviderConfig.voiceId) }),
        ...(trimToUndefined(talkProviderConfig.modelId) == null
          ? {}
          : { model: trimToUndefined(talkProviderConfig.modelId) }),
        ...(asNumber(talkProviderConfig.speed) == null
          ? {}
          : { speed: asNumber(talkProviderConfig.speed) }),
        ...(asNumber(talkProviderConfig.vol) == null
          ? {}
          : { vol: asNumber(talkProviderConfig.vol) }),
        ...(asNumber(talkProviderConfig.pitch) == null
          ? {}
          : { pitch: asNumber(talkProviderConfig.pitch) }),
        ...(trimToUndefined(talkProviderConfig.emotion) == null
          ? {}
          : { emotion: trimToUndefined(talkProviderConfig.emotion) }),
        ...(trimToUndefined(talkProviderConfig.languageBoost) == null
          ? {}
          : { languageBoost: trimToUndefined(talkProviderConfig.languageBoost) }),
      };
    },
    resolveTalkOverrides: ({ params }) => ({
      ...(trimToUndefined(params.voiceId) == null
        ? {}
        : { voiceId: trimToUndefined(params.voiceId) }),
      ...(trimToUndefined(params.modelId) == null
        ? {}
        : { model: trimToUndefined(params.modelId) }),
      ...(asNumber(params.speed) == null ? {} : { speed: asNumber(params.speed) }),
      ...(asNumber(params.vol) == null ? {} : { vol: asNumber(params.vol) }),
      ...(asNumber(params.pitch) == null ? {} : { pitch: asNumber(params.pitch) }),
      ...(trimToUndefined(params.emotion) == null
        ? {}
        : { emotion: trimToUndefined(params.emotion) }),
      ...(trimToUndefined(params.languageBoost) == null
        ? {}
        : { languageBoost: trimToUndefined(params.languageBoost) }),
    }),
    listVoices: async () => MINIMAX_TTS_VOICES.map((voice) => ({ id: voice, name: voice })),
    isConfigured: ({ providerConfig }) =>
      Boolean(readMiniMaxProviderConfig(providerConfig).apiKey || process.env.MINIMAX_API_KEY),
    synthesize: async (req) => {
      const config = readMiniMaxProviderConfig(req.providerConfig);
      const overrides = req.providerOverrides ?? {};
      const apiKey = config.apiKey || process.env.MINIMAX_API_KEY;
      if (!apiKey) {
        throw new Error("MiniMax API key missing");
      }
      // MiniMax always produces MP3 regardless of channel target.
      const audioBuffer = await minimaxTTS({
        text: req.text,
        apiKey,
        baseUrl: config.baseUrl,
        model: trimToUndefined(overrides.model) ?? config.model,
        voiceId: trimToUndefined(overrides.voiceId) ?? config.voiceId,
        audioFormat: "mp3",
        sampleRate: 32_000,
        speed: asNumber(overrides.speed) ?? config.speed,
        vol: asNumber(overrides.vol) ?? config.vol,
        pitch: asNumber(overrides.pitch) ?? config.pitch,
        emotion: trimToUndefined(overrides.emotion) ?? config.emotion,
        languageBoost: trimToUndefined(overrides.languageBoost) ?? config.languageBoost,
        timeoutMs: req.timeoutMs,
      });
      const isVoiceNote = req.target === "voice-note";
      let finalBuffer = audioBuffer;
      let outputFormat = "mp3";
      let fileExtension = ".mp3";
      let voiceCompatible = false;
      if (isVoiceNote) {
        finalBuffer = convertMp3ToOggOpus(audioBuffer);
        outputFormat = "ogg";
        fileExtension = ".ogg";
        voiceCompatible = true;
      }
      return {
        audioBuffer: finalBuffer,
        outputFormat,
        fileExtension,
        voiceCompatible,
      };
    },
    synthesizeTelephony: async (req) => {
      const config = readMiniMaxProviderConfig(req.providerConfig);
      const apiKey = config.apiKey || process.env.MINIMAX_API_KEY;
      if (!apiKey) {
        throw new Error("MiniMax API key missing");
      }
      const outputFormat = "pcm";
      const sampleRate = 24_000;
      const audioBuffer = await minimaxTTS({
        text: req.text,
        apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        voiceId: config.voiceId,
        audioFormat: outputFormat,
        sampleRate,
        speed: config.speed,
        vol: config.vol,
        pitch: config.pitch,
        emotion: config.emotion,
        languageBoost: config.languageBoost,
        timeoutMs: req.timeoutMs,
      });
      return { audioBuffer, outputFormat, sampleRate };
    },
  };
}
