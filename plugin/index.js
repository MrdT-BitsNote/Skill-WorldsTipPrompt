/**
 * Host half of the prompt-polish bundle.
 *
 * The rewrite is a model call, so it lives on the Host: the Client cannot reach
 * a model, and a Client-only "optimizer" would be a template rewriter.
 *
 * Wiring:
 * - The Client button runs `/polish <draft>` through `ctx.remote.commands.execute()`.
 * - The same command is available to a person typing `/polish <text>`.
 * - `recordInput: false` keeps the draft out of the command log row.
 *
 * Tunables live on the bundle row's `config` in cordis.patch.yml:
 * provider, model, temperature, maxTokens, mode. Values are read defensively, so
 * an absent or malformed entry falls back to the profile default instead of
 * failing activation. The bundle declares no `Config` schema because
 * `@deepseek-ai/schemastery` is not resolvable from a workspace-linked bundle;
 * the documented defaults below are the contract.
 */

/** Command spelling without the leading slash. */
const COMMAND_NAME = 'polish'

/** Instruction for the rewrite call. Output must be only the new prompt. */
const SYSTEM_PROMPT = [
  'You rewrite a rough user prompt into a stronger prompt for an autonomous coding agent.',
  '',
  'Rules:',
  '- Keep the author\'s language. A Chinese draft becomes a Chinese prompt, an English draft an English prompt.',
  '- Keep every concrete detail: file names, paths, identifiers, error text, versions, numbers.',
  '- Make the goal explicit, add the missing context only when the draft implies it, and state the expected result.',
  '- Prefer a short structured body (goal, context, requirements, acceptance) over prose when the draft is longer than one sentence.',
  '- Do not invent facts, requirements, or approvals the draft does not contain; do not add placeholders such as [insert here].',
  '- Do not answer the prompt. Do not explain your changes. Return only the rewritten prompt as plain text.',
].join('\n')

/** Extra instruction per mode; the empty entry is the default clarity mode. */
const MODE_HINTS = {
  clarity: '',
  structured: '\n- Always use four sections in the draft language: 目标 / 上下文 / 要求 / 验收 (Goal / Context / Requirements / Acceptance).',
  detail: '\n- Add the executable details the draft implies; end with at most one line "待确认：<one question>" (To confirm: ...).',
  brief: '\n- Compress: one task sentence (under 40 characters when the language allows) plus at most three constraints.',
}

/** Accepted mode names, mirroring the skill's four modes. */
const MODES = new Set(Object.keys(MODE_HINTS))

/** Services this plugin needs. */
export const inject = ['llm', 'commands', 'agentDefaultModel']

/** A non-empty trimmed string, or undefined. */
function textOrUndefined(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** A finite number inside the inclusive range, or undefined. */
function numberOrUndefined(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined
}

/** Strip a wrapping code fence or quote pair the model may add anyway. */
function tidy(text) {
  let value = text.trim()
  const fenced = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(value)
  if (fenced !== null) value = fenced[1].trim()
  if (value.length > 1) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === '“' && last === '”')) {
      value = value.slice(1, -1).trim()
    }
  }
  return value
}

/** Human-readable message for a failed call. */
function describe(error) {
  if (error instanceof Error && error.message !== '') return error.message
  return String(error)
}

/**
 * Resolve one call's route and mode from the row config and the profile default.
 * @param ctx - plugin context carrying `agentDefaultModel`.
 * @param config - the row's config object, possibly absent.
 * @returns provider, model, and a validated mode.
 */
function resolveRoute(ctx, config) {
  const settings = config !== null && typeof config === 'object' ? config : {}
  const selection = ctx.agentDefaultModel.currentSelection()
  const mode = typeof settings.mode === 'string' && MODES.has(settings.mode) ? settings.mode : 'clarity'
  return {
    provider: textOrUndefined(settings.provider) ?? selection.provider,
    model: textOrUndefined(settings.model) ?? selection.model,
    mode,
  }
}

/**
 * One non-streaming user-visible rewrite over the streaming LLM API.
 * @param ctx - plugin context carrying `llm` and `agentDefaultModel`.
 * @param config - the row's config object, possibly absent.
 * @param draft - the draft text to rewrite.
 * @param signal - the command invocation cancellation.
 * @returns the rewritten prompt.
 */
async function rewrite(ctx, config, draft, signal) {
  const route = resolveRoute(ctx, config)
  const settings = config !== null && typeof config === 'object' ? config : {}
  const options = {
    provider: route.provider,
    model: route.model,
    system: SYSTEM_PROMPT + MODE_HINTS[route.mode],
    messages: [{ role: 'user', content: [{ type: 'text', text: draft }] }],
    signal,
  }
  const selection = ctx.agentDefaultModel.currentSelection()
  if (selection.reasoningEffort !== undefined) options.reasoningEffort = selection.reasoningEffort

  const temperature = numberOrUndefined(settings.temperature, 0, 2)
  if (temperature !== undefined) options.temperature = temperature
  const maxTokens = numberOrUndefined(settings.maxTokens, 1, 32768)
  if (maxTokens !== undefined) options.maxTokens = maxTokens

  let text = ''
  for await (const chunk of ctx.llm.stream(options)) {
    if (chunk.type === 'text-delta') {
      text += chunk.text
    } else if (chunk.type === 'finish') {
      const reason = chunk.reason
      if (reason.kind === 'error' || reason.kind === 'aborted') {
        const failure = reason.failure
        throw new Error(failure === undefined || failure.message === '' ? `model ${reason.kind}` : failure.message)
      }
      // A truncated rewrite is not a rewrite: report it instead of writing a
      // half prompt into the composer.
      if (reason.kind === 'max-tokens') {
        throw new Error('The rewrite was cut off by the output limit.')
      }
    }
  }
  return tidy(text)
}

/** Register the command and dispose it with this plugin. */
export function apply(ctx, config) {
  ctx.effect(() => ctx.commands.register({
    name: COMMAND_NAME,
    description: 'Rewrite the supplied draft into a clearer, more actionable prompt / 把草稿改写成更清晰、可执行的提示词',
    recordInput: false,
    input: { hint: 'draft to rewrite' },
    handler: async ({ rawInput, signal }) => {
      if (rawInput.trim() === '') {
        return { kind: 'error', text: 'There is no draft text to rewrite.' }
      }
      try {
        const text = await rewrite(ctx, config, rawInput, signal)
        if (text === '') return { kind: 'error', text: 'The model returned an empty prompt.' }
        return { kind: 'success', text }
      } catch (error) {
        return { kind: 'error', text: describe(error) }
      }
    },
  }), 'prompt-polish: /polish command')
}
