import { create } from 'zustand'
import { supabase } from '../utils/supabase'

const DEFAULT_SETTINGS = {
  themeId: 'dark',
  accent: '#6366f1',
  fontSize: 'Medium',
  plan: 'free',
  trialDaysLeft: 15,
  agents: {
    claude:  { enabled: true,  key: '' },
    gpt:     { enabled: true,  key: '' },
    gemini:  { enabled: false, key: '' },
  },
  tools: {
    dalle:      { enabled: false, key: '' },
    suno:       { enabled: false, key: '' },
    elevenlabs: { enabled: false, key: '' },
    perplexity: { enabled: false, key: '' },
    runway:     { enabled: false, key: '' },
    kling:      { enabled: false, key: '' },
    udio:       { enabled: false, key: '' },
    stability:  { enabled: false, key: '' },
    midjourney: { enabled: false, key: '' },
    flux:       { enabled: false, key: '' },
    veo:        { enabled: false, key: '' },
    pika:       { enabled: false, key: '' },
    seedance:   { enabled: false, key: '' },
    playht:     { enabled: false, key: '' },
    whisper:    { enabled: false, key: '' },
    tavily:     { enabled: false, key: '' },
    brave:      { enabled: false, key: '' },
  },
  voiceModeEnabled: false,
  agentVoices: {},
}

export const useStore = create((set, get) => ({
  // ── Auth ──────────────────────────────────────────
  user: null,
  session: null,
  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),

  // ── Settings ──────────────────────────────────────
  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,

  updateSetting: (key, value) => {
    set(state => ({
      settings: { ...state.settings, [key]: value }
    }))
    // Auto-save to Supabase after 1 second
    clearTimeout(get()._saveTimer)
    const timer = setTimeout(() => get().saveSettings(), 1000)
    set({ _saveTimer: timer })
  },

  // ── Load settings from Supabase ───────────────────
  loadSettings: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    try {
      const [{ data: s }, { data: k }] = await Promise.all([
        supabase.from('user_settings').select('*').single(),
        supabase.from('user_api_keys').select('*').single(),
      ])

      if (s || k) {
        set(state => ({
          settings: {
            ...state.settings,
            themeId: s?.theme_id || state.settings.themeId,
            accent: s?.accent || state.settings.accent,
            fontSize: s?.font_size || state.settings.fontSize,
            plan: s?.plan || state.settings.plan,
            trialDaysLeft: s?.trial_days_left ?? state.settings.trialDaysLeft,
            agents: {
              claude:  { enabled: s?.enabled_agents?.claude?.enabled ?? true,  key: k?.claude_key  || '' },
              gpt:     { enabled: s?.enabled_agents?.gpt?.enabled     ?? true,  key: k?.gpt_key     || '' },
              gemini:  { enabled: s?.enabled_agents?.gemini?.enabled  ?? false, key: k?.gemini_key  || '' },
            },
          },
          settingsLoaded: true,
        }))
      } else {
        set({ settingsLoaded: true })
      }
    } catch (e) {
      console.error('Load settings error:', e)
      set({ settingsLoaded: true })
    }
  },

  // ── Save settings to Supabase ─────────────────────
  saveSettings: async () => {
    const { settings } = get()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    try {
      await Promise.all([
        supabase.from('user_settings').upsert({
          user_id: user.id,
          theme_id: settings.themeId,
          accent: settings.accent,
          font_size: settings.fontSize,
          plan: settings.plan,
          trial_days_left: settings.trialDaysLeft,
          enabled_agents: {
            claude:  { enabled: settings.agents.claude.enabled },
            gpt:     { enabled: settings.agents.gpt.enabled },
            gemini:  { enabled: settings.agents.gemini.enabled },
          },
          updated_at: new Date().toISOString(),
        }),
        supabase.from('user_api_keys').upsert({
          user_id: user.id,
          claude_key:      settings.agents.claude.key,
          gpt_key:         settings.agents.gpt.key,
          gemini_key:      settings.agents.gemini.key,
          suno_key:        settings.tools.suno?.key || '',
          elevenlabs_key:  settings.tools.elevenlabs?.key || '',
          perplexity_key:  settings.tools.perplexity?.key || '',
          updated_at: new Date().toISOString(),
        }),
      ])
    } catch (e) {
      console.error('Save settings error:', e)
    }
  },

  // ── Conversation ──────────────────────────────────
  turns: [],
  activeAgentId: null,
  conversationId: null,

  addTurn: (turn) => set(state => ({
    turns: [...state.turns, turn],
    activeAgentId: turn.id,
  })),

  appendChunk: (id, chunk) => set(state => ({
    turns: state.turns.map(t =>
      t.id === id ? { ...t, text: (t.text || '') + chunk } : t
    ),
  })),

  finishTurn: () => set({ activeAgentId: null }),

  addErrorTurn: (agentId, errorType) => set(state => ({
    turns: [...state.turns, {
      id: `err-${agentId}-${Date.now()}`,
      type: 'error',
      agent: agentId,
      errorType,
    }],
    activeAgentId: null,
  })),

  clearTurns: () => set({ turns: [], activeAgentId: null }),

  // ── Voice ─────────────────────────────────────────
  voiceMode: false,
  listening: false,
  voiceStatus: 'idle',

  setVoiceMode: (val) => set({ voiceMode: val }),
  setListening: (val) => set({ listening: val }),
  setVoiceStatus: (val) => set({ voiceStatus: val }),
}))
