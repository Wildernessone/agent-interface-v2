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
    grok:    { enabled: false, key: '' },
  },
  tools: {
    dalle:      { enabled: false, key: '' },
    stability:  { enabled: false, key: '' },
    ideogram:   { enabled: false, key: '' },
    flux:       { enabled: false, key: '' },
    runway:     { enabled: false, key: '' },
    kling:      { enabled: false, key: '' },
    veo:        { enabled: false, key: '' },
    pika:       { enabled: false, key: '' },
    suno:       { enabled: false, key: '' },
    udio:       { enabled: false, key: '' },
    elevenlabs_music: { enabled: false, key: '' },
    elevenlabs: { enabled: false, key: '' },
    playht:     { enabled: false, key: '' },
    perplexity: { enabled: false, key: '' },
    tavily:     { enabled: false, key: '' },
    brave:      { enabled: false, key: '' },
  },
  voiceModeEnabled: false,
  agentVoices: {},
}

export const useStore = create((set, get) => ({
  user: null,
  session: null,
  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),

  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,
  _saveTimer: null,

  updateSetting: (key, value) => {
    set(state => ({ settings: { ...state.settings, [key]: value } }))
    clearTimeout(get()._saveTimer)
    const timer = setTimeout(() => get().saveSettings(), 1000)
    set({ _saveTimer: timer })
  },

  loadSettings: async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const [{ data: s }, { data: k }] = await Promise.all([
        supabase.from('user_settings').select('*').eq('user_id', user.id).single(),
        supabase.from('user_api_keys').select('*').eq('user_id', user.id).single(),
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
              grok:    { enabled: s?.enabled_agents?.grok?.enabled    ?? false, key: k?.grok_key    || '' },
            },
            tools: {
              ...state.settings.tools,
              ...(s?.enabled_tools || {}),
              suno:       { ...(s?.enabled_tools?.suno       || state.settings.tools.suno),       key: k?.suno_key        || '' },
              elevenlabs: { ...(s?.enabled_tools?.elevenlabs || state.settings.tools.elevenlabs), key: k?.elevenlabs_key  || '' },
              perplexity: { ...(s?.enabled_tools?.perplexity || state.settings.tools.perplexity), key: k?.perplexity_key  || '' },
              stability:  { ...(s?.enabled_tools?.stability  || state.settings.tools.stability),  key: k?.stability_key   || '' },
              tavily:     { ...(s?.enabled_tools?.tavily     || state.settings.tools.tavily),     key: k?.tavily_key      || '' },
              brave:      { ...(s?.enabled_tools?.brave      || state.settings.tools.brave),      key: k?.brave_key       || '' },
              playht:     { ...(s?.enabled_tools?.playht     || state.settings.tools.playht),     key: k?.playht_key      || '' },
              udio:       { ...(s?.enabled_tools?.udio       || state.settings.tools.udio),       key: k?.udio_key        || '' },
              dalle:      { ...(s?.enabled_tools?.dalle      || state.settings.tools.dalle),      key: '' },
              runway:     { ...(s?.enabled_tools?.runway     || state.settings.tools.runway),     key: k?.runway_key      || '' },
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

  saveSettings: async () => {
    const { settings } = get()
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const [{ error: e1 }, { error: e2 }] = await Promise.all([
        supabase.from('user_settings').upsert({
          user_id: user.id,
          theme_id: settings.themeId,
          accent: settings.accent,
          font_size: settings.fontSize,

          enabled_agents: {
            claude:  { enabled: settings.agents.claude?.enabled ?? true },
            gpt:     { enabled: settings.agents.gpt?.enabled ?? true },
            gemini:  { enabled: settings.agents.gemini?.enabled ?? false },
            grok:    { enabled: settings.agents.grok?.enabled    ?? false },
          },
          enabled_tools: Object.fromEntries(
            Object.entries(settings.tools || {}).map(([id, v]) => [id, { enabled: v.enabled || false }])
          ),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' }),

        supabase.from('user_api_keys').upsert({
          user_id: user.id,
          claude_key:     settings.agents.claude?.key || '',
          gpt_key:        settings.agents.gpt?.key || '',
          gemini_key:     settings.agents.gemini?.key || '',
          grok_key:       settings.agents.grok?.key    || '',
          suno_key:       settings.tools.suno?.key || '',
          elevenlabs_key: settings.tools.elevenlabs?.key || '',
          perplexity_key: settings.tools.perplexity?.key || '',
          stability_key:  settings.tools.stability?.key || '',
          tavily_key:     settings.tools.tavily?.key || '',
          brave_key:      settings.tools.brave?.key || '',
          playht_key:     settings.tools.playht?.key || '',
          udio_key:       settings.tools.udio?.key || '',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' }),
      ])

      if (e1) console.error('Settings save error:', e1)
      if (e2) console.error('Keys save error:', e2)
    } catch (e) {
      console.error('Save error:', e)
    }
  },

  turns: [],
  activeAgentId: null,
  conversationId: null,

  addTurn: (turn) => set(state => ({ turns: [...state.turns, turn], activeAgentId: turn.id })),
  appendChunk: (id, chunk) => set(state => ({ turns: state.turns.map(t => t.id === id ? { ...t, text: (t.text || '') + chunk } : t) })),
  finishTurn: () => set({ activeAgentId: null }),
  addToolTurn: (turn) => set(state => ({ turns: [...state.turns, turn] })), // doesn't set activeAgentId
  addErrorTurn: (agentId, errorType) => set(state => ({ turns: [...state.turns, { id: `err-${agentId}-${Date.now()}`, type: 'error', agent: agentId, errorType }], activeAgentId: null })),
  clearTurns: () => set({ turns: [], activeAgentId: null, conversationId: null }),

  saveConversation: async (turns) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !turns.length) return
      const cId = useStore.getState().conversationId
      const title = turns.find(t => t.type === "user")?.text?.slice(0, 60) || "Conversation"
      const preview = turns.find(t => t.type === "agent" && t.text)?.text?.slice(0, 100) || ""
      if (cId) {
        await supabase.from("conversations").update({ title, preview, turn_count: turns.length, turns_data: JSON.stringify(turns), updated_at: new Date().toISOString() }).eq("id", cId).eq("user_id", user.id)
      } else {
        const { data } = await supabase.from("conversations").insert({ user_id: user.id, title, preview, turn_count: turns.length, turns_data: JSON.stringify(turns), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).select().single()
        if (data?.id) useStore.setState({ conversationId: data.id })
      }
    } catch(e) { console.error("Save error:", e) }
  },

  loadConversations: async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []
      const { data } = await supabase.from("conversations").select("id,title,preview,turn_count,updated_at").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(50)
      return data || []
    } catch(e) { return [] }
  },

  loadConversation: async (id) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from("conversations").select("*").eq("id", id).eq("user_id", user.id).single()
      if (data?.turns_data) useStore.setState({ turns: JSON.parse(data.turns_data), conversationId: id, activeAgentId: null })
    } catch(e) { console.error("Load error:", e) }
  },

  deleteConversation: async (id) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from("conversations").delete().eq("id", id).eq("user_id", user.id)
    } catch(e) { console.error("Delete error:", e) }
  },

  voiceMode: false,
  listening: false,
  voiceStatus: 'idle',
  setVoiceMode: (val) => set({ voiceMode: val }),
  setListening: (val) => set({ listening: val }),
  setVoiceStatus: (val) => set({ voiceStatus: val }),
}))
