import { mkdir, writeFile } from 'node:fs/promises';
import { env } from '../config/env.js';
import { ASSISTANT_VOICES } from '../constants/enums.js';
import { synthesizeSpeech, transcribeAudio } from '../services/ai/audio.js';
import { createAiProviderSession } from '../services/ai/providers/index.js';

// Only synthetic phrases; no database connection, accounts or calendar writes.
const output = process.env.VOICE_QA_OUTPUT || '/tmp/aurox-voice-qa';
await mkdir(output, { recursive: true });
console.log(JSON.stringify({ tts: env.OPENAI_TTS_MODEL, transcribe: env.OPENAI_TRANSCRIBE_MODEL, text: env.OPENAI_MODEL }));
let sample;
for (const voice of ASSISTANT_VOICES) {
  const started = Date.now();
  const speech = await synthesizeSpeech('Olá! Como posso ajudar?', voice);
  if (speech.buffer.length < 1000) throw new Error(`Empty or invalid MP3 for ${voice}`);
  await writeFile(`${output}/${voice}.mp3`, speech.buffer);
  console.log(JSON.stringify({ voice, bytes: speech.buffer.length, latencyMs: Date.now() - started }));
  if (voice === 'nova') sample = speech.buffer;
}
const transcript = await transcribeAudio({ buffer: sample, originalname: 'nova.mp3', mimetype: 'audio/mpeg' });
if (!/ajudar/i.test(transcript.text)) throw new Error('Portuguese speech did not round-trip');
console.log(JSON.stringify({ stage: 'transcription', text: transcript.text }));
const session = createAiProviderSession('openai', {
  systemInstruction: 'You are a helpful calendar assistant. Respond in Portuguese with one brief sentence. No events are scheduled today.',
  history: [], tools: []
});
let streamed = '';
const response = await session.sendUserMessageStream('O que tenho no calendário hoje?', (delta) => { streamed += delta; });
if (!response.text.trim() || !streamed.trim()) throw new Error('Text stream returned no answer');
const reply = await synthesizeSpeech(response.text, 'nova');
await writeFile(`${output}/reply.mp3`, reply.buffer);
console.log(JSON.stringify({ stage: 'spoken_reply', streamed: !!streamed, bytes: reply.buffer.length, text: response.text }));
