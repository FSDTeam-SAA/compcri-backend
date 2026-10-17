# Compcri AI Calendar API

Production-oriented REST backend for the Compcri mobile calendar app and admin panel. V1 provides an internal calendar, delegated assistant access, dual-provider AI-assisted scheduling with confirmation gates, cost-efficient turn-based voice messaging, RevenueCat entitlement handling, FCM notifications, and recoverable account deletion.

Realtime speech-to-speech calls, external calendar synchronization, coupons/influencers, web billing, and direct card collection are intentionally outside v1.

## Stack

- Node.js 22 and Express 5
- MongoDB Atlas or MongoDB/Mongoose with a replica set
- Agenda with a Mongo backend
- Gemini via `@google/genai` and OpenAI via the Responses API
- RevenueCat server API and authenticated webhooks
- Firebase Cloud Messaging
- Cloudinary owner-bound image assets
- Argon2id, short-lived JWT access tokens, and rotated hashed refresh tokens
- Zod, Helmet, CORS allowlisting, Mongo-backed rate limits, Pino logs, OpenAPI 3.1, Vitest, and Supertest

## Local setup

1. Copy `.env.example` to `.env` and replace all secrets.
2. Configure MongoDB Atlas, or start a local MongoDB replica set.
3. Install, migrate, seed, and start the API and worker:

```bash
npm install
npm run db:migrate
npm run seed
npm run dev
npm run dev:worker
```

The API listens on `http://localhost:5000`. Swagger UI is at `/docs`, OpenAPI JSON at `/openapi.json`, and readiness/liveness probes at `/health/ready` and `/health/live`.

## Commands

```bash
npm start              # API process
npm run worker         # Agenda worker process
npm run db:migrate     # synchronize declared MongoDB indexes
npm run seed           # legal placeholders and initial administrator
npm run docs:postman   # regenerate the Postman collection from OpenAPI
npm run benchmark:ai  # compare Gemini and OpenAI on synthetic calendar scenarios
npm test               # integration suite on an isolated replica set
npm run test:coverage
```

The seed uses `ADMIN_EMAIL` and `ADMIN_PASSWORD`; there is no public administrator signup. Replace the seeded legal placeholder text before production.

Postman files are in `docs/postman`. Import the collection and environment, select the environment, then run the authentication requests first. See `docs/postman/README.md` for the recommended workflow.

## API areas

- `/api/v1/auth` — password/Google authentication, refresh rotation, logout, reset OTP, deletion restoration
- `/api/v1/users/me` — profile, preferences, calendars, subscription management, deletion request
- `/api/v1/media` — authenticated avatar, poster, and support-attachment uploads
- `/api/v1/calendars` and `/api/v1/events` — range expansion, RRULE exceptions, conflicts, availability, sharing, and RSVP
- `/api/v1/delegations` — assistant lookup, creation/linking, presets, and revocation
- `/api/v1/contacts`, `/api/v1/contact-requests`, `/api/v1/groups` — network, membership, invitations, and group events
- `/api/v1/ai` — conversations, text/voice messages, quota, and confirm/reject pending mutations
- `/api/v1/notes` — personal typed and dictated notes, optionally filed against an event
- `/api/v1/notifications` and `/api/v1/devices` — inbox and FCM token lifecycle
- `/api/v1/subscriptions` and `/api/v1/webhooks/revenuecat` — entitlement snapshots and reconciliation
- `/api/v1/admin` — dashboard, users, subscriptions, profile, and audit logs

All normal responses use `{ "success": true, "data": ... }`; errors use `{ "success": false, "error": { "code", "message", "requestId", "details"? } }`.

## Event reminders

Manual and AI-created events notify at their start time by default (`reminderMinutes: [0]`). An advance reminder is additional: `[0, 10]` sends notifications ten minutes before and at the start. Supplying `[10]` also includes the start notification; `[]` explicitly disables reminders for that event. If the advance time has already passed when an event is created or moved, the start notification is still scheduled.

For one recurring occurrence, send `overrides.reminderMinutes` to `PUT /events/{eventId}/recurrence-exception` using its `occurrenceOriginalStartAt` as `originalStartAt`. The setting applies only to that occurrence: `[]` turns its reminders off, and omitting the field preserves the existing setting. An enabled occurrence is scheduled even when the rest of the series has reminders off. Calendar rows always expose the original slot alongside the moved time.

Notifications remain enabled when alarm sound is off. Sound follows the user's **Alarm-style Reminders** setting, and device permissions and notification-channel settings must permit delivery. Turning off **Event Reminders** disables reminders across the account.

After deploying changes, restart both the API and the Agenda worker (`npm run worker`), with `DISABLE_JOBS=false`. The API saves jobs; the worker sends the notifications. Worker startup refreshes reminders for existing future events. Push delivery is asynchronous, so device receipt may be shortly after the scheduled time.

## Conversation history

Free accounts retain inactive conversations for 7 days; Pro accounts retain them for 30 days. Configure these windows with `CHAT_RETENTION_DAYS_FREE` and `CHAT_RETENTION_DAYS_PREMIUM`. Pro users can bookmark conversations to keep them until explicitly deleted. Bookmark changes preserve the last-message timestamp. Conversation summaries include `historyRetentionDays` and `expiresAt` (`null` for saved conversations).

`DELETE /api/v1/ai/conversations/{id}` and `DELETE /api/v1/ai/conversations` permanently remove the signed-in user's conversation(s), transcripts, and associated AI proposals in a transaction. Calendar events remain unchanged. The Agenda `expire-conversations` job performs the same physical cleanup for expired history every six hours, including legacy soft-deleted records. Run the worker with `DISABLE_JOBS=false`; deploying only the API does not run automatic cleanup.

## AI providers and benchmark

Set `AI_PROVIDER=gemini` or `AI_PROVIDER=openai` to choose the first provider used for each text assistant turn. The cost-sensitive defaults use OpenAI `gpt-5.6-luna` with low reasoning effort; Gemini remains the fallback provider. Changing the provider requires restarting the API process.

Voice messages use a chained, turn-based pipeline: `gpt-transcribe` converts the uploaded audio to text, `gpt-5.6-luna` processes that text through the normal calendar assistant, and `tts-1` generates the MP3 reply. Send `multipart/form-data` with an `audio` file and optional `voice` to `POST /api/v1/ai/conversations/{id}/voice-messages`. The JSON response contains the transcript, normal assistant message and pending actions, plus base64-encoded MP3 data under `audio.base64`. The endpoint accepts FLAC, MP3, MP4, M4A, OGG, WAV, and WEBM up to `OPENAI_VOICE_MAX_FILE_MB`.


The voice picker offers Echo and Onyx (male), Nova and Shimmer (female). Older builds may still send retired voice IDs; the backend maps those IDs to these supported voices before synthesis, including when using `tts-1`. Voice previews use a fixed greeting in the account's English, Portuguese, or Spanish language. They are saved as MP3s under `VOICE_PREVIEW_CACHE_DIR` (default `data/voice-previews`), reused across accounts and restarts, and do not consume an AI turn. Preserve this directory across releases and ensure the API process can write it. Simultaneous first requests share one synthesis request.

Configure the voice pipeline with `OPENAI_TRANSCRIBE_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE`, and `OPENAI_VOICE_MAX_FILE_MB`. A voice turn consumes the same daily quota as a text turn. If speech generation fails after the assistant turn succeeds, the response still contains the text reply with `audio.available=false`, preventing a retry from duplicating a calendar action.

Both `GEMINI_API_KEY` and `OPENAI_API_KEY` are required in production. If the selected provider times out, is rate limited or unavailable, or returns invalid model/tool output, the service tries the other provider once. Safety refusals and calendar business errors do not trigger fallback. Calendar writes remain pending until the existing confirmation endpoint is called.

The live benchmark runs 18 synthetic calendar scenarios three times against each provider without writing events or personal data to MongoDB:

```bash
npm run benchmark:ai
BENCHMARK_RUNS=5 npm run benchmark:ai
```

It requires both provider keys and writes ignored JSON and Markdown reports to `artifacts/ai-benchmark/`. The report compares scenario/tool accuracy, confirmation safety, latency, tokens, and estimated cost using a pricing snapshot dated August 31, 2026.

Whole-week optimization and automatic multi-priority scheduling are outside v1. Those features require priority/deadline/flexibility data plus a deterministic batch scheduling workflow; changing to a stronger language model alone would not implement them safely.

## Production configuration

Configure Cloudinary, Firebase service-account values, SMTP, both AI providers, Google client IDs, and RevenueCat in `.env`. Never commit provider credentials. Configure a `premium` RevenueCat entitlement, monthly/yearly store products, and the seven-day introductory trial in App Store Connect/Google Play and RevenueCat. Prices and offerings belong in the mobile RevenueCat SDK, not this API.

Run the API and Agenda worker as separate processes. Use a production Mongo replica set, unique 32+ character JWT secrets, HTTPS, a narrow CORS allowlist, and `TRUST_PROXY=true` only behind a trusted proxy. RevenueCat webhook authorization must exactly match `REVENUECAT_WEBHOOK_AUTH`.
#   c o m p c r i - b a c k e n d 
 
 
