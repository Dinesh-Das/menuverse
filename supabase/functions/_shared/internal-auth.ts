function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export function hasValidInternalSecret(req: Request, expectedSecret: string | undefined) {
  const providedSecret = req.headers.get('X-Menuverse-Internal-Secret');
  return Boolean(expectedSecret)
    && Boolean(providedSecret)
    && timingSafeEqual(providedSecret!, expectedSecret!);
}
