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
import { saveToCloud } from './cloudStorage'
import { supabase } from './supabase'

// Substitute {stepId} (and {stepId.field}) in a string with the resolved
// outputs of previously-completed steps. Whole-string substitutions can
// also resolve to objects/arrays — used when a downstream tool wants
// structured input rather than a stringified prompt.
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
    if (field) return out?.[field]
    return out
  }

  return template.replace(/\{([a-z0-9_]+)(?:\.([a-z0-9_]+))?\}/gi, (_, stepId, field) => {
    const out = stepOutputs[stepId]
    if (out == null) return ''
    const v = field ? out?.[field] : out
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

/**
 * Run a build plan. Returns:
 *   {
 *     deliverable,
 *     folderName,
 *     files: [{ stepId, label, output, savedLink, savedProvider }],
 *     errors: [{ stepId, error }],
 *     stepOutputs: { stepId: output, ... }
 *   }
 *
 * Each step output is whatever the tool's run() returned. For file-
 * producing tools that's typically { type, url, ... } which we save to
 * the project's cloud storage. For agent_synth steps it's a JS object
 * that downstream steps interpolate into their inputs.
 *
 * @param plan {object}        — { deliverable, steps[] }
 * @param ctx  {object}        — { settings, project, proxy }
 * @param onStep {function}    — called with (stepId, status) for UI updates
 *                                status ∈ 'started' | 'done' | 'failed'
 */
export async function runBuild(plan, ctx, onStep = () => {}) {
  const { settings, project, proxy } = ctx
  const stepOutputs = {}
  const files = []
  const errors = []
  const folderName = buildFolderName(plan.deliverable)

  // Virtual project for storage that nests under the active project.
  // If there's no active project, it nests directly under the root.
  const buildProject = project
    ? { ...project, name: `${project.name}/${folderName}` }
    : { id: null, name: folderName }

  let ordered
  try {
    ordered = topoSort(plan.steps || [])
  } catch (e) {
    return { deliverable: plan.deliverable, folderName, files: [], errors: [{ stepId: '_plan', error: e.message }], stepOutputs }
  }

  for (const step of ordered) {
    const depFailed = (step.needs || []).some(d => errors.some(e => e.stepId === d))
    if (depFailed) {
      errors.push({ stepId: step.id, error: 'dependency_failed' })
      onStep(step.id, 'failed', 'dependency_failed')
      continue
    }

    const tool = TOOLS_BY_ID[step.tool]
    if (!tool || typeof tool.run !== 'function') {
      errors.push({ stepId: step.id, error: `unknown_tool:${step.tool}` })
      onStep(step.id, 'failed', 'unknown_tool')
      continue
    }

    onStep(step.id, 'started')

    try {
      const input = interpolate(step.input || step.prompt || '', stepOutputs)
      const key = readKey(settings, tool.keySource)
      const output = await tool.run({
        prompt: typeof input === 'string' ? input : JSON.stringify(input),
        structuredInput: input,
        key,
        settings,
        proxy,
        outputSchema: step.output_schema || null,
        label: step.label,
      })

      stepOutputs[step.id] = output

      // If the output is a file-bearing artifact, save it into the build folder
      if (output && (output.type === 'image' || output.type === 'audio' || output.type === 'video' || output.type === 'document')) {
        const saved = await saveToCloud({
          ...output,
          prompt: step.label || output.prompt || step.id,
        }, buildProject)
        files.push({
          stepId: step.id,
          label: step.label || step.id,
          output,
          savedLink: saved?.webViewLink || null,
          savedProvider: saved?.provider || null,
        })
      }

      onStep(step.id, 'done', null, output)
    } catch (e) {
      const reason = e instanceof ToolError ? e.message : String(e.message || e)
      errors.push({ stepId: step.id, error: reason })
      onStep(step.id, 'failed', reason)
    }
  }

  // Persist a metadata.json into the build folder so users can see
  // what was generated and how (without needing to open every file)
  try {
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
  } catch {}

  return {
    deliverable: plan.deliverable,
    folderName,
    files,
    errors,
    stepOutputs,
  }
}
