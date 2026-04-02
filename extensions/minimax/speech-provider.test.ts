import { describe, expect, it } from "vitest";
import {
  isValidMinimaxModel,
  MINIMAX_TTS_MODELS,
  MINIMAX_TTS_VOICES,
} from "./tts.js";
import { buildMiniMaxSpeechProvider } from "./speech-provider.js";

describe("minimax speech provider", () => {
  describe("isValidMinimaxModel", () => {
    it("matches the supported MiniMax model set and rejects unsupported values", () => {
      expect(MINIMAX_TTS_MODELS).toContain("speech-2.8-hd");
      expect(MINIMAX_TTS_MODELS).toContain("speech-2.8-turbo");
      expect(MINIMAX_TTS_MODELS).toContain("speech-2.6-hd");
      expect(MINIMAX_TTS_MODELS).toContain("speech-2.6-turbo");
      expect(MINIMAX_TTS_MODELS).toContain("speech-02-hd");
      expect(MINIMAX_TTS_MODELS).toContain("speech-02-turbo");
      expect(MINIMAX_TTS_MODELS.length).toBeGreaterThan(0);

      const cases = [
        { model: "speech-2.8-hd", expected: true },
        { model: "speech-2.8-turbo", expected: true },
        { model: "speech-2.6-hd", expected: true },
        { model: "speech-02-hd", expected: true },
        { model: "invalid", expected: false },
        { model: "", expected: false },
        { model: "gpt-4o-mini-tts", expected: false },
      ] as const;
      for (const testCase of cases) {
        expect(isValidMinimaxModel(testCase.model), testCase.model).toBe(testCase.expected);
      }
    });
  });

  describe("MINIMAX_TTS_VOICES", () => {
    it("contains representative system voices", () => {
      expect(MINIMAX_TTS_VOICES.length).toBeGreaterThan(0);
      expect(MINIMAX_TTS_VOICES).toContain("English_expressive_narrator");
    });
  });

  describe("buildMiniMaxSpeechProvider", () => {
    it("builds a provider with expected id and properties", () => {
      const provider = buildMiniMaxSpeechProvider();
      expect(provider.id).toBe("minimax");
      expect(provider.label).toBe("MiniMax");
      expect(provider.models).toEqual(MINIMAX_TTS_MODELS);
      expect(provider.voices).toEqual(MINIMAX_TTS_VOICES);
      expect(provider.autoSelectOrder).toBe(25);
      expect(typeof provider.synthesize).toBe("function");
      expect(typeof provider.synthesizeTelephony).toBe("function");
      expect(typeof provider.isConfigured).toBe("function");
      expect(typeof provider.parseDirectiveToken).toBe("function");
    });
  });
});
