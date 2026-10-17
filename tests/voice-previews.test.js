import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ASSISTANT_VOICES, resolveAssistantVoice } from '../constants/enums.js';
import { getVoicePreview } from '../services/ai/voicePreview.js';
import { synthesizeSpeech } from '../services/ai/audio.js';
import { resetAiProviderClientsForTests, setAiProviderClientForTests } from '../services/ai/providers/index.js';

const directories = [];
afterEach(async () => {
  resetAiProviderClientsForTests();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
const directory = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aurox-previews-'));
  directories.push(dir);
  return dir;
};
const speech = (input, voice) => ({ buffer: Buffer.from(`ID3:${input}`), voice, format: 'mp3', contentType: 'audio/mpeg' });

describe('reusable voice previews', () => {
  it('recovers a transient speech failure without retrying the AI answer', async () => {
    const create = vi.fn().mockRejectedValueOnce({ status: 503 }).mockResolvedValue({
      arrayBuffer: async () => Uint8Array.from([73, 68, 51]).buffer
    });
    setAiProviderClientForTests('openai', { audio: { speech: { create } } });
    expect((await synthesizeSpeech('Olá!', 'nova')).buffer.length).toBe(3);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('does not retry a missing or invalid voice credential', async () => {
    const create = vi.fn().mockRejectedValue({ status: 401 });
    setAiProviderClientForTests('openai', { audio: { speech: { create } } });
    await expect(synthesizeSpeech('Olá!', 'nova')).rejects.toMatchObject({ code: 'AI_AUDIO_UNAVAILABLE' });
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('coalesces first taps and reuses the saved audio after memory is gone', async () => {
    const dir = await directory();
    const generate = vi.fn(async (...args) => speech(...args));
    const options = { directory: dir, synthesize: generate };
    const [first, concurrent] = await Promise.all([
      getVoicePreview('nova', 'pt', options), getVoicePreview('nova', 'pt', options)
    ]);
    expect(concurrent.buffer.equals(first.buffer)).toBe(true);
    expect(generate).toHaveBeenCalledExactlyOnceWith('Olá! Como posso ajudar?', 'nova');
    const mustNotGenerate = vi.fn(() => { throw new Error('Would bill again'); });
    const restored = await getVoicePreview('nova', 'pt', { directory: dir, synthesize: mustNotGenerate });
    expect(restored.buffer.equals(first.buffer)).toBe(true);
    expect(mustNotGenerate).not.toHaveBeenCalled();
    expect(await readdir(dir)).toHaveLength(1);
  });

  it('keeps languages separate and retries a failed generation', async () => {
    const dir = await directory();
    const generate = vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockImplementation(async (...args) => speech(...args));
    const options = { directory: dir, synthesize: generate };
    await expect(getVoicePreview('echo', 'es', options)).rejects.toThrow('Unavailable');
    await getVoicePreview('echo', 'es', options);
    await getVoicePreview('echo', 'en', options);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(await readdir(dir)).toHaveLength(2);
  });

  it('synthesizes all four voices and maps retired selections to supported voices', async () => {
    const create = vi.fn(async () => ({ arrayBuffer: async () => Buffer.from('ID3').buffer }));
    setAiProviderClientForTests('openai', { audio: { speech: { create } } });
    for (const voice of [...ASSISTANT_VOICES, 'marin', 'cedar', 'ballad', 'alloy']) {
      const result = await synthesizeSpeech('How can I help you?', voice);
      expect(ASSISTANT_VOICES).toContain(result.voice);
      expect(create.mock.lastCall[0].voice).toBe(resolveAssistantVoice(voice));
    }
    expect(ASSISTANT_VOICES).toEqual(['echo', 'onyx', 'nova', 'shimmer']);
  });
});
