import multer from 'multer';
import { StatusCodes } from 'http-status-codes';
import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';

const allowedMimeTypes = new Set([
  'audio/flac',
  'audio/m4a',
  'audio/mp3',
  'audio/mp4',
  'audio/mpeg',
  'audio/mpga',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-m4a',
  'audio/x-wav',
  'video/mp4',
  'video/webm'
]);

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.OPENAI_VOICE_MAX_FILE_MB * 1024 * 1024 },
  fileFilter(req, file, callback) {
    const mimeType = file.mimetype.toLowerCase().split(';', 1)[0];
    if (allowedMimeTypes.has(mimeType)) return callback(null, true);
    return callback(new ApiError(
      StatusCodes.BAD_REQUEST,
      'Only FLAC, MP3, MP4, M4A, OGG, WAV, or WEBM audio is allowed',
      'INVALID_AUDIO_TYPE'
    ), false);
  }
});

export default audioUpload;
