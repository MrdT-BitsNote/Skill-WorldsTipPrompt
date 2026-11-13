# Prompt polish

**Optimize / 优化** rewrites the composer draft into a clearer, more actionable
prompt with the default model, then puts the result back in the composer.

## Usage

1. Type a rough prompt in the composer.
2. Press **优化** (left of the send button).
3. Review the rewritten prompt in the composer, edit it if needed, then send.

While a submission is running, or while the draft holds a command chip, the
control is disabled and its tooltip says why. If the rewrite fails, the reason
appears beside the control for a few seconds and the draft is unchanged.

## What the rewrite preserves

- The draft's language: Chinese stays Chinese, English stays English.
- Concrete details: file names, paths, identifiers, error messages, numbers.
- The author's intent; nothing is invented.

## Safety rules

- The result is written back only if the same session is shown, the input
  machine is idle, and the draft still equals the text that was sent.
- A rewrite cut off by the output limit is treated as a failure.
- The control gives up after 60 s.

## Command form

The same operation is available without the mouse:

```text
/polish <your draft>
```

## Wiring

- Host half registers the `/polish` command; its handler streams one model
  call through `ctx.llm.stream()` using the default model selection.
- Client half contributes the button to `conversation.input.right` and invokes
  the command through `ctx.remote.commands.execute()`.

## Known limits

- Uses the profile default model, not a per-session model choice.
- `@file` reference chips, quotes, and attachments become plain text in the
  rewritten draft; the tooltip warns when they are present.
- Each optimization adds one `/polish` row to the conversation; that row is
  the durable record of the rewrite.
