# Prompt polish

Adds an **Optimize / 优化** control to the composer tool row, immediately left of
the submit action.

## What it does

1. Reads the current draft from the composer.
2. Sends it to the Host, which asks the configured model (default: the profile
   default model) to rewrite it.
3. Puts the rewritten prompt back into the composer, replacing the draft.

The draft is replaced only when the rewrite succeeds *and* the composer still
holds the exact draft that was sent. A failure is reported next to the control
and the draft is left untouched.

## How it is wired

| Half | Contribution |
| --- | --- |
| Host (`index.js`) | Registers the `/polish` user command. Its handler streams one `ctx.llm.stream()` call and returns the rewritten text. `recordInput: false` keeps the draft out of the command row. |
| Client (`client.js`) | Registers the control in `conversation.input.right` and calls `/polish` through `ctx.remote.commands.execute()`. On success it writes the result with `inputActions.setDraft()`. |

The same operation has both callers the harness user-action guideline asks for:
the button, and a person typing `/polish <text>` in the composer.

## Configuration

The bundle reads these keys from its row's `config` in `cordis.patch.yml`. Every
key is optional; omitted or malformed values fall back to the behavior below.

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `provider` | string | profile default provider | Route for the rewrite call |
| `model` | string | profile default model | Model used for the rewrite |
| `temperature` | number 0–2 | adapter default | Lower values make repeated rewrites of one draft more stable |
| `maxTokens` | number 1–32768 | adapter default | Caps the rewritten prompt length |
| `mode` | `clarity` \| `structured` \| `detail` \| `brief` | `clarity` | Appends the mode instruction to the fixed rewrite prompt |

```yaml
- insert:
    - id: dsh-prompt-polish
      name: 'dsh-prompt-polish'
      config:
        model: deepseek-v4-flash
        temperature: 0.2
        maxTokens: 1024
        mode: clarity
```

The bundle deliberately declares no `Config` schema: `@deepseek-ai/schemastery`
is not resolvable from a workspace-linked bundle, so the keys above are the
contract and Plugin Manager shows no field editor for them.

## Behavior

- Disabled while the draft is empty, while a submission is in flight, and while
  a command chip claims the draft (with a reason in the tooltip).
- The completion is guarded by session, phase, and draft equality: text typed
  during the request, a send, or a session switch wins over the late result.
- 60 s timeout; the control can never stay busy forever.
- A truncated (`max-tokens`) rewrite is reported as a failure, never written.
- Colors come from `--dsw-alias-*` tokens; the label collapses on a narrow
  composer.

## Limitations

- Uses the configured model, which defaults to the profile default — not a
  per-session model choice.
- The command lifecycle is logged, so each optimization adds one `/polish` row
  to the transcript; that row carries the rewritten text.
- `@file` reference chips, quotes, and attachments are not part of the text sent
  for rewriting: chips degrade to their text form (the control warns in its
  tooltip when they are present).
