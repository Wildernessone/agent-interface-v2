
// Export conversation to different formats
// Called from TheInterface when user clicks Export

export function exportConversation(turns, format = "txt") {
  const date = new Date().toLocaleDateString("en-US", { 
    year: "numeric", month: "long", day: "numeric", 
    hour: "2-digit", minute: "2-digit" 
  })
  
  const agentNames = { claude: "Claude", gpt: "ChatGPT", gemini: "Gemini", grok: "Grok" }

  if (format === "txt") {
    exportTxt(turns, date, agentNames)
  } else if (format === "md") {
    exportMarkdown(turns, date, agentNames)
  } else if (format === "html") {
    exportHtml(turns, date, agentNames)
  }
}

function exportTxt(turns, date, agentNames) {
  const lines = []
  lines.push("AGENT INTERFACE — CONVERSATION EXPORT")
  lines.push(`Generated: ${date}`)
  lines.push("=".repeat(60))
  lines.push("")

  turns.forEach(turn => {
    if (turn.type === "user") {
      lines.push("YOU:")
      lines.push(turn.text)
      lines.push("")
    } else if (turn.type === "agent" && turn.text) {
      lines.push(`${agentNames[turn.agent] || turn.agent.toUpperCase()}:`)
      lines.push(turn.text)
      lines.push("")
    } else if (turn.type === "tool" && turn.output) {
      const toolName = turn.output.tool?.toUpperCase() || "TOOL"
      lines.push(`[${toolName} OUTPUT]`)
      if (turn.output.type === "image") lines.push(`Image generated: ${turn.output.url || ""}`)
      if (turn.output.type === "search") lines.push(turn.output.text || "")
      lines.push("")
    }
  })

  lines.push("=".repeat(60))
  lines.push("Exported from Agent Interface — agent-interface-v2.pages.dev")

  download(lines.join("\n"), "agent-interface-conversation.txt", "text/plain")
}

function exportMarkdown(turns, date, agentNames) {
  const lines = []
  lines.push("# Agent Interface — Conversation")
  lines.push(`*${date}*`)
  lines.push("")
  lines.push("---")
  lines.push("")

  turns.forEach(turn => {
    if (turn.type === "user") {
      lines.push("### 💬 You")
      lines.push(turn.text)
      lines.push("")
    } else if (turn.type === "agent" && turn.text) {
      const name = agentNames[turn.agent] || turn.agent
      const emoji = { claude: "🟠", gpt: "🟢", gemini: "🔵", grok: "🟣" }[turn.agent] || "🤖"
      lines.push(`### ${emoji} ${name}`)
      lines.push(turn.text)
      lines.push("")
    } else if (turn.type === "tool" && turn.output) {
      const toolName = turn.output.tool?.toUpperCase() || "TOOL"
      lines.push(`### ⚡ ${toolName} Output`)
      if (turn.output.type === "image" && turn.output.url) {
        lines.push(`![Generated image](${turn.output.url})`)
      }
      if (turn.output.type === "search") lines.push(turn.output.text || "")
      lines.push("")
    }
  })

  lines.push("---")
  lines.push("*Exported from [Agent Interface](https://agent-interface-v2.pages.dev)*")

  download(lines.join("\n"), "agent-interface-conversation.md", "text/markdown")
}

function exportHtml(turns, date, agentNames) {
  const agentColors = { claude: "#E8A87C", gpt: "#74C69D", gemini: "#7EB8F7", grok: "#E879F9" }
  
  let content = ""
  turns.forEach(turn => {
    if (turn.type === "user") {
      content += `
        <div class="turn user">
          <div class="label">You</div>
          <div class="bubble">${escapeHtml(turn.text)}</div>
        </div>`
    } else if (turn.type === "agent" && turn.text) {
      const name = agentNames[turn.agent] || turn.agent
      const color = agentColors[turn.agent] || "#888"
      content += `
        <div class="turn agent">
          <div class="label" style="color:${color}">${name}</div>
          <div class="bubble" style="border-color:${color}33">${escapeHtml(turn.text)}</div>
        </div>`
    } else if (turn.type === "tool" && turn.output) {
      if (turn.output.type === "image" && turn.output.url) {
        content += `
          <div class="turn tool">
            <div class="label">⚡ Image</div>
            <img src="${turn.output.url}" style="max-width:100%;border-radius:8px;margin-top:8px"/>
          </div>`
      }
    }
  })

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Agent Interface — Conversation</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #080A0F; color: #e8e8e8; padding: 20px; max-width: 800px; margin: 0 auto; }
    h1 { color: #a5b4fc; margin-bottom: 4px; }
    .date { color: #555; font-size: 12px; margin-bottom: 24px; }
    .turn { margin-bottom: 20px; }
    .label { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px; color: #888; font-family: monospace; }
    .bubble { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 12px 16px; line-height: 1.65; font-size: 14px; }
    .user .bubble { background: rgba(99,102,241,0.1); border-color: rgba(99,102,241,0.2); }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #1a1a2e; color: #444; font-size: 11px; text-align: center; }
    a { color: #6366f1; }
  </style>
</head>
<body>
  <h1>Agent Interface</h1>
  <div class="date">${date}</div>
  ${content}
  <div class="footer">Exported from <a href="https://agent-interface-v2.pages.dev">Agent Interface</a></div>
</body>
</html>`

  download(html, "agent-interface-conversation.html", "text/html")
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>")
}

function download(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
