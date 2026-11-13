/**
 * Client half of the prompt-polish bundle.
 *
 * Contributes one compact control to `conversation.input.right` (the row just
 * before the submit action). The control:
 * - reads the draft through the slot's `useInput` selector hook;
 * - runs `/polish <draft>` through `ctx.remote.commands.execute()`, the
 *   Client-callable Host entry point for user actions;
 * - writes the answer back with `inputActions.setDraft()`, so the result
 *   lands in the composer and the user can edit or send it.
 *
 * The completion is guarded: it is written back only when the same session is
 * still shown, the machine is still idle, and the draft is still the one that
 * was sent. Anything typed or sent meanwhile wins over the late result.
 *
 * The render body is defensive: a missing slot prop or a malformed input state
 * degrades to a disabled control, never to a blank (crashed) slot entry.
 */
window.__ModuleLoader__.load({
  id: 'dsh-prompt-polish',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    /** Locale namespace owned by this plugin. */
    const NS = 'promptPolish'

    /** Longest wait before the control stops waiting; the draft is guarded anyway. */
    const TIMEOUT_MS = 60000

    /** Busy phases of the input machine; `plain` and `claimed` accept typing. */
    const BUSY_PHASES = new Set(['adjudicating', 'submitting', 'sending'])

    /** Stand-in for a missing input state, so a slot without the kit still renders. */
    const EMPTY_INPUT = { draft: '', phase: 'plain', occurrences: [], attachmentIds: [] }

    const en = {
      label: 'Optimize',
      name: 'Optimize the draft prompt',
      busy: 'Optimizing…',
      hint: 'Rewrite the draft into a clearer prompt with the default model',
      hintEmpty: 'Type a prompt first',
      hintBusy: 'Wait for the current submission to finish',
      hintCommand: 'Finish or clear the command in the draft first',
      hintChips: 'Reference chips and attachments become plain text in the rewrite',
      failed: 'Optimization failed',
      timedOut: 'The model did not answer in time',
      unavailable: 'The rewrite command is not available in this session.',
      nothingReturned: 'The model returned no text.',
      draftChanged: 'Draft changed during optimization; the result was discarded',
      errorTitle: 'Prompt optimization failed: {reason}',
      degraded: 'Optimize',
    }

    const zh = {
      label: '优化',
      name: '优化草稿提示词',
      busy: '优化中…',
      hint: '用默认模型把草稿改写成更清晰的提示词',
      hintEmpty: '先输入一段提示词',
      hintBusy: '请等待当前提交完成',
      hintCommand: '请先完成或清除草稿里的命令',
      hintChips: '引用标签与附件在改写后会变成纯文本',
      failed: '优化失败',
      timedOut: '模型没有及时返回',
      unavailable: '当前会话无法使用改写命令。',
      nothingReturned: '模型没有返回内容。',
      draftChanged: '优化期间草稿已改动，结果已丢弃',
      errorTitle: '提示词优化失败：{reason}',
      degraded: '优化',
    }

    /**
     * Component-local stylesheet. Every color is a theme alias, so the control
     * follows light/dark and any theme that redefines the tokens.
     */
    const CSS = `
.dpp { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; }
.dpp__button {
  box-sizing: border-box;
  display: inline-flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 10px;
  border-radius: 999px; corner-shape: round;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; line-height: 1;
  white-space: nowrap; cursor: pointer;
  transition: background .15s, color .15s, border-color .15s;
}
.dpp__button:hover:not(:disabled) {
  background: color-mix(in oklab, var(--dsw-alias-brand-primary) 8%, transparent);
  color: var(--dsw-alias-label-primary);
}
.dpp__button:focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
  outline-offset: 1px;
}
.dpp__button:disabled { opacity: .45; cursor: default; }
.dpp__button--failed { border-color: var(--dsw-alias-state-error-primary); }
.dpp__glyph { display: inline-flex; align-items: center; justify-content: center; }
.dpp__glyph--busy { animation: dpp-spin 1.1s linear infinite; }
@keyframes dpp-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.dpp__failure {
  min-width: 0; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px; color: var(--dsw-alias-state-error-primary);
}
@media (prefers-reduced-motion: reduce) { .dpp__glyph--busy { animation: none; } }
@container (max-width: 560px) { .dpp__text { display: none; } }
@media (max-width: 480px) { .dpp__text { display: none; } }
`

    /** Sparkle glyph drawn inline so the control needs no icon request. */
    function Sparkle() {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
      },
        h('path', { d: 'M7 1.8 8.3 5.7 12.2 7 8.3 8.3 7 12.2 5.7 8.3 1.8 7 5.7 5.7Z' }),
        h('path', { d: 'M12.6 11.2 13.1 12.7 14.6 13.2 13.1 13.7 12.6 15.2 12.1 13.7 10.6 13.2 12.1 12.7Z' }),
      )
    }

    /**
     * One compact composer control.
     * @param props - slot standard props plus this plugin's injected face.
     */
    function PolishControl(props) {
      const useInput = props.useInput
      // A single subscription keeps the hook order minimal and stable: a slot
      // that lacks the kit would otherwise change the number of hook calls.
      const input = (typeof useInput === 'function'
        ? useInput(state => state)
        : undefined) ?? EMPTY_INPUT
      const draft = typeof input.draft === 'string' ? input.draft : ''
      const phase = typeof input.phase === 'string' ? input.phase : 'plain'
      const occurrences = Array.isArray(input.occurrences) ? input.occurrences : []
      const attachmentIds = Array.isArray(input.attachmentIds) ? input.attachmentIds : []

      const inputActions = props.inputActions
      const sessionId = props.sessionId
      const optimize = props.optimize
      const t = typeof props.t === 'function' ? props.t : key => key

      const [pending, setPending] = useState(false)
      const [failure, setFailure] = useState(null)

      // Latest render values for the completion guard, which runs after an
      // await and therefore cannot read this render's props.
      const latest = useRef({ sessionId, draft, phase })
      latest.current = { sessionId, draft, phase }

      // A request belongs to the session it started in: leaving that session
      // drops the in-flight presentation instead of showing it on another one.
      useEffect(() => {
        setPending(false)
        setFailure(null)
      }, [sessionId])

      // A failure is a transient answer, not a second copy of the draft: it
      // clears itself so the toolbar does not accumulate stale errors.
      useEffect(() => {
        if (failure === null) return undefined
        const timer = setTimeout(() => setFailure(null), 8000)
        return () => clearTimeout(timer)
      }, [failure])

      try {
        const usable = typeof inputActions === 'object' && inputActions !== null
          && typeof inputActions.setDraft === 'function'

        const empty = draft.trim() === ''
        const busyPhase = BUSY_PHASES.has(phase)
        const claimed = phase === 'claimed'
        const disabled = pending || empty || busyPhase || claimed || !usable
        const reason = failure !== null
          ? failure
          : pending
            ? t('busy')
            : empty
              ? t('hintEmpty')
              : busyPhase
                ? t('hintBusy')
                : claimed
                  ? t('hintCommand')
                  : occurrences.length > 0 || attachmentIds.length > 0
                    ? t('hintChips')
                    : t('hint')
        const describe = failure !== null ? t('errorTitle', { reason: failure }) : reason

        const onClick = async () => {
          if (disabled) return
          const sent = { sessionId, draft }
          setPending(true)
          setFailure(null)
          let result
          try {
            result = await Promise.race([
              optimize(sent.sessionId, sent.draft),
              new Promise(resolve => setTimeout(() => resolve({ ok: false, reason: t('timedOut') }), TIMEOUT_MS)),
            ])
          } catch (error) {
            result = { ok: false, reason: error instanceof Error && error.message !== '' ? error.message : t('failed') }
          }
          // The request may settle after the user moved to another session;
          // that session's composer is not this request's target.
          if (latest.current.sessionId !== sent.sessionId) return
          if (!result.ok) {
            setFailure(result.reason === '' ? t('failed') : result.reason)
          } else if (latest.current.draft !== sent.draft || latest.current.phase !== 'plain') {
            setFailure(t('draftChanged'))
          } else {
            inputActions.setDraft(result.text)
          }
          setPending(false)
        }

        // Keep the caret in the composer: a mousedown that would move focus is
        // suppressed, exactly as the composer's own tool-row buttons do.
        const onMouseDown = event => event.preventDefault()

        return h('div', { className: 'dpp' },
          h('style', null, CSS),
          h('span', { className: 'dpp__seat', title: describe },
            h('button', {
              type: 'button',
              className: failure === null ? 'dpp__button' : 'dpp__button dpp__button--failed',
              disabled,
              'aria-label': t('name'),
              'aria-busy': pending ? 'true' : 'false',
              'data-dsh-prompt-polish': '',
              onMouseDown,
              onClick,
            },
              h('span', { className: pending ? 'dpp__glyph dpp__glyph--busy' : 'dpp__glyph' }, h(Sparkle)),
              h('span', { className: 'dpp__text' }, pending ? t('busy') : t('label')),
            ),
          ),
          failure === null
            ? null
            : h('span', { className: 'dpp__failure', role: 'alert', title: failure }, failure),
        )
      } catch (error) {
        // A rendering failure must stay visible: an empty crashed entry hides
        // the whole feature, while this text still reports the capability.
        return h('div', { className: 'dpp' },
          h('style', null, CSS),
          h('span', { className: 'dpp__button', role: 'note', title: String(error) },
            h('span', { className: 'dpp__text' }, t('degraded')),
          ),
        )
      }
    }

    return {
      // Nested Remote namespaces are their own injectable services: the bare
      // `remote` service does not expose `remote.commands` to a plugin that
      // only declares it. Cordis refuses the property read with
      // `cannot get property "remote.commands" without inject`.
      inject: ['slots', 'locale', 'remote', 'remote.commands'],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(NS, { en, zh }),
          'prompt-polish: dictionaries',
        )
        const t = ctx.locale.bind(NS)

        /**
         * Run the Host rewrite for one draft.
         * @param sessionId - the session whose agent receives the command.
         * @param draft - current draft text.
         * @returns `{ok: true, text}` or `{ok: false, reason}`.
         */
        const optimize = async (sessionId, draft) => {
          if (typeof sessionId !== 'string' || sessionId === '') {
            return { ok: false, reason: t('unavailable') }
          }
          let commands
          try {
            commands = ctx.remote === undefined ? undefined : ctx.remote.commands
          } catch (error) {
            return { ok: false, reason: t('unavailable') }
          }
          if (commands === undefined || typeof commands.execute !== 'function') {
            return { ok: false, reason: t('unavailable') }
          }
          let result
          try {
            result = await commands.execute(sessionId, `/polish ${draft}`, [])
          } catch (error) {
            return { ok: false, reason: error instanceof Error && error.message !== '' ? error.message : t('failed') }
          }
          if (result === undefined || result === null || result.ok !== true) {
            const error = result === undefined || result === null ? undefined : result.error
            const reason = error === undefined ? t('failed') : (error.message || error.code || t('failed'))
            return { ok: false, reason }
          }
          const execution = result.value
          if (execution === undefined || execution === null || typeof execution.result !== 'object') {
            return { ok: false, reason: t('unavailable') }
          }
          if (execution.result.kind === 'error') {
            return { ok: false, reason: execution.result.text }
          }
          const text = execution.result.text
          if (typeof text !== 'string' || text.trim() === '') {
            return { ok: false, reason: t('nothingReturned') }
          }
          return { ok: true, text }
        }

        const face = { t, optimize }

        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right',
          id: 'dsh-prompt-polish',
          order: 10,
          locale: NS,
          inject: () => face,
        }, PolishControl))
      },
    }
  },
})
