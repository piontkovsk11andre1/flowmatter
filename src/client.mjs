export function httpClient(base) {
  const url = new URL(base);
  if (!['http:','https:'].includes(url.protocol) || url.search || url.hash) throw new Error('Expected an HTTP service base URL');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  async function request(route, init) {
    const response = await fetch(new URL(route,url),{...init,redirect:'error',signal:AbortSignal.timeout(60000)});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `HTTP ${response.status}`);
    return data;
  }
  return {list:async () => (await request('tools')).tools, call:async (name,args = {}) => (await request(`tools/${encodeURIComponent(name)}`,{
    method:'POST', headers:{'content-type':'application/json'},body:JSON.stringify(args)
  })).result};
}
