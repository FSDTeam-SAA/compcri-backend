import catchAsync from '../utils/catchAsync.js';
import { sendSuccess } from '../utils/response.js';
import * as service from '../services/ai.service.js';
import { requestLocale, translate } from '../utils/i18n.js';

export const createConversation = catchAsync(async (req, res) => sendSuccess(res, await service.createConversation(req.user._id, req.body.calendarId, req.body.title), { status: 201 }));
export const listConversations = catchAsync(async (req, res) => sendSuccess(res, await service.listConversations(req.user._id, req.query.search)));
export const getConversation = catchAsync(async (req, res) => sendSuccess(res, await service.getConversation(req.user._id, req.params.id)));
export const deleteConversation = catchAsync(async (req, res) => { await service.deleteConversation(req.user._id, req.params.id); sendSuccess(res, { deleted: true }); });
export const sendMessage = catchAsync(async (req, res) => sendSuccess(res, await service.sendMessage(req.user._id, req.params.id, req.body.content)));

const SSE_HEARTBEAT_MS = 15000;

/// Answers a request as server-sent events. `run` gets a `send` for each event
/// and a check for whether the client has gone away.
const eventStream = (run) => async (req, res, next) => {
  let streaming = false;
  let heartbeat;
  // `req.destroyed` is not the test for this: Express has already consumed the
  // body by the time the handler runs, so the request stream is destroyed on
  // every healthy turn. Only the response says whether anyone is still there.
  let disconnected = false;
  res.on('close', () => { disconnected = true; });

  const send = (payload) => {
    if (disconnected || res.writableEnded) return;
    if (!streaming) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // nginx buffers a proxied response by default, which would hold every
        // token back until the turn ended — the one thing this route exists to
        // avoid.
        'X-Accel-Buffering': 'no'
      });
      res.flushHeaders?.();
      streaming = true;
      heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(': ping\n\n');
      }, SSE_HEARTBEAT_MS);
    }
    // A failure mid-stream is read by the person waiting, in their language.
    const readable = payload.message && ['error', 'audio_error'].includes(payload.type)
      ? { ...payload, message: translate(requestLocale(req), payload.message) }
      : payload;
    res.write(`data: ${JSON.stringify(readable)}\n\n`);
  };

  try {
    await run(req, send, () => disconnected);
  } catch (error) {
    // Nothing has been written yet for the failures that happen before the
    // model speaks — quota, entitlement, a missing conversation — so they stay
    // ordinary HTTP errors with their real status codes.
    if (!streaming) {
      clearInterval(heartbeat);
      return next(error);
    }
    send({
      type: 'error',
      code: error.code || 'AI_UNAVAILABLE',
      message: error.message || 'AI assistant is temporarily unavailable'
    });
  } finally {
    clearInterval(heartbeat);
    if (streaming && !res.writableEnded) res.end();
  }
};

/// The same turn as `sendMessage`, reported as it happens instead of once it
/// is over. Events carry their own `type`: `delta` for a slice of the answer,
/// `tools` for the calendar work behind it, `reset` to retract text the model
/// is replacing, and `done` for the saved message and anything awaiting
/// confirmation.
export const streamMessage = eventStream(async (req, send) => {
  const turn = await service.sendMessage(
    req.user._id,
    req.params.id,
    req.body.content,
    undefined,
    { onEvent: send }
  );
  send({ type: 'done', message: turn.message, pendingActions: turn.pendingActions });
});

/// A voice turn as it happens: the transcript as soon as it is known, the
/// answer as it is written, then its speech in ordered pieces. Transcription
/// failures come before the first event, so they stay plain HTTP errors.
export const streamVoiceMessage = eventStream((req, send, cancelled) => service.streamVoiceMessage(
  req.user._id,
  req.params.id,
  req.file,
  { voice: req.body.voice, speak: req.body.speak, onEvent: send, isCancelled: cancelled }
));
export const sendVoiceMessage = catchAsync(async (req, res) => sendSuccess(
  res,
  await service.sendVoiceMessage(req.user._id, req.params.id, req.file, req.body.voice)
));
export const editMessage = catchAsync(async (req, res) => sendSuccess(res, await service.editMessage(req.user._id, req.params.id, req.params.messageId, req.body.content)));
export const deleteMessage = catchAsync(async (req, res) => { await service.deleteMessage(req.user._id, req.params.id, req.params.messageId); sendSuccess(res, { deleted: true }); });
export const quota = catchAsync(async (req, res) => sendSuccess(res, await service.quotaStatus(req.user._id, req.query.calendarId)));
export const confirmAction = catchAsync(async (req, res) => sendSuccess(res, await service.confirmAction(req.user._id, req.params.id, req.body.overrideConflicts, req.body)));
export const rejectAction = catchAsync(async (req, res) => sendSuccess(res, await service.rejectAction(req.user._id, req.params.id)));
