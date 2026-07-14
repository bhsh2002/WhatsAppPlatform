import axe from 'axe-core'

const OUTPUT_ID = 'axe-audit-result'

const publishResult = (result) => {
  let output = document.getElementById(OUTPUT_ID)
  if (!output) {
    output = document.createElement('output')
    output.id = OUTPUT_ID
    output.hidden = true
    document.body.append(output)
  }
  output.textContent = JSON.stringify(result)
}

const summarize = (results) => ({
  url: `${window.location.pathname}${window.location.search}`,
  violations: results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.length,
    targets: violation.nodes.slice(0, 10).map((node) => node.target),
  })),
  passes: results.passes.length,
  incomplete: results.incomplete.map((item) => ({
    id: item.id,
    impact: item.impact,
    help: item.help,
    nodes: item.nodes.length,
    targets: item.nodes.slice(0, 10).map((node) => node.target),
  })),
})

export const runAxeDevAudit = async () => {
  try {
    await new Promise((resolve) => window.setTimeout(resolve, 750))
    const results = await axe.run(document)
    const summary = summarize(results)
    publishResult(summary)
    return summary
  } catch (error) {
    const failure = {
      url: `${window.location.pathname}${window.location.search}`,
      error: error instanceof Error ? error.message : String(error),
    }
    publishResult(failure)
    throw error
  }
}

window.__runAxeAudit = runAxeDevAudit
