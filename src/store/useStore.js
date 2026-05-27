import { create } from 'zustand'
import { supabase } from '../utils/supabase'
import { logError } from '../utils/telemetry'

const DEFAULT_SETTINGS = {
  themeId: 'dark',
  accent: '#6FA1FF',
  fontSize: 'Medium',
  bubbleStyle: 'Rounded',
  plan: 'free',
  agents: {
    claude:  { enabled: true,  key: '' },
    gpt:     { enabled: true,  key: '' },
    gemini:  { enabled: false, key: '' },
    grok:    { enabled: false, key: '' },
  },
  // Per-tool enabled flags. Just on/off — the actual key for every
  // tool lives in toolKeys below.
  tools: {},
  // Single source of truth for tool API keys, mirroring the
  // user_api_keys.tool_keys jsonb column. Adding a new tool means
  // adding one entry to the registry — no changes here.
  toolKeys: {},
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
            bubbleStyle: s?.bubble_style || state.settings.bubbleStyle,
            primaryStorageProvider: s?.primary_storage_provider || null,
            plan: s?.plan || state.settings.plan,
            agents: {
              claude:  { enabled: s?.enabled_agents?.claude?.enabled ?? true,  key: k?.claude_key  || '' },
              gpt:     { enabled: s?.enabled_agents?.gpt?.enabled     ?? true,  key: k?.gpt_key     || '' },
              gemini:  { enabled: s?.enabled_agents?.gemini?.enabled  ?? false, key: k?.gemini_key  || '' },
              grok:    { enabled: s?.enabled_agents?.grok?.enabled    ?? false, key: k?.grok_key    || '' },
            },
            // Enabled flags only — keys live in toolKeys
            tools: Object.fromEntries(
              Object.entries(s?.enabled_tools || {}).map(([id, v]) => [id, { enabled: !!v?.enabled }])
            ),
            toolKeys: k?.tool_keys || {},
          },
          settingsLoaded: true,
        }))
      } else {
        set({ settingsLoaded: true })
      }
    } catch (e) {
      logError("loadSettings", e)
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
          bubble_style: settings.bubbleStyle,

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
          // Agent keys remain as columns — they're the panel members,
          // a different conceptual category from tools.
          claude_key: settings.agents.claude?.key || '',
          gpt_key:    settings.agents.gpt?.key    || '',
          gemini_key: settings.agents.gemini?.key || '',
          grok_key:   settings.agents.grok?.key   || '',
          // Every tool key lives in this jsonb. One place. Forever.
          tool_keys:  settings.toolKeys || {},
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' }),
      ])

      if (e1) logError("saveSettings.userSettings", e1)
      if (e2) logError("saveSettings.userApiKeys", e2)
    } catch (e) {
      logError("saveSettings", e)
    }
  },

  turns: [],
  activeAgentId: null,
  conversationId: null,

  addTurn: (turn) => set(state => ({
    turns: [...state.turns, turn],
    // Only agent turns set activeAgentId — user, claw, and tool turns are not "streaming"
    activeAgentId: turn.type === 'agent' ? turn.id : state.activeAgentId,
  })),
  appendChunk: (id, chunk) => set(state => ({ turns: state.turns.map(t => t.id === id ? { ...t, text: (t.text || '') + chunk } : t) })),
  // Clear a turn's text and mark it for a retry pass (audit found drift)
  resetTurnForRetry: (id) => set(state => ({
    turns: state.turns.map(t => t.id === id ? { ...t, text: '', reRolled: true } : t),
    activeAgentId: id,
  })),
  finishTurn: () => set({ activeAgentId: null }),
  addToolTurn: (turn) => set(state => ({ turns: [...state.turns, turn] })), // doesn't set activeAgentId
  updateToolTurn: (id, patch) => set(state => ({ turns: state.turns.map(t => t.id === id ? { ...t, output: { ...t.output, ...patch } } : t) })),
  // For build turns, patches merge at the top level. If a patch value is a
  // function, it gets called with the current value (used for step status
  // updates where we need to mutate one item in an array).
  updateBuildTurn: (id, patch) => set(state => ({
    turns: state.turns.map(t => {
      if (t.id !== id) return t
      const updated = { ...t }
      for (const [k, v] of Object.entries(patch)) {
        updated[k] = typeof v === 'function' ? v(t[k]) : v
      }
      return updated
    }),
  })),
  addErrorTurn: (agentId, errorType) => set(state => ({ turns: [...state.turns, { id: `err-${agentId}-${Date.now()}`, type: 'error', agent: agentId, errorType }], activeAgentId: null })),
  addToolErrorTurn: (tool, errorType, message) => set(state => ({ turns: [...state.turns, { id: `tool-err-${tool}-${Date.now()}`, type: 'tool_error', tool, errorType, message }] })),
  clearTurns: () => set({ turns: [], activeAgentId: null, conversationId: null }),

  saveConversation: async (turns) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !turns.length) return
      const cId = useStore.getState().conversationId
      const projectId = useStore.getState().activeProject?.id || null
      const title = turns.find(t => t.type === "user")?.text?.slice(0, 60) || "Conversation"
      const preview = turns.find(t => t.type === "agent" && t.text)?.text?.slice(0, 100) || ""
      if (cId) {
        await supabase.from("conversations").update({ title, preview, turn_count: turns.length, turns_data: JSON.stringify(turns), project_id: projectId, updated_at: new Date().toISOString() }).eq("id", cId).eq("user_id", user.id)
      } else {
        const { data } = await supabase.from("conversations").insert({ user_id: user.id, project_id: projectId, title, preview, turn_count: turns.length, turns_data: JSON.stringify(turns), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).select().single()
        if (data?.id) useStore.setState({ conversationId: data.id })
      }
    } catch(e) { logError("saveConversation", e) }
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
    } catch(e) { logError("loadConversation", e) }
  },

  // ── Agent Memory ──────────────────────────────────────
  loadMemory: async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []
      const { data } = await supabase.from("agent_memory")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
      return data || []
    } catch(e) { return [] }
  },

  saveMemory: async (title, content, source="upload") => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null
      const { data } = await supabase.from("agent_memory").insert({
        user_id: user.id,
        title,
        content,
        source,
        created_at: new Date().toISOString()
      }).select().single()
      return data
    } catch(e) { logError("saveMemory", e); return null }
  },

  deleteMemory: async (id) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from("agent_memory").delete().eq("id", id).eq("user_id", user.id)
    } catch(e) { logError("deleteMemory", e) }
  },

  deleteConversation: async (id) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from("conversations").delete().eq("id", id).eq("user_id", user.id)
    } catch(e) { logError("deleteConversation", e) }
  },

  voiceMode: false,
  listening: false,
  voiceStatus: 'idle',
  setVoiceMode: (val) => set({ voiceMode: val }),
  setListening: (val) => set({ listening: val }),
  setVoiceStatus: (val) => set({ voiceStatus: val }),

  // ── Projects ─────────────────────────────────────────────
  activeProject: null,
  projects: [],
  setActiveProject: (project) => set({ activeProject: project }),

  loadProjects: async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []
      const { data } = await supabase.from('projects')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
      set({ projects: data || [] })
      return data || []
    } catch (e) {
      logError("loadProjects", e)
      return []
    }
  },

  createProject: async (name, description = '') => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null
      const { data, error } = await supabase.from('projects')
        .insert({ user_id: user.id, name, description, status: 'active' })
        .select().single()
      if (error) { logError("createProject", error); return null }
      set(state => ({ projects: [data, ...state.projects], activeProject: data }))
      return data
    } catch (e) {
      logError("createProject", e)
      return null
    }
  },

  updateProject: async (id, patch) => {
    try {
      const { data, error } = await supabase.from('projects')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select().single()
      if (error) { logError("updateProject", error); return null }
      set(state => ({
        projects: state.projects.map(p => p.id === id ? data : p),
        activeProject: state.activeProject?.id === id ? data : state.activeProject,
      }))
      return data
    } catch (e) {
      logError("updateProject", e)
      return null
    }
  },

  deleteProject: async (id) => {
    try {
      await supabase.from('projects').delete().eq('id', id)
      set(state => ({
        projects: state.projects.filter(p => p.id !== id),
        activeProject: state.activeProject?.id === id ? null : state.activeProject,
      }))
    } catch (e) {
      logError("deleteProject", e)
    }
  },
}))
