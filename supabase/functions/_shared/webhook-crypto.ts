function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function hmacSha256(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function verifyHexHmac(secret: string, value: string, provided: string) {
  if (!secret || !provided) return false;
  const expected = bytesToHex(await hmacSha256(secret, value));
  return constantTimeEqual(expected.toLowerCase(), provided.replace(/^sha256=/i, '').toLowerCase());
}

export async function verifySquareSignature(secret: string, notificationUrl: string, rawBody: string, provided: string) {
  if (!secret || !notificationUrl || !provided) return false;
  const expected = bytesToBase64(await hmacSha256(secret, `${notificationUrl}${rawBody}`));
  return constantTimeEqual(expected, provided);
}

