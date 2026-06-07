/**
 * BUILD EXECUTOR
 * ==============
 * Multi-step orchestration. OpenClaw produces a plan-as-graph; this
 * runs the graph and bundles the outputs into a deliverable.
 *
 * Plan shape:
 *   {
 *     deliverable: "Pitch deck — Salt+Pine Coffee",
 *     steps: [
 *       { id, tool, needs: [otherStepIds], input, label, output_schema? }
 *     ]
 *   }
 *
 * Execution model:
 *   1. Topological sort the steps by needs[]
 *   2. For each step, substitute {stepId} references in input with the
 *      stringified output of those steps
 *   3. Call the tool's run() with the resolved input
 *   4. Cache the output for downstream interpolation
 *   5. Save every file output into a single build subfolder
 *   6. Return a bundle: { deliverable, files[], stepResults, folderLink }
 *
 * Failure model: one failing step does NOT abort the whole build.
 * It records the error and continues with any steps that don't depend
 * on the failed one. The build card surfaces what made it and what
 * didn't.
 */

import { TOOLS_BY_ID, readKey, ToolError } from '../tools/registry'
import { saveToCloud, pickProvider } from './cloudStorage'
import { supabase } from './supabase'
import { brandBriefFrom } from './brandContext'

// Substitute {stepId} (and {stepId.field}) in a string with the resolved
// outputs of previously-completed steps. Whole-string substitutions can
// also resolve to objects/arrays — used when a downstream tool wants
// structured input rather than a stringified prompt.
// Resolve {stepId.field} against a step's output. The dispatcher (plan) and
// agent_synth (output) independently name fields, so they can drift in case or
// wording (e.g. plan asks for HERO_IMAGE_PROMPT but synth emits image_prompt).
// Try exact, then case-insensitive, then a best-effort fallback to a *prompt*-
// like / text field — so a downstream image/video step never gets fed an empty
// string (which 400s the provider). Returns undefined only if nothing usable.
function resolveField(out, field) {
  if (out == null) return undefined
  if (typeof out !== 'object') return out
  if (out[field] != null && out[field] !== '') return out[field]
  const lower = field.toLowerCase()
  for (const k of Object.keys(out)) {
    if (k.toLowerCase() === lower && out[k] != null && out[k] !== '') return out[k]
  }
  // Field missing/empty — fall back to the most prompt-like value available.
  const promptKey = Object.keys(out).find(k => /prompt/i.test(k) && out[k])
  return out[promptKey] ?? out.text ?? out.title ?? undefined
}

function interpolate(template, stepOutputs) {
  if (template == null) return template
  if (typeof template !== 'string') return template

  // If the whole string is exactly {stepId} or {stepId.field}, pass through
  // the raw value (could be an object). Otherwise stringify the substitution
  // and splice into the surrounding text.
  const whole = template.match(/^\{([a-z0-9_]+)(?:\.([a-z0-9_]+))?\}$/i)
  if (whole) {
    const [, stepId, field] = whole
    const out = stepOutputs[stepId]
    if (out == null) return template
    if (field) return resolveField(out, field)
    return out
  }

  // Match a placeholder optionally wrapped in double quotes (the \1 backref
  // requires the same opening/closing quote). When a downstream step's input
  // is a JSON template, the dispatcher often writes the placeholder as a JSON
  // value and quotes it ("{s1.scenes}"). If that value resolves to an
  // object/array, splicing raw JSON *inside* those quotes breaks the JSON
  // (e.g. {"slides": "[{"id"...}). So for a quoted placeholder we replace the
  // quotes too and emit a JSON-valid token (string→quoted, object/array→raw
  // JSON). Unquoted placeholders splice the stringified value as before.
  return template.replace(/("?)\{([a-z0-9_]+)(?:\.([a-z0-9_]+))?\}\1/gi, (_, quote, stepId, field) => {
    const out = stepOutputs[stepId]
    const v = out == null ? null : (field ? resolveField(out, field) : out)
    if (quote) return v == null ? '""' : JSON.stringify(v)
    if (v == null) return ''
    return typeof v === 'string' ? v : JSON.stringify(v)
  })
}

// Topo sort. Throws if there's a cycle (the dispatcher should never
// produce one but we defend anyway).
function topoSort(steps) {
  const byId = new Map(steps.map(s => [s.id, s]))
  const visited = new Set()
  const result = []
  const visit = (id, stack = new Set()) => {
    if (visited.has(id)) return
    if (stack.has(id)) throw new Error(`build_cycle_detected:${id}`)
    stack.add(id)
    const step = byId.get(id)
    if (!step) return
    for (const dep of step.needs || []) visit(dep, stack)
    stack.delete(id)
    visited.add(id)
    result.push(step)
  }
  for (const s of steps) visit(s.id)
  return result
}

function buildFolderName(deliverable) {
  const safe = (deliverable || 'Build').replace(/[<>:"/\\|?*]/g, '').slice(0, 80).trim()
  const date = new Date().toISOString().slice(0, 10)
  return `${date} — ${safe}`
}

// Render an agent_synth result to readable Markdown. agent_synth always returns
// a parsed object (it requires JSON), shaped by its output_schema — document,
// post, slides, storyboard, spreadsheet — or an arbitrary object when no schema
// was set (the IG-caption / short-copy case). Handles the known shapes, then
// falls back to flattening top-level string/array fields, then to pretty JSON
// so nothing is ever lost.
function synthToMarkdown(out) {
  if (out == null) return ''
  if (typeof out === 'string') return out.trim()
  const lines = []
  const pushBlock = (b) => {
    if (b == null) return
    if (typeof b === 'string') { lines.push(b, ''); return }
    if (b.heading || b.title) lines.push(`## ${b.heading || b.title}`)
    if (typeof b.body === 'string') lines.push(b.body)
    if (Array.isArray(b.paragraphs)) b.paragraphs.forEach(p => lines.push(String(p), ''))
    if (Array.isArray(b.bullets)) b.bullets.forEach(x => lines.push(`- ${x}`))
    if (Array.isArray(b.items)) b.items.forEach(x => lines.push(`- ${x}`))
    if (b.notes) lines.push('', `_${b.notes}_`)
    lines.push('')
  }

  if (out.title) lines.push(`# ${out.title}`, '')

  if (Array.isArray(out.sections)) out.sections.forEach(pushBlock)
  else if (Array.isArray(out.slides)) out.slides.forEach((s, i) => pushBlock({ heading: s.title || `Slide ${i + 1}`, bullets: s.bullets, notes: s.notes }))
  else if (Array.isArray(out.scenes)) {
    out.scenes.forEach((s, i) => pushBlock({ heading: s.title || `Scene ${i + 1}`, body: s.prompt, items: s.on_screen_text ? [s.on_screen_text] : [] }))
    if (out.voiceover_script) pushBlock({ heading: 'Voiceover', body: out.voiceover_script })
  } else if (Array.isArray(out.sheets)) {
    out.sheets.forEach(sh => {
      lines.push(`## ${sh.name || 'Sheet'}`)
      ;(sh.rows || []).forEach(r => lines.push(`| ${(Array.isArray(r) ? r : [r]).join(' | ')} |`))
      lines.push('')
    })
  } else {
    // Generic object (no recognized schema) — flatten top-level fields. This is
    // the IG-caption / "variations" shape: {captions:[...]} or {variation_1:"…"}.
    for (const [k, v] of Object.entries(out)) {
      if (k === 'title') continue
      if (typeof v === 'string') lines.push(`## ${k}`, v, '')
      else if (Array.isArray(v)) { lines.push(`## ${k}`); v.forEach(x => pushBlock(x)) }
      else if (v && typeof v === 'object') pushBlock({ heading: k, body: JSON.stringify(v) })
    }
  }

  const md = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return md || JSON.stringify(out, null, 2)
}

/**
 * Run a build plan. Returns:
 *   {
 *     deliverable,
 *     folderName,
 *     files: [{ stepId, label, output, savedLink, savedProvider }],
 *     errors: [{ stepId, tool, code, error }],
 *     stepOutputs: { stepId: output, ... }
 *   }
 *
 * Each step output is whatever the tool's run() returned. For file-
 * producing tools that's typically { type, url, ... } which we save to
 * the project's cloud storage. For agent_synth steps it's a JS object
 * that downstream steps interpolate into their inputs.
 *
 * @param plan {object}        — { deliverable, steps[] }
 * @param ctx  {object}        — { settings, project, proxy, hasStorage? }
 *                                hasStorage: whether a cloud storage provider
 *                                is connected. If omitted we resolve it once
 *                                via pickProvider(). When false, file outputs
 *                                are kept inline instead of being marked
 *                                save_failed (see the per-step handling below).
 * @param onStep {function}    — called with (stepId, status) for UI updates
 *                                status ∈ 'started' | 'done' | 'failed'
 */
export async function runBuild(plan, ctx, onStep = () => {}) {
  const { settings, project, proxy } = ctx
  // Resolve storage availability ONCE for the whole build. Previously every
  // saveToCloud() call re-ran pickProvider() (a Supabase round-trip per file);
  // more importantly, saveToCloud returns null for BOTH "no storage connected"
  // and "save errored", which the loop below could not tell apart — so a user
  // with no Drive/Dropbox saw every file step fail and lost the output. We now
  // distinguish the two: no storage → keep the output inline; storage present
  // but save failed → surface the failure as before.
  const hasStorage = ctx.hasStorage !== undefined ? ctx.hasStorage : !!(await pickProvider())
  // Brand context to feed the builder (agent_synth) so it writes ON-brand
  // instead of inventing the product. The dispatcher attaches the real brief to
  // plan.brandContext (project brief, or a brief pasted into the message for a
  // one-off build); fall back to the active project's brief defensively (e.g. a
  // Retry re-running a stored plan that predates this field).
  const brandContext = plan.brandContext || brandBriefFrom(project) || ''
  const stepOutputs = {}
  const files = []
  const errors = []
  const folderName = buildFolderName(plan.deliverable)
  // Captured from the first successful save — points the user at the
  // actual folder, not a file inside it.
  let folderLink = null
  let folderProvider = null

  // Virtual project for storage that nests under the active project.
  // If there's no active project, it nests directly under the root.
  const buildProject = project
    ? { ...project, name: `${project.name}/${folderName}` }
    : { id: null, name: folderName }

  // Most-recent image URL produced in this build. Threaded into later steps
  // as context.sourceImageUrl so image→video (Runway needs an input image) and
  // image→image-edit (removebg/clipdrop/topaz) chains actually work. Without
  // this, those tools never receive an image and fail (e.g. Runway 400s).
  let lastImageUrl = null

  let ordered
  try {
    ordered = topoSort(plan.steps || [])
  } catch (e) {
    return { deliverable: plan.deliverable, folderName, files: [], errors: [{ stepId: '_plan', tool: 'plan', code: 'plan_failed', error: e.message }], stepOutputs, folderLink: null }
  }

  // Steps whose output another step depends on. A TERMINAL agent_synth (one no
  // other step consumes) is a text deliverable with no generator after it —
  // e.g. "write me an IG caption". Its JSON output otherwise vanishes ("No
  // files produced yet") because it isn't a file/bundle/action type. We surface
  // it as a Markdown document so it's readable inline and downloadable.
  const consumedStepIds = new Set((plan.steps || []).flatMap(s => s.needs || []))

  // Build output organization. A step whose output ANOTHER step consumes is a
  // reusable COMPONENT (a frame, a voiceover, a backing track); a TERMINAL step
  // (nothing consumes it) is a finished DELIVERABLE. Deliverables save at the
  // build-folder root with a clear "FINAL — …" name; components go in a
  // components/ subfolder with readable names. The folder reads as a kit — the
  // finished product on top, every reusable piece preserved underneath, so you
  // can regenerate one part and reassemble without rebuilding everything.
  const componentsProject = buildProject ? { ...buildProject, name: `${buildProject.name}/components` } : buildProject
  const isComponent = (id) => consumedStepIds.has(id)
  const cleanName = (s) => String(s || '').replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').slice(0, 80).trim()
  const finalName = (label) => `FINAL — ${cleanName(label) || 'deliverable'}`
  let componentsFolderLink = null
  // Capture the build-ROOT folder link from a deliverable save; fall back to the
  // components subfolder only if a build produced components but no deliverable.
  const captureLink = (saved, component) => {
    if (!saved?.folderLink) return
    if (component) { if (!componentsFolderLink) componentsFolderLink = saved.folderLink }
    else if (!folderLink) { folderLink = saved.folderLink; folderProvider = saved.provider }
  }

  // Surface an agent_synth step's content as a readable + downloadable Markdown
  // deliverable (inline preview + .md). Used for a TERMINAL synth (no generator
  // after it) AND as a RESCUE when a synth's generator step failed — so
  // successful writing work is never thrown away. Idempotent per step.
  const surfaceSynth = async (step, output, note = '') => {
    if (!output || typeof output !== 'object') return
    if (files.some(f => f.stepId === step.id)) return
    const md = synthToMarkdown(output)
    if (!md) return
    const base = (step.label || plan.deliverable || 'output').replace(/[<>:"/\\|?*]/g, '').slice(0, 60).trim() || 'output'
    const doc = {
      type: 'document',
      tool: 'agent_synth',
      filename: `${base}.md`,
      url: `data:text/markdown;charset=utf-8,${encodeURIComponent(md)}`,
      text: md,
      prompt: step.label || 'Synthesized text',
    }
    let saved = null
    if (hasStorage) {
      const component = isComponent(step.id)
      saved = await saveToCloud(
        { ...doc, displayName: component ? cleanName(step.label || step.id) : finalName(step.label || plan.deliverable) },
        component ? componentsProject : buildProject,
      )
      captureLink(saved, component)
    }
    files.push({
      stepId: step.id,
      label: `${step.label || step.id}${note}`,
      output: doc,
      savedLink: saved?.webViewLink || null,
      savedProvider: saved?.provider || null,
      unsaved: !saved,
    })
  }

  for (const step of ordered) {
    // A dependency only BLOCKS this step if it failed to *produce* its output.
    // A 'save_failed' dep still generated its artifact (it lives inline in
    // stepOutputs) — only the cloud save failed — so downstream steps can and
    // should still run off the inline artifact. Without this, an expired/broken
    // Drive token cascades and kills the whole build, even though a no-storage
    // user's identical build completes fine. (Surfaced as the launch-build
    // "image save_failed → video dependency_failed → no deliverable" bug.)
    const depFailed = (step.needs || []).some(d => !stepOutputs[d])
    if (depFailed) {
      errors.push({ stepId: step.id, tool: step.tool, code: 'dependency_failed', error: 'dependency_failed' })
      onStep(step.id, 'failed', 'dependency_failed')
      continue
    }

    const tool = TOOLS_BY_ID[step.tool]
    if (!tool || typeof tool.run !== 'function') {
      errors.push({ stepId: step.id, tool: step.tool, code: 'unknown_tool', error: `unknown_tool:${step.tool}` })
      onStep(step.id, 'failed', 'unknown_tool')
      continue
    }

    onStep(step.id, 'started')

    try {
      const input = interpolate(step.input || step.prompt || '', stepOutputs)
      const key = readKey(settings, tool.keySource)
      // Prefer an image from this step's declared dependencies; else the most
      // recent image in the build. Lets a video/image-edit step animate or edit
      // the image an earlier step generated.
      const depImageUrl = (step.needs || [])
        .map(d => stepOutputs[d])
        .find(o => o?.type === 'image' && o.url)?.url
      const output = await tool.run({
        prompt: typeof input === 'string' ? input : JSON.stringify(input),
        structuredInput: input,
        key,
        settings,
        proxy,
        outputSchema: step.output_schema || null,
        label: step.label,
        brandContext,
        context: { sourceImageUrl: depImageUrl || lastImageUrl },
      })

      stepOutputs[step.id] = output
      if (output?.type === 'image' && output.url) lastImageUrl = output.url

      // File-bearing single output (image/audio/video/document) → save once
      if (output && (output.type === 'image' || output.type === 'audio' || output.type === 'video' || output.type === 'document')) {
        if (!hasStorage) {
          // No cloud storage connected. The generation succeeded, so keep the
          // output inline (it carries a data: URL) rather than failing the
          // step and throwing the result away. The build card surfaces these
          // as downloads and nudges the user to connect storage to persist.
          files.push({
            stepId: step.id,
            label: step.label || step.id,
            output,
            savedLink: null,
            savedProvider: null,
            unsaved: true,
          })
          // stepOutputs[step.id] already holds the raw output (set above), so
          // downstream steps interpolate the data: URL directly.
        } else {
          const component = isComponent(step.id)
          const saved = await saveToCloud({
            ...output,
            prompt: step.label || output.prompt || step.id,
            displayName: component ? cleanName(step.label || step.id) : finalName(step.label || plan.deliverable),
          }, component ? componentsProject : buildProject)

          // Silent save failure was a real bug — if the cloud save didn't
          // land (and storage IS connected), the step is NOT done. Mark it
          // failed with a clear reason so the user sees the issue instead of
          // a misleading checkmark.
          if (!saved) {
            errors.push({ stepId: step.id, tool: step.tool, code: 'save_failed', error: 'save_failed' })
            onStep(step.id, 'failed', 'save_failed')
            continue
          }

          files.push({
            stepId: step.id,
            label: step.label || step.id,
            output,
            savedLink: saved.webViewLink || null,
            savedProvider: saved.provider || null,
            component,
          })
          // First successful deliverable save tells us where the build folder
          // lives — capture for the folder link UI.
          captureLink(saved, component)
          // Merge savedLink back into the cached output so downstream steps
          // can reference {step.savedLink} in their interpolated input.
          stepOutputs[step.id] = { ...output, savedLink: saved.webViewLink, savedProvider: saved.provider }
        }
      }

      // Bundle outputs (per-slide narration, image series, etc.) — save each
      // child as its own file, all into the same build folder. The bundle
      // type ({audio,image,document}_bundle) tells us what to save each
      // child as; the rest of the loop is identical.
      const bundleType = output?.type?.endsWith('_bundle') ? output.type.replace('_bundle', '') : null
      if (bundleType && Array.isArray(output.files) && !hasStorage) {
        // No cloud storage — keep the whole bundle inline (each child carries
        // its own url). Surfaced as per-file downloads in the build card.
        files.push({
          stepId: step.id,
          label: `${step.label || step.id} (${output.files.length} files)`,
          output,
          savedLinks: output.files.map(() => null),
          savedProvider: null,
          unsaved: true,
        })
        // stepOutputs[step.id] already holds the raw bundle for downstream use.
      } else if (bundleType && Array.isArray(output.files)) {
        const savedLinks = []
        let anySaved = false
        // A bundle (per-slide frames, per-slide narration) is almost always a
        // reusable component feeding a later assembler (ad_render/pptxgen), so
        // it goes in components/. Each child keeps a clean, readable name.
        const component = isComponent(step.id)
        const target = component ? componentsProject : buildProject
        output.files.forEach((c, i) => { if (!c.error && !c.displayName) c.displayName = cleanName((c.filename || `${step.label || step.id}-${i + 1}`).replace(/\.[a-z0-9]+$/i, '')) })
        for (const child of output.files) {
          if (child.error) continue
          const saved = await saveToCloud({
            type: bundleType,
            url: child.url,
            filename: child.filename,
            displayName: child.displayName,
            tool: output.tool,
            prompt: `${step.label || step.id} — ${child.filename}`,
          }, target)
          if (saved) { anySaved = true; captureLink(saved, component) }
          savedLinks.push(saved?.webViewLink || null)
        }
        if (!anySaved) {
          errors.push({ stepId: step.id, tool: step.tool, code: 'save_failed', error: 'save_failed' })
          onStep(step.id, 'failed', 'save_failed')
          continue
        }
        files.push({
          stepId: step.id,
          label: `${step.label || step.id} (${output.files.length} files)`,
          output,
          savedLinks,
          savedProvider: 'multiple',
        })
        stepOutputs[step.id] = { ...output, savedLinks }
      }

      // Action outputs (email sent, calendar created, etc.) — log only, no file
      if (output && output.type === 'action') {
        files.push({
          stepId: step.id,
          label: step.label || step.id,
          output,
          savedLink: null,
          savedProvider: null,
        })
      }

      // Terminal agent_synth (nothing consumes it) → surface its text so the
      // build doesn't report "No files produced yet". A generator after it
      // would otherwise carry the content into the real deliverable.
      if (step.tool === 'agent_synth' && !consumedStepIds.has(step.id)) {
        await surfaceSynth(step, output)
      }

      onStep(step.id, 'done', null, output)
    } catch (e) {
      const reason = e instanceof ToolError ? e.message : String(e.message || e)
      const code = e instanceof ToolError ? (e.errorType || 'tool_error') : 'exception'
      errors.push({ stepId: step.id, tool: step.tool, code, error: reason })
      onStep(step.id, 'failed', reason)
    }
  }

  // CONTENT RESCUE — never throw away successful writing work. If an
  // agent_synth step succeeded but EVERY step that consumed it failed (e.g.
  // agent_synth wrote the deck copy, then pptxgen died), its content would
  // otherwise vanish — the user gets "the generator failed" and nothing else.
  // Surface that content as a Markdown fallback so they still walk away with
  // the words. Only fires when the content is genuinely orphaned (all direct
  // consumers failed) — a successful consumer means the content was delivered.
  for (const step of (plan.steps || [])) {
    if (step.tool !== 'agent_synth') continue
    const succeeded = stepOutputs[step.id] != null && !errors.some(e => e.stepId === step.id)
    if (!succeeded) continue
    if (files.some(f => f.stepId === step.id)) continue        // already surfaced (terminal)
    const consumers = (plan.steps || []).filter(s => (s.needs || []).includes(step.id))
    if (consumers.length === 0) continue                       // terminal handled in-loop
    if (consumers.every(c => errors.some(e => e.stepId === c.id))) {
      await surfaceSynth(step, stepOutputs[step.id], ' — content (the generator step failed)')
    }
  }

  // Persist a metadata.json into the build folder so users can see
  // what was generated and how (without needing to open every file).
  // Skipped when there's no storage — there's no folder to write it into.
  try {
    if (hasStorage) {
      const metadata = {
        deliverable: plan.deliverable,
        created_at: new Date().toISOString(),
        files: files.map(f => ({ stepId: f.stepId, label: f.label, link: f.savedLink })),
        errors,
      }
      await saveToCloud({
        type: 'document',
        url: 'data:application/json;base64,' + btoa(JSON.stringify(metadata, null, 2)),
        tool: 'build',
        prompt: 'metadata',
        filename: 'metadata.json',
      }, buildProject)
    }
  } catch {}

  return {
    deliverable: plan.deliverable,
    folderName,
    files,
    errors,
    stepOutputs,
    // Prefer the build-root link; if a build only produced components (e.g. its
    // assembler failed), fall back to the components folder so the parts are
    // still reachable.
    folderLink: folderLink || componentsFolderLink,
    folderProvider,
  }
}
