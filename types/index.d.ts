export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** The latest prompt's judgement: asking, a pick, or why there is none. */
export type Judgement =
  | { phase: 'asking' }
  | { phase: 'picked'; pick: Effort; score: number; confidence: number; ms: number; from?: Effort | number; sent?: Effort | number }
  | { phase: 'kept'; reason: string }

declare module 'claude-code' {
  interface PluginState {
    'auto-effort': {
      judgement: Judgement | null
      isOff: boolean
      previous: string | null
      /** The session's own effort, as the last main-thread request carried it before any rewrite. */
      sessionEffort: Effort | number | null
      /** A prompt queued (ctrl+x enter) to run as its own turn, and its pick, held until that turn starts. */
      queued: { text: string; judgement: Judgement | null } | null
      /** The running main-thread turn, as its requests went out; logged at turn.complete. */
      run: { turnId: string; prompt: string; session?: Effort | number; requests: number; efforts: (Effort | number)[]; outputTokens: number } | null
    }
  }
}
