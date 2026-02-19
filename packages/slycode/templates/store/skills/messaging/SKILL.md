---
name: messaging
version: 2.3.1
updated: 2026-02-22
description: Send responses back to the user via their messaging channel (Telegram, Slack, Teams, etc). Use this skill when a message arrives with a channel header like [Telegram], [Slack], etc.
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

## When to Use Voice (`--tts`)

Use the `--tts` flag when:
- The user sent a voice message (`/Voice]` in the header)
- The user explicitly asked for voice responses (e.g., "use voice from now on")
- The response is a brief summary or confirmation that benefits from audio

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
- Use audio tags that match the tone (e.g., `[dramatic tone]` for ominous, `[lighthearted]` for casual)
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

### Speech Control: Audio Tags (ElevenLabs v3)

The TTS engine uses ElevenLabs v3 which supports `[tag]` audio tags. These are NOT spoken aloud — they modify delivery. Use them to make speech feel natural and expressive.

**Emotion & Tone:**
- `[excited]`, `[sad]`, `[angry]`, `[sarcastic]`, `[curious]`
- `[happily]`, `[serious tone]`, `[lighthearted]`, `[matter-of-fact]`
- `[wistful]`, `[resigned]`, `[dramatic tone]`, `[mischievously]`

**Delivery:**
- `[whispers]` / `[whispering]` — Whispered speech
- `[shouts]` — Loud, projected
- `[calm]` — Measured, relaxed
- `[emphasized]` — Stressed delivery
- `[stress on next word]` — Emphasize the next word
- `[timidly]` — Shy, quiet

**Pauses & Pacing:**
- `[pause]`, `[short pause]`, `[long pause]`
- `[continues after a beat]` — Brief dramatic pause
- `[hesitates]` — Hesitation
- `[breathes]` — Audible breath

**Speed:**
- `[rushed]` / `[rapid-fire]` — Faster
- `[slows down]` / `[deliberate]` — Slower
- `[drawn out]` — Prolonged words

**Non-verbal:**
- `[laughs]`, `[giggles]`, `[chuckles]`
- `[sighs]`, `[clears throat]`, `[coughs]`
- `[crying]`, `[snorts]`

**Tags can combine:** [angry][laughing] You think that's funny?

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

## Error Handling

If `sly-messaging send` fails, follow these rules:

- **Don't retry** — if the send fails, it's almost certainly a configuration issue, not a transient error. Retrying will just produce the same error.
- **Inform the user once** — tell them messaging failed and include the error message. Then continue with your task normally. Don't let a messaging failure block your work.
- **Don't block on it** — messaging is a convenience for the user, not a requirement for completing work. If it fails, just communicate via the normal conversation output.
- **Suggest a fix** — tell the user: "Messaging isn't working. You can either configure it (set up Telegram credentials in .env and start the messaging service) or remove the messaging skill from this project to stop these errors."

## Important Notes

- Keep responses concise - the user is likely on mobile
- A `/Voice]` header means the text was transcribed from speech; be forgiving of potential transcription errors
- Always respond via this skill when the message came from a messaging channel
- The messaging service must be running for this to work
- Long messages will be automatically split by the channel adapter
