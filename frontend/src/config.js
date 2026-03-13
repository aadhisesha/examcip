const DEFAULT_API_PORT = '8000';

export function getApiBase() {
  const rawBase = (process.env.REACT_APP_API_BASE || '').trim();
  const browserHost = window.location.hostname || 'localhost';
  const fallbackBase = `http://${browserHost}:${DEFAULT_API_PORT}`;

  if (!rawBase) {
    return fallbackBase;
  }

  try {
    const normalizedInput = rawBase.includes('://') ? rawBase : `http://${rawBase}`;
    const parsed = new URL(normalizedInput);
    const protocol = parsed.protocol && parsed.protocol !== ':' ? parsed.protocol : 'http:';
    const hostname = parsed.hostname || browserHost;
    const port = parsed.port || DEFAULT_API_PORT;
    return `${protocol}//${hostname}:${port}`;
  } catch (error) {
    console.warn('Invalid REACT_APP_API_BASE value. Falling back to default API base.', error);
    return fallbackBase;
  }
}

export function buildApiUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBase()}${normalizedPath}`;
}