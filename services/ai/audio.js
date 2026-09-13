import path from 'node:path';
import { toFile } from 'openai';
import { StatusCodes } from 'http-status-codes';
import { env } from '../../config/env.js';
import ApiError from '../../utils/ApiError.js';
import { getAiProviderClient } from './providers/index.js';
import { AiProviderError, normalizeProviderError, withTimeout } from './providers/errors.js';

const MAX_TRANSCRIPT_CHARACTERS = 10_000;
const MAX_SPEECH_CHARACTERS = 4_096;
const supportedExtensions = new Set(['.flac', '.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.ogg', '.wav', '.webm']);
const extensionByMimeType = {
  'audio/flac': '.flac',
  'audio/m4a': '.m4a',
  'audio/mp3': '.mp3',
  'audio/mp4': '.mp4',
  'audio/mpeg': '.mp3',
  'audio/mpga': '.mpga',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/webm': '.webm',
  'audio/x-m4a': '.m4a',
  'audio/x-wav': '.wav',
  'video/mp4': '.mp4',
  'video/webm': '.webm'
};

const audioApiError = (error, operation) => {
  if (error instanceof ApiError) return error;
  const providerError = normalizeProviderError(error, 'openai');
  if (providerError.category === 'timeout') {
    return new ApiError(StatusCodes.GATEWAY_TIMEOUT, `Voice ${operation} timed out`, 'AI_AUDIO_TIMEOUT');
  }
  if (providerError.category === 'invalid_response') {
    return new ApiError(StatusCodes.BAD_GATEWAY, `Voice ${operation} failed`, 'AI_AUDIO_FAILED');
  }
  return new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'Voice service is temporarily unavailable', 'AI_AUDIO_UNAVAILABLE');
};

const uploadName = (file) => {
  const suppliedExtension = path.extname(file.originalname || '').toLowerCase();
  const mimeType = file.mimetype.toLowerCase().split(';', 1)[0];
  const extension = supportedExtensions.has(suppliedExtension)
    ? suppliedExtension
    : extensionByMimeType[mimeType];
  return `voice-message${extension}`;
};

const speechText = (text) => {
  if (text.length <= MAX_SPEECH_CHARACTERS) return { text, truncated: false };
  return { text: `${text.slice(0, MAX_SPEECH_CHARACTERS - 3).trimEnd()}...`, truncated: true };
};

export const transcribeAudio = async (file) => {
  if (!file?.buffer?.length) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'An audio file is required', 'AUDIO_FILE_REQUIRED');
  }

  try {
    const client = getAiProviderClient('openai');
    const uploadedFile = await toFile(file.buffer, uploadName(file), { type: file.mimetype });
    const transcription = await withTimeout(client.audio.transcriptions.create({
      file: uploadedFile,
      model: env.OPENAI_TRANSCRIBE_MODEL,
      response_format: 'json'
    }), env.AI_PROVIDER_TIMEOUT_MS, 'openai');
    const text = transcription.text?.trim();
    if (!text) {
      throw new ApiError(StatusCodes.UNPROCESSABLE_ENTITY, 'No speech was detected in the audio', 'AUDIO_NO_SPEECH');
    }
    if (text.length > MAX_TRANSCRIPT_CHARACTERS) {
      throw new ApiError(StatusCodes.UNPROCESSABLE_ENTITY, 'The transcribed message is too long', 'AUDIO_TRANSCRIPT_TOO_LONG');
    }
    // OpenAI reports detected languages as `{ code }` objects; keep just the codes.
    const languages = (transcription.languages ?? [])
      .map((language) => (typeof language === 'string' ? language : language?.code))
      .filter(Boolean);
    return {
      text,
      model: env.OPENAI_TRANSCRIBE_MODEL,
      ...(languages.length && { languages }),
      ...(transcription.usage?.type === 'duration' && { durationSeconds: transcription.usage.seconds })
    };
  } catch (error) {
    throw audioApiError(error, 'transcription');
  }
};

/// The first piece of a spoken reply is a single sentence, so it starts
/// sounding as soon as that sentence exists; later pieces group sentences to
/// keep the number of synthesis requests down.
const FIRST_SPEECH_CHUNK_CHARACTERS = 1;
const SPEECH_CHUNK_CHARACTERS = 160;
// Latin, Devanagari/Bengali (।), Arabic/Urdu (؟ ۔) sentence ends are followed by
// a space; Chinese and Japanese ones (。！？) are not.
const sentenceBoundary = /[.!?…।॥؟۔]+["')\]»”’]*\s+|[。！？]+|\n+/g;

/// Markdown reads fine on screen but is spoken aloud as punctuation.
const speakable = (text) => text
  .replace(/^\s*(?:#+|[-*+]|\d+\.)\s+/gm, '')
  .replace(/\*\*|__|`/g, '')
  .trim();

/// Cuts a reply into the pieces it is spoken in. A piece only ends at a
/// sentence boundary the text has already moved past, so while the reply is
/// still arriving (`final: false`) the unfinished tail is held back and every
/// piece returned is exactly the piece the finished text will produce.
export const splitSpeechChunks = (text, { final = true } = {}) => {
  const chunks = [];
  let start = 0;
  for (const match of text.matchAll(sentenceBoundary)) {
    const end = match.index + match[0].length;
    const piece = speakable(text.slice(start, end));
    const target = chunks.length ? SPEECH_CHUNK_CHARACTERS : FIRST_SPEECH_CHUNK_CHARACTERS;
    if (piece.length >= target) {
      chunks.push(piece);
      start = end;
    }
  }
  const rest = speakable(text.slice(start));
  if (final && rest) chunks.push(rest);
  return chunks;
};

/// Speaks a reply while it is still being written. Each finished sentence is
/// sent for synthesis the moment it lands, and all pieces are synthesized in
/// parallel, so the audio is ready soon after the text rather than one full
/// synthesis later. Text the model retracts (`reset`) is dropped; `finish`
/// reconciles with the saved reply, reusing every piece that still matches.
export const createSpeechPipeline = ({ voice, isCancelled = () => false } = {}) => {
  let text = '';
  let jobs = [];

  const schedule = (chunks) => {
    jobs = jobs.slice(0, chunks.length);
    chunks.forEach((chunk, index) => {
      if (jobs[index]?.text === chunk) return;
      jobs = jobs.slice(0, index);
      if (isCancelled()) return;
      const audio = synthesizeSpeech(chunk, voice);
      // Awaited in order by `finish`, or never if the text is retracted.
      audio.catch(() => {});
      jobs[index] = { text: chunk, audio };
    });
  };

  return {
    push(delta) {
      text += delta;
      schedule(splitSpeechChunks(text, { final: false }));
    },
    reset() {
      text = '';
      jobs = [];
    },
    /// Hands each piece to `emit` in order, as soon as it and every piece
    /// before it are ready.
    async finish(finalText, emit) {
      const chunks = splitSpeechChunks(finalText);
      schedule(chunks);
      for (let index = 0; index < chunks.length; index += 1) {
        if (isCancelled() || !jobs[index]) return;
        emit({ index, last: index === chunks.length - 1, speech: await jobs[index].audio });
      }
    }
  };
};

export const synthesizeSpeech = async (input, requestedVoice) => {
  const prepared = speechText(input);
  const voice = requestedVoice || env.OPENAI_TTS_VOICE;
  try {
    const client = getAiProviderClient('openai');
    const operation = (async () => {
      const response = await client.audio.speech.create({
        model: env.OPENAI_TTS_MODEL,
        voice,
        input: prepared.text,
        response_format: 'mp3'
      });
      return Buffer.from(await response.arrayBuffer());
    })();
    const buffer = await withTimeout(operation, env.AI_PROVIDER_TIMEOUT_MS, 'openai');
    if (!buffer.length) throw new AiProviderError('OpenAI returned empty speech audio', { category: 'invalid_response', provider: 'openai' });
    return {
      buffer,
      model: env.OPENAI_TTS_MODEL,
      voice,
      format: 'mp3',
      contentType: 'audio/mpeg',
      inputCharacters: prepared.text.length,
      truncated: prepared.truncated
    };
  } catch (error) {
    throw audioApiError(error, 'generation');
  }
};
