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
    // useSkills: when true, this agent reads the matching Skills folder + shared/.
    // When false, skills are skipped for this agent (saves tokens). Defaults true.
    claude:  { enabled: true,  key: '', useSkills: true },
    gpt:     { enabled: true,  key: '', useSkills: true },
    gemini:  { enabled: false, key: '', useSkills: true },
    grok:    { enabled: false, key: '', useSkills: true },
  },
  tools: {},
  toolKeys: {},
  voiceModeEnabled: false,
  agentVoices: {},
}

const EMPTY_SKILLS = {
  shared: [], claude: [], gpt: [], gemini: [], grok: [],
  loadedAt: null,
  loading: false,
  error: null,
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

      const [{ data: s }, { data: keyRows }] = await Promise.all([
        supabase.from('user_settings').select('*').eq('user_id', user.id).single(),
        // Keys are encrypted at rest; the SECURITY DEFINER RPC decrypts and
        // returns only the caller's own keys. Returns a set, so take the row.
        supabase.rpc('get_user_api_keys'),
      ])
      const k = Array.isArray(keyRows) ? keyRows[0] : keyRows

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
              claude:  {
                enabled:   s?.enabled_agents?.claude?.enabled   ?? true,
                useSkills: s?.enabled_agents?.claude?.useSkills ?? true,
                key:       k?.claude_key || '',
              },
              gpt:     {
                enabled:   s?.enabled_agents?.gpt?.enabled   ?? true,
                useSkills: s?.enabled_agents?.gpt?.useSkills ?? true,
                key:       k?.gpt_key || '',
              },
              gemini:  {
                enabled:   s?.enabled_agents?.gemini?.enabled   ?? false,
                useSkills: s?.enabled_agents?.gemini?.useSkills ?? true,
                key:       k?.gemini_key || '',
              },
              grok:    {
                enabled:   s?.enabled_agents?.grok?.enabled   ?? false,
                useSkills: s?.enabled_agents?.grok?.useSkills ?? true,
                key:       k?.grok_key || '',
              },
            },
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
            claude:  { enabled: settings.agents.claude?.enabled ?? true,  useSkills: settings.agents.claude?.useSkills ?? true },
            gpt:     { enabled: settings.agents.gpt?.enabled    ?? true,  useSkills: settings.agents.gpt?.useSkills    ?? true },
            gemini:  { enabled: settings.agents.gemini?.enabled ?? false, useSkills: settings.agents.gemini?.useSkills ?? true },
            grok:    { enabled: settings.agents.grok?.enabled   ?? false, useSkills: settings.agents.grok?.useSkills   ?? true },
          },
          enabled_tools: Object.fromEntries(
            Object.entries(settings.tools || {}).map(([id, v]) => [id, { enabled: v.enabled || false }])
          ),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' }),

        // Encrypt-at-rest: the RPC encrypts each key with the Vault-held master
        // key and upserts the caller's row. user_id is taken from auth.uid()
        // inside the function, never passed from the client.
        supabase.rpc('set_user_api_keys', {
          p_claude:    settings.agents.claude?.key || '',
          p_gpt:       settings.agents.gpt?.key    || '',
          p_gemini:    settings.agents.gemini?.key || '',
          p_grok:      settings.agents.grok?.key   || '',
          p_tool_keys: settings.toolKeys || {},
        }),
      ])

      if (e1) logError("saveSettings.userSettings", e1)
      if (e2) logError("saveSettings.userApiKeys", e2)
    } catch (e) {
      logError("saveSettings", e)
    }
  },

  skills: EMPTY_SKILLS,

  loadSkills: async () => {
    set(state => ({ skills: { ...state.skills, loading: true, error: null } }))
    try {
      const { loadSkillsFromDrive } = await import('../utils/skillsLoader')
      const result = await loadSkillsFromDrive()
      if (!result) {
        set({ skills: { ...EMPTY_SKILLS, loadedAt: new Date().toISOString(), error: 'drive_not_connected' } })
        return
      }
      set({
        skills: {
          shared: result.shared || [],
          claude: result.claude || [],
          gpt:    result.gpt    || [],
          gemini: result.gemini || [],
          grok:   result.grok   || [],
          loadedAt: new Date().toISOString(),
          loading: false,
          error: null,
        },
      })
    } catch (e) {
      logError('loadSkills', e)
      set(state => ({ skills: { ...state.skills, loading: false, error: e.message || 'unknown' } }))
    }
  },

  turns: [],
  activeAgentId: null,
  conversationId: null,

  addTurn: (turn) => set(state => ({
    turns: [...state.turns, turn],
    activeAgentId: turn.type === 'agent' ? turn.id : state.activeAgentId,
  })),
  appendChunk: (id, chunk) => set(state => ({ turns: state.turns.map(t => t.id === id ? { ...t, text: (t.text || '') + chunk } : t) })),
  // Replace a turn's text outright (used to display sanitized streamed output).
  setTurnText: (id, text) => set(state => ({ turns: state.turns.map(t => t.id === id ? { ...t, text } : t) })),
  resetTurnForRetry: (id) => set(state => ({
    turns: state.turns.map(t => t.id === id ? { ...t, text: '', reRolled: true } : t),
    activeAgentId: id,
  })),
  finishTurn: () => set({ activeAgentId: null }),
  addToolTurn: (turn) => set(state => ({ turns: [...state.turns, turn] })),
  updateToolTurn: (id, patch) => set(state => ({ turns: state.turns.map(t => t.id === id ? { ...t, output: { ...t.output, ...patch } } : t) })),
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
        user_id: user.id, title, content, source,
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
