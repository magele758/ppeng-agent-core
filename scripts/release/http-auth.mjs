/** Attach Bearer when RAW_AGENT_AUTH_TOKEN is set (Candidate stack auth). */
export function daemonAuthHeaders(extra = {}) {
  const token = process.env.RAW_AGENT_AUTH_TOKEN?.trim();
  if (!token) return { ...extra };
  return { ...extra, Authorization: `Bearer ${token}` };
}

export async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: daemonAuthHeaders(options.headers ?? {})
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { _raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}
