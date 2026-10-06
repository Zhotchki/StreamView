# StreamView — Cloudflare Free deployment

This branch moves StreamView off Render to Cloudflare Workers + Static Assets.

## One-time Cloudflare setup

1. Open Cloudflare Workers & Pages.
2. Connect the Zhotchki/StreamView GitHub repository.
3. Deploy using the repository's wrangler.jsonc configuration.
4. Replace the placeholder RELAY_SECRET with a private random value. Do not commit that value to GitHub.
5. Deploy the Worker.

The app is served by the same Worker as the API and TV Stability relay, so there is no separate Render server to keep awake.

## What moved

- Static PWA files are served from Cloudflare Static Assets.
- /api/playlist fetches the Uzzu app2 playlist directly.
- /api/relay/session creates a signed, stateless relay URL.
- /api/relay streams HLS/media responses and rewrites nested .m3u8 URLs through the relay.
- /api/schedule keeps the MLB/ESPN schedule matching.
- /api/epg and /api/epg-fallback keep the program-guide paths.
- /api/diagnostic remains non-persistent.

## Free-tier note

Cloudflare Workers Free currently allows 100,000 requests/day, 10 ms CPU per request, 50 subrequests per request, and no enforced response-body size limit. HLS relay traffic is therefore still subject to the 100,000-request/day ceiling.

The existing Node/Render server remains in the repo as a fallback; this branch is the Cloudflare deployment path.
