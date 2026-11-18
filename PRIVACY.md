# Privacy Policy – Shorts Kit

_Last updated: November 19, 2026_

Shorts Kit is a browser extension that runs entirely on your computer. It has no server
and no user accounts, and it does not collect, sell or share any personal data.

## What is stored, and where

| Data | Where it lives | Who can see it |
|---|---|---|
| Shorts you save (title, channel, stats, tags, transcript, your rewrites) | Chrome's local extension storage on your device | Only you |
| Settings (Gemini API key, model, channel style, default length) | Chrome's local extension storage on your device | Only you |

Removing the extension deletes all of it. You can also delete everything from
**Library → Settings → Delete all saved Shorts**.

## Network requests

Shorts Kit only talks to:

1. **youtube.com / ytimg.com**, to read the public page, captions, tags and stats of the
   Short or channel you are looking at, and to show thumbnails. These are the same requests
   your browser makes when you watch YouTube.
2. **generativelanguage.googleapis.com (Google Gemini)**, **only when you click ✨ Rewrite**.
   It sends the Short's title, tags, transcript, your channel style and your API key, so
   Gemini can write the result. Google's terms and privacy policy apply to that request:
   https://ai.google.dev/gemini-api/terms

Nothing else is sent anywhere. There is no analytics, tracking, advertising or telemetry.

## Permissions and why they're needed

| Permission | Why |
|---|---|
| `storage`, `unlimitedStorage` | Keep your library and settings on your device |
| `clipboardWrite` | Copy transcripts and tags when you click |
| `downloads` | Save thumbnails, `.txt`, `.srt` and CSV files |
| Access to `youtube.com` | Add the ⚡ button and read the Short you're viewing |
| Access to `i.ytimg.com` | Download thumbnails |
| Access to `generativelanguage.googleapis.com` | Send rewrite requests to Gemini (only on click) |

## Contact

Questions? Open an issue on the project's GitHub page.
