/*
 * Developer mode. The server reads the CABLE_DEV environment variable and answers
 * /dev-flag.json with it; a page cannot read the server's environment itself.
 * Anything that goes wrong (no server, odd answer) means "off".
 */

export const DEV_FLAG_URL = '/dev-flag.json';

export async function loadDevFlag(fetchJson = defaultFetchJson) {
  try {
    const answer = await fetchJson(DEV_FLAG_URL);
    return answer?.dev === true;
  } catch {
    return false;
  }
}

async function defaultFetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Dev flag request failed: ${response.status}`);
  return response.json();
}
