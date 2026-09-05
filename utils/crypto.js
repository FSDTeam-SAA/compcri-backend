import crypto from 'node:crypto';

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const secureEquals = (left, right) => {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};
export const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');
export const randomOtp = () => crypto.randomInt(100000, 1000000).toString();
export const randomUuid = () => crypto.randomUUID();

const codePart = () => crypto.randomBytes(2).toString('hex').toUpperCase().slice(0, 3);
export const humanCode = (prefix = 'USR') => `${prefix.replace(/[^A-Z]/gi, '').toUpperCase().slice(0, 4) || 'USR'}-${crypto.randomInt(100, 1000)}-${codePart().slice(0, 2)}`;
