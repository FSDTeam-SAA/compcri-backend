import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';
import { resolveAssistantVoice } from '../../constants/enums.js';
import { synthesizeSpeech } from './audio.js';

const previewLines = {
  en: 'Hi! How can I help you?',
  pt: 'Olá! Como posso ajudar?',
  es: '¡Hola! ¿Cómo puedo ayudarte?'
};
const pending = new Map();

/// Disk survives API restarts; the promise coalesces simultaneous first taps.
/// No account name or other personal data is included in the sample or key.
export const getVoicePreview = async (requestedVoice, requestedLocale, {
  directory = env.VOICE_PREVIEW_CACHE_DIR,
  synthesize = synthesizeSpeech
} = {}) => {
  const voice = resolveAssistantVoice(requestedVoice);
  const locale = previewLines[requestedLocale] ? requestedLocale : 'en';
  const input = previewLines[locale];
  const digest = createHash('sha256').update(JSON.stringify([env.OPENAI_TTS_MODEL, voice, locale, input])).digest('hex');
  const filename = path.resolve(directory, `${digest}.mp3`);
  const existing = pending.get(filename);
  if (existing) return existing;
  const job = (async () => {
    try {
      const buffer = await readFile(filename);
      if (buffer.length) return {
        buffer, voice, model: env.OPENAI_TTS_MODEL, format: 'mp3',
        contentType: 'audio/mpeg', inputCharacters: input.length, truncated: false
      };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const speech = await synthesize(input, voice);
    await mkdir(path.dirname(filename), { recursive: true });
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, speech.buffer, { flag: 'wx' });
      await rename(temporary, filename);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return speech;
  })();
  pending.set(filename, job);
  try {
    return await job;
  } finally {
    pending.delete(filename);
  }
};
