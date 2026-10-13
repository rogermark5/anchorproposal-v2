import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function key(secret: string) { return createHash('sha256').update(`anchorproposal:public-resume:v1:${secret}`).digest(); }
export function encryptResumeLink(payload: { id: string; nonce: string; expires: number }, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  cipher.setAAD(Buffer.from('public-resume:v1'));
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}
export function decryptResumeLink(token: string, secret: string) {
  if (!/^[\w-]{60,1000}$/.test(token)) throw new Error('Invalid resume link');
  const data = Buffer.from(token, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key(secret), data.subarray(0, 12));
  decipher.setAAD(Buffer.from('public-resume:v1'));
  decipher.setAuthTag(data.subarray(12, 28));
  const payload = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'));
  if (typeof payload.id !== 'string' || typeof payload.nonce !== 'string' || !Number.isFinite(payload.expires) || payload.expires <= Date.now()) throw new Error('Expired resume link');
  return payload as { id: string; nonce: string; expires: number };
}
