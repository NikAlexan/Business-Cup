// Cloudflare Pages: proxy /api/* (incl. the speech-follow WebSocket) to Heroku so the SPA stays same-origin for the session cookie.
export const onRequest = ({ request, env }) => {
  const url = new URL(request.url)
  return fetch(new Request(env.API_ORIGIN + url.pathname + url.search, request))
}
