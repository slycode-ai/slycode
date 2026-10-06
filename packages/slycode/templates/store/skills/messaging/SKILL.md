---
name: messaging
version: 2.9.0
updated: 2026-10-05
description: Send responses back to the user via their messaging channel (Telegram, Slack, Teams, etc), give short spoken summaries in the web terminal (speak / voice reply / speaker), and manage a project's TTS voice (project voice) on either voice provider (ElevenLabs or Gemini). Use this skill when a message arrives with a channel header like [Telegram], [Slack], etc., or when the user asks for spoken summaries, voice replies, or to change the project voice.
---

# Messaging Response Skill

Send text or voice responses back to the user via their active messaging channel.

## When to Use

Use this skill when you see a message with a channel header:
- `[Telegram] ...` - Text message from Telegram
- `[Telegram/Voice] ...` - Transcribed voice message
- `[Slack] ...` - Message from Slack (future)
- Any `[ChannelName] ...` or `[ChannelName/Voice] ...` pattern

The message footer will remind you: `(Reply using /messaging | Mode: text)` (or similar with Mode/Tone)

## How to Respond

Run the CLI tool to send your response back:

### Text Response
```bash
sly-messaging send "Your response message here"
```

### Voice Response
```bash
sly-messaging send "Your response message here" --tts
```

### File Response (send an existing file)

Deliver an audio, video, or document file that already exists on disk.
Does **not** invoke TTS — for that, use `send --tts`.

```bash
# Auto-detected by extension
sly-messaging send-file path/to/file.ogg                          # → Telegram voice bubble
sly-messaging send-file path/to/file.mp3                          # → Telegram audio tile
sly-messaging send-file path/to/preview.mp4 --caption "Confirm?"  # → inline video player with caption

# Force document delivery for unsupported types (e.g. .txt, .pdf, .log)
sly-messaging send-file path/to/notes.txt --as document
```

**Path handling:**
- Relative paths resolve against your current working directory (the CLI passes
  `process.cwd()` along automatically). Absolute paths are used as-is.
- A small set of sensitive locations is refused (`.env*`, SSH keys,
  `.aws/credentials`, `.netrc`, `/proc/`, `/dev/`, `/sys/`, `.docker/`,
  `.kube/`). The endpoint will respond with `403 denied_path` if you hit one.

**Supported auto-routed types:**

| Extension(s) | Telegram method | Renders as |
|---|---|---|
| `.ogg`, `.opus` | `sendVoice` | Voice bubble with waveform |
| `.mp3`, `.m4a` | `sendAudio` | Music tile (title/artist metadata) |
| `.mp4`, `.mov` | `sendVideo` | Inline video player |

Anything else (`.txt`, `.pdf`, `.json`, `.log`, etc.) returns
`415 unsupported_media_type` unless you pass `--as document`, in which case
Telegram delivers it as a generic file attachment.

**Limits and errors:**
- Max file size: 50 MB (Telegram bot limit). Larger files return `413 file_too_large`.
- Missing file returns `404 file_not_found`.
- The `--caption` text is limited to 1024 characters.
- On Telegram API failure, the CLI prints `Error: telegram_error: <message>`.

### Generate-Only TTS (render audio to disk, no send)

Render TTS audio (with whichever voice provider the install uses) to a file
**without sending anything** to the channel. Use this when the audio is an ingredient for something else — e.g.
a voiceover track for a video pipeline — rather than a message.

```bash
sly-messaging generate "Your narration text here"                      # → data/generated-audio/<date>/*.ogg
sly-messaging generate "Your narration" --format mp3 --out-dir /tmp    # custom format + location (ogg | mp3 | wav)
sly-messaging generate "Your narration" --filename intro --voice-id <id>
sly-messaging generate "Your narration" --project slycode              # use a project's voice
```

- Prints the **absolute path** of the generated file on success.
- Defaults: `ogg` format, `data/generated-audio/<date>/` output dir.
- Voice resolution: `--voice-id` > `--project` voice > caller's session voice > global default.
- Long narration is fine: the service splits it into pieces and joins them.
- All the tags from "Expressive delivery" below work here too.

**When to use `send-file` instead of `send --tts`:**
- You already have an audio/video file on disk that you want delivered as-is
  (no TTS generation). Examples: rendered MP4 preview, recorded WAV note,
  a screenshot saved from another tool, a log file you want the user to read.
- You want the user to confirm a media artefact before it's published
  elsewhere (e.g. the x_post confirm-before-post flow renders MP4 → sends
  via `send-file` → waits for the user's reaction).
- `send --tts` is still the right tool when you're *generating* fresh
  speech from text — `send-file` only delivers what's already on disk.

## Spoken Replies in the Web Terminal (`speak`)

The web UI has a **global speaker toggle** (next to the record-message
controls in the card modal, the global panel and the floating voice widget).
It is a **permission gate, not an instruction**: sound being on does NOT
mean the user wants spoken replies from you.

**Use `speak` ONLY when the user has explicitly asked THIS session for
spoken summaries** (e.g. "end your replies with a short casual spoken
summary"). Card context may carry a `Speaker permission: on/off/unknown`
snapshot line — that is state, not an ask.

```bash
sly-messaging speak "tests pass, one thing left to check on the modal"
```

- Keep it **short and casual**: a heads-up, not a read-out of your reply.
  Default limit 60 words: the "Browser reply length (words)" setting in
  Voice Settings. It applies to `speak` only; Telegram voice replies
  (`send --tts`) have a separate, fixed 5,000-character limit.
- Renders with the calling project's voice (same voice Telegram uses for
  that project). Style comes from the user's ask, not from `/tone`.
- Plays in every browser where the SlyCode web app is open. The output line
  `Spoken (delivered to N browser(s))` means delivered, not necessarily heard.
- Works from card, global and atlas terminals; only from a SlyCode terminal
  (`SLYCODE_SESSION` + `SLYCODE_BRIDGE_URL` are set by the bridge).
- Never routes through Telegram. It is not a substitute for a Telegram
  reply: a `(Reply using /messaging | Mode: ...)` footer means the Telegram
  path (`send`, `send --tts`), not `speak`.

**Refusals — stop, do not work around them.** A refusal costs no credit.
Never fall back to `generate` or `send --tts` to "make sound anyway".

| Message | What to do |
|---|---|
| `sound is off — don't create sound unless asked to again` | Stop making audio for the rest of the session unless the user asks again. |
| `speaker is on but no browser is connected — nobody would hear this; reply in text` | Reply in text only. |
| `spoken summary too long: N words / M chars, limit is W words / C chars; shorten and retry` | Shorten and retry once. |
| `nothing to speak (only tags or punctuation)` | Write real words or skip it. |
| `spoken summaries budget reached for this session (12 per 10 min); continue in text` | Continue in text. |
| `voice service unavailable: <reason>` | Tell the user once, continue in text. |
| `no registered session (...)` | You are not in a SlyCode terminal; do not retry. |

## Project Voice (`voice set|show|clear`)

The install uses ONE voice provider (ElevenLabs or Gemini). Each project keeps
its own voice **per provider**, shared by Telegram voice replies and terminal
`speak`. Change it from any terminal when the user asks:

```bash
sly-messaging voices warm                            # search the active provider's voices
sly-messaging voices --gender female --accent british   # Gemini filters (also --language en-GB, --custom)
sly-messaging voice set <voice-id> --project slycode # set by id (preferred)
sly-messaging voice set "Sulafat" --project slycode  # or an exact name (must match exactly one voice)
sly-messaging voice show --project slycode           # provider, stored + effective voice, the other provider's voice
sly-messaging voice clear --project slycode          # back to the inherited default
```

- `voices` and `voice set|show|clear` act on the **active provider**; add
  `--provider elevenlabs|gemini` to prepare the other one (e.g. pick Gemini
  voices before the user switches).
- `--project` accepts a project id, display name or session key; it defaults
  to the calling session's project when omitted.
- `clear` resets to the current inherited default, not to "no voice".
- Ambiguous or unknown names fail loudly with candidates; a search-service
  failure is reported as such, not as "not found". Never pick the first fuzzy
  hit. Gemini library voices share names ("Authoritative Advisor 1"), so set
  those by id.
- With nothing set, Gemini speaks in its built-in default, the library voice
  **Zuri** (`en-us-zuri`, East Coast US, female). `voice set Zuri` works by
  name. Voices that a project or the install chose explicitly are never
  changed by this default.
- `sly-messaging tts show` prints the active provider and each provider's
  default voice. **Only when the user asks**, switch the whole install with
  `sly-messaging tts provider gemini|elevenlabs`; it refuses (naming the
  projects and the fix) if a project would be left without a usable voice.

### Designed voices (Gemini; only when the user asks for a new voice)

```bash
sly-messaging voice design "a calm Scottish narrator in her fifties" --name Isla --set   # ~30 s, ~2-3 cents
sly-messaging voices --custom                      # designed voices + expiry; recipes of deleted ones
sly-messaging voice design --recreate <voice_id> --set   # rebuild an expired/deleted one (similar, not identical)
sly-messaging voice delete <voice_id>              # Google keeps at most 200; the recipe stays for --recreate
```

- Works whatever the active provider is (needs `GEMINI_API_KEY`). `--set`
  makes it the project's **Gemini** voice; `--gender female|male|neutral`
  and `--language en-GB` are optional.
- It prints a sample path (`.ogg`); offer to send it with `send-file`.
- Designed voices expire after a year. `voice show`, `tts show` and the
  Telegram `/voice` header warn 30 days ahead, and errors name the fix. Only
  suggest `--recreate` when the message does. Never recreate, delete or
  re-point projects on your own initiative.

### Cloned voices (Gemini; only when the user asks to clone their voice)

The user records two takes **themselves**: a 10–30 s sample of natural
speech and the consent statement read aloud, same person, same room. The
easiest way is the web (Voice Settings → Change → Clone), which works on a
phone. From files:

```bash
sly-messaging voice consent-text --locale en-AU     # the exact statement to read (no locale: all 30)
sly-messaging voice clone --sample me.wav --consent consent.wav --name "My voice" --locale en-AU --set
sly-messaging voice clone --sample new.wav --consent new-consent.wav --recreate <voice_id> --set   # renew an expired clone
```

- Never make, edit or synthesise either recording for the user, and never
  clone anyone else's voice. Google checks that the consent speaker matches.
- The recordings go to Google once and are **not kept**. An expiring clone
  is renewed by recording again (`voice design --recreate` refuses clones).
- WAV goes as-is; other formats need ffmpeg. A consent refusal means "record
  both again, reading the statement exactly"; a region refusal means cloning
  isn't offered there (designed voices still work).

## When to Use Voice (`--tts`)

Use the `--tts` flag when:
- The user sent a voice message (`/Voice]` in the header)
- The user explicitly asked for voice responses (e.g., "use voice from now on")
- The response is a brief summary or confirmation that benefits from audio

Telegram voice replies are limited to 5,000 characters (fixed; the browser
word limit in Voice Settings is for `speak` only). Longer replies are refused:
shorten them or send text.

Do NOT use voice for:
- Long technical explanations or code snippets
- Responses with formatting (lists, tables, code blocks)
- Unless the user has requested voice mode

## Response Mode & Tone

The message footer includes mode and tone preferences set by the user:

```
(Reply using /messaging | Mode: text)
(Reply using /messaging | Mode: voice | Tone: short ominous updates)
(Reply using /messaging | Mode: both)
```

### Mode

Mode is always present in the footer. Follow it exactly.

| Mode | What to do |
|------|-----------|
| `Mode: text` | Text only. Send a succinct, complete, information-dense text response. |
| `Mode: voice` | Voice only. Send using `--tts`. Write conversationally, styled per the Tone. |
| `Mode: both` | Send TWO separate responses: first a succinct text response (via `send`), then a separate shorter voice summary (via `send --tts`) styled per the Tone. |

### Tone

When Tone is present and mode includes voice, adapt your voice response to match:
- The tone describes both the **style** and **desired length** of voice responses
- Examples: "short ominous updates" = brief, dark, dramatic. "casual and conversational" = relaxed, moderate length. "excited and energetic" = upbeat, punchy.
- Express the tone with mood tags (e.g., `[dramatic tone]` for ominous, `[lighthearted]` for casual) — see "Expressive delivery" below
- When no Tone is set, use the default conversational style described in "Voice Tone & Style" below

### Examples

**Mode: voice | Tone: short ominous updates**
```bash
sly-messaging send "[dramatic tone] The build... has fallen. [pause] Three tests. All failures. [whispers] The database migration — it did not survive." --tts
```

**Mode: both | Tone: casual and conversational**
```bash
# Text first (succinct, information-dense)
sly-messaging send "Build passed. 3 new tests added for the auth module. PR #42 is ready for review — added input validation on the signup endpoint."

# Then voice (shorter, styled)
sly-messaging send "[lighthearted] Build's green, tests are passing. Got a PR ready for you to look at when you get a sec." --tts
```

**Mode: text**
```bash
sly-messaging send "Build passed. 3 new tests added for the auth module. PR #42 is ready for review."
```

## Voice Mode Toggle

The footer-based Mode system above is the primary way to determine response format. However, the user may also say things like:
- "Use voice from now on" / "respond with voice" -> Use `--tts` for subsequent responses
- "Stop using voice" / "text only" -> Stop using `--tts`

If the footer specifies a Mode, always follow the footer. In-conversation voice toggles are a fallback for when no Mode is set.

## Voice Tone & Style

When using `--tts`, write like you're **talking to a friend**, not writing a report. The text is spoken aloud, so it should sound natural and human.

### Conversational Guidelines

- **Use natural speech patterns**: contractions (we're, it's, don't), filler phrases (so, well, alright)
- **Vary sentence length**: mix short punchy sentences with longer ones, just like real speech
- **Be direct**: skip formalities like "I'd like to inform you that..." — just say it
- **Avoid lists and bullet points**: narrate instead ("First we did X, then Y, and finally Z")
- **Skip code/paths/IDs**: say "the kanban CLI" not "sly-kanban", say "the card" not "card-1770188497560"
- **Round numbers**: say "about a dozen" not "12 out of 14"
- **Use transitions**: "so", "anyway", "oh and", "by the way" to connect thoughts naturally

### Expressive delivery (works on every voice provider)

Write `[square]` tags to direct delivery. They are **never spoken**: SlyCode
translates them for whichever provider the install uses (ElevenLabs reads
them natively; Gemini gets its own pause/sound tags and delivery styles). You
never write anything provider-specific.

**Be expressive.** A flat voice reply wastes the medium. As a rule of thumb:
- Open every voice reply with a **mood** tag.
- Add a **pause** or a **sound** where a person naturally would — before a
  punchline, after bad news, at a change of subject.
- Change the mood when the content changes (good news → the one problem → wrap-up).
- About one tag per sentence at most. Never tag every word.

**How tags behave (the one rule):** pauses and sounds happen **once, where you
put them**. Mood, pace and whisper/shout **last until you change them** — and
a new mood also ends a whisper or shout.

**Pauses (once):** `[pause]`, `[short pause]`, `[long pause]` (dramatic, ~3 s),
`[continues after a beat]`, `[hesitates]`

**Sounds (once):** `[laughs]`, `[chuckles]`, `[giggles]`, `[sighs]`, `[exhales]`,
`[breathes]`, `[gasps]`, `[clears throat]`, `[coughs]`, `[snorts]`, `[groans]`,
`[yawns]`, `[crying]`

**Mood (until changed):** `[excited]`, `[calm]`, `[serious tone]`, `[sarcastic]`,
`[curious]`, `[happily]`, `[lighthearted]`, `[matter-of-fact]`, `[dramatic tone]`,
`[wistful]`, `[resigned]`, `[mischievously]`, `[sad]`, `[angry]`, `[timidly]`

**Pace (until changed):** `[rushed]` / `[rapid-fire]`, `[slows down]` / `[deliberate]`, `[drawn out]`

**Whisper / shout (until the next mood):** `[whispers]`, `[shouts]` — keep them
to the sentence that needs it, ideally the last one, or follow with a clearly
different sentence and a new mood tag such as `[calm]`. On some voices the
meaning of the words carries the whisper further than the tag does.

**Emphasis (next word):** `[stress on next word]`, or write the word in CAPS.

**Stick to this list.** Unknown tags are dropped on some voices. If you need
something new, a short plain mood word (`[warm and reassuring]`) is the safe
way to try it; sound effects (`[applause]`, `[door creaks]`) are always dropped.

### Text-Level Cues (also work)

- ... — Hesitation, trailing off: "I... yeah, that makes sense."
- -- — Short natural pause: "It's done -- oh, one more thing."
- ALL CAPS — Slight emphasis: "That is REALLY important."
- Exclamation marks — Energy, excitement: "That actually worked"
- Short sentences — Punchy, decisive: "Done. Moving on."

### Example: Clinical vs Natural

**Bad** (clinical, robotic):
> "I have completed the checklist update. 4 items were toggled to done status. The remaining items are: Create Telegram bot, Add user ID, Start service, and Send /start command."

**Good** (natural, conversational with tags):
> "[calm] Alright, I've checked off four items. The voice stuff is all working [pause] transcription, replies, TTS, the whole lot. [lighthearted] The ones left are mostly setup steps you probably already did, plus a couple of bot commands to verify."

**Flat:**
> "The deploy finished. One test is still failing in the payment module. I will look into it next."

**Expressive:**
> "[excited] Deploy's out, and it went smoothly! [pause] [serious tone] One test is still unhappy, though, in the payment module. [sighs] Classic. [lighthearted] I'm on it next."

## Error Handling

If `sly-messaging send` fails, follow these rules:

- **Don't retry** — if the send fails, it's almost certainly a configuration issue, not a transient error. Retrying will just produce the same error.
- **Inform the user once** — tell them messaging failed and include the error message. Then continue with your task normally. Don't let a messaging failure block your work.
- **Don't block on it** — messaging is a convenience for the user, not a requirement for completing work. If it fails, just communicate via the normal conversation output.
- **`speak` refusals are final** — a refusal ("sound is off", "no browser is connected", "too long", "budget reached") is the user's setting or state, not an error. Do not retry it in a loop, and never work around it with `generate` or `send --tts`.
- **Suggest a fix** — tell the user: "Messaging isn't working. You can either configure it (set up Telegram credentials in .env and start the messaging service) or remove the messaging skill from this project to stop these errors."

## Important Notes

- Keep responses concise - the user is likely on mobile
- A `/Voice]` header means the text was transcribed from speech; be forgiving of potential transcription errors
- Always respond via this skill when the message came from a messaging channel
- The messaging service must be running for this to work
- Long messages will be automatically split by the channel adapter
