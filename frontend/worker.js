// Proxy /api/* (incl. the speech-follow WebSocket) and /health/* to Heroku so the SPA stays same-origin for the session cookie.
export default {
  fetch(request, env) {
    const url = new URL(request.url)
    if (!/^\/(api|health)\//.test(url.pathname)) return env.ASSETS.fetch(request)
    return fetch(new Request(env.API_ORIGIN + url.pathname + url.search, request))
  },
}
