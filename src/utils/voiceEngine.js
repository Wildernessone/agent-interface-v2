
export class VoiceEngine {
  constructor(settings) {
    this.settings = settings
    this.elevenLabsKey = settings?.tools?.elevenlabs?.key || ""
    this.elevenLabsEnabled = !!this.elevenLabsKey && settings?.tools?.elevenlabs?.enabled
    this.elevenLabsFailed = false
    this.recognition = null
    this.synth = window.speechSynthesis || null
    this.speaking = false
    this.queue = []
  }

  updateSettings(settings) {
    this.settings = settings
    this.elevenLabsKey = settings?.tools?.elevenlabs?.key || ""
    this.elevenLabsEnabled = !!this.elevenLabsKey && settings?.tools?.elevenlabs?.enabled
    if (this.elevenLabsKey) this.elevenLabsFailed = false
  }

  startListening(onTranscript, onStateChange) {
    this.stopSpeaking()
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { onStateChange?.("unsupported"); return false }
    if (this.recognition) this.recognition.stop()
    this.recognition = new SR()
    this.recognition.continuous = true       // keep listening
    this.recognition.interimResults = true   // show partial results
    this.recognition.lang = "en-US"
    this.recognition.maxAlternatives = 1

    let silenceTimer = null
    let finalTranscript = ""

    this.recognition.onstart = () => onStateChange?.("listening")
    this.recognition.onend = () => {
      // Only call idle if we didn't get a transcript
      if (!finalTranscript) onStateChange?.("idle")
    }
    this.recognition.onerror = (e) => {
      if (e.error !== "no-speech") onStateChange?.("idle")
    }
    this.recognition.onresult = (e) => {
      clearTimeout(silenceTimer)
      let interim = ""
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalTranscript += e.results[i][0].transcript + " "
        } else {
          interim = e.results[i][0].transcript
        }
      }
      // Auto-send after 1.5 seconds of silence
      silenceTimer = setTimeout(() => {
        const text = finalTranscript.trim() || interim.trim()
        if (text) {
          onStateChange?.("processing")
          this.recognition.stop()
          finalTranscript = ""
          onTranscript(text)
        }
      }, 1500)
    }
    try { this.recognition.start(); return true }
    catch(e) { onStateChange?.("idle"); return false }
  }

  stopListening() {
    if (this.recognition) { this.recognition.stop(); this.recognition = null }
  }

  async speak(text, agentId="claude", onDone) {
    if (!text) { onDone?.(); return }
    this.queue.push({ text, agentId, onDone })
    if (!this.speaking) this._processQueue()
  }

  async _processQueue() {
    if (this.queue.length === 0) { this.speaking = false; return }
    this.speaking = true
    const { text, agentId, onDone } = this.queue.shift()
    let success = false
    if (this.elevenLabsEnabled && !this.elevenLabsFailed) {
      success = await this._speakElevenLabs(text, agentId)
    }
    if (!success) await this._speakBrowser(text, agentId)
    onDone?.()
    this._processQueue()
  }

  async _speakElevenLabs(text, agentId) {
    const VOICES = {
      claude: "ErXwobaYiN019PkySvjV",
      gpt:    "VR6AewLTigWG4xSOukaG",
      gemini: "EXAVITQu4vr4xnSDxMaL",
    }
    const voiceId = this.settings?.agentVoices?.[agentId]?.elevenLabsId || VOICES[agentId]
    if (!voiceId || !this.elevenLabsKey) return false
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": this.elevenLabsKey },
        body: JSON.stringify({ text: text.slice(0,500), model_id:"eleven_turbo_v2", voice_settings:{ stability:0.5, similarity_boost:0.75 } }),
      })
      if (res.status === 401 || res.status === 429 || res.status === 402) {
        this.elevenLabsFailed = true
        return false
      }
      if (!res.ok) { this.elevenLabsFailed = true; return false }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      await new Promise(resolve => {
        const audio = new Audio(url)
        audio.onended = () => { URL.revokeObjectURL(url); resolve() }
        audio.onerror = () => { URL.revokeObjectURL(url); resolve() }
        audio.play().catch(resolve)
      })
      return true
    } catch(e) { this.elevenLabsFailed = true; return false }
  }

  async _speakBrowser(text, agentId) {
    if (!this.synth) return
    this.synth.cancel()
    // Distinct browser voices per agent - different pitch/rate makes them feel different
    const BROWSER_VOICES = {
      claude:  { names:["Daniel","Alex","Fred"],           pitch:0.92, rate:0.92, volume:1.0 },
      gpt:     { names:["Google US English","Samantha"],   pitch:1.02, rate:1.08, volume:1.0 },
      gemini:  { names:["Samantha","Karen","Victoria"],    pitch:1.12, rate:1.0,  volume:1.0 },
      grok:    { names:["Alex","Google UK English Male"],  pitch:0.88, rate:1.05, volume:1.0 },
    }
    const cfg = BROWSER_VOICES[agentId] || BROWSER_VOICES.claude
    const voices = this.synth.getVoices()
    // Try each preferred voice name in order
    let voice = null
    for (const name of cfg.names) {
      voice = voices.find(v => v.name === name)
      if (voice) break
    }
    // Fall back to any English voice
    if (!voice) voice = voices.find(v => v.lang.startsWith("en") && !v.name.includes("Google")) || voices.find(v => v.lang.startsWith("en")) || voices[0]
    await new Promise(resolve => {
      const u = new SpeechSynthesisUtterance(text.slice(0,300))
      u.voice = voice
      u.pitch = cfg.pitch
      u.rate = cfg.rate
      u.volume = 1.0
      const timeout = setTimeout(resolve, text.length * 80)
      u.onend = () => { clearTimeout(timeout); resolve() }
      u.onerror = resolve
      this.synth.speak(u)
    })
  }

  stopSpeaking() {
    this.queue = []
    this.speaking = false
    this.synth?.cancel()
  }

  canListen() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition) }
  canSpeak() { return !!window.speechSynthesis }
  usingElevenLabs() { return this.elevenLabsEnabled && !this.elevenLabsFailed }
  voiceStatus() {
    if (!this.canSpeak()) return "unsupported"
    if (this.usingElevenLabs()) return "elevenlabs"
    if (this.elevenLabsFailed) return "fallback"
    return "browser"
  }
}
