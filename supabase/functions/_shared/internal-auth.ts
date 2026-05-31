export function hasValidInternalSecret(req: Request, expectedSecret: string | undefined) {
  return Boolean(expectedSecret)
    && req.headers.get('X-Menuverse-Internal-Secret') === expectedSecret;
}

