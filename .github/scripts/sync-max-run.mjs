import { readFile, writeFile } from 'node:fs/promises'

const endpoint = 'https://max.run/mcp'
const protocolVersion = '2025-11-25'
const readmePath = new URL('../../README.md', import.meta.url)
const startMarker = '<!-- max-run-content:start -->'
const endMarker = '<!-- max-run-content:end -->'
const sevenDays = 7 * 24 * 60 * 60 * 1_000

let requestId = 0

async function listContent(collection, spotlight) {
  const arguments_ = { collection, limit: 100 }
  if (spotlight !== undefined) arguments_.spotlight = spotlight

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': protocolVersion,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++requestId,
      method: 'tools/call',
      params: { name: 'list_content', arguments: arguments_ },
    }),
  })

  if (!response.ok) throw new Error(`MCP request failed with HTTP ${response.status}`)

  const message = await response.json()
  if (message.error) throw new Error(`MCP error: ${message.error.message}`)
  if (message.result?.isError) throw new Error(`MCP tool error: ${message.result.content?.[0]?.text ?? 'unknown error'}`)

  const documents = message.result?.structuredContent?.documents
  if (!Array.isArray(documents)) throw new Error('MCP response did not contain a document list')
  return documents
}

function activityTime(document) {
  const created = Date.parse(document.createdAt ?? '')
  const updated = Date.parse(document.updatedAt ?? '')
  return Math.max(Number.isNaN(created) ? 0 : created, Number.isNaN(updated) ? 0 : updated)
}

function recentKind(document) {
  const created = Date.parse(document.createdAt ?? 0)
  const updated = Date.parse(document.updatedAt ?? 0)
  return updated > created ? 'Updated' : 'New'
}

function entry(document, label) {
  const collection = document.collection === 'notes' ? 'note' : 'blog'
  const title = String(document.title).replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]')
  const url = new URL(document.url)
  if (url.origin !== 'https://max.run') throw new Error(`Unexpected document URL: ${document.url}`)
  return `- **${label} ${collection}** · [${title}](${url.href})`
}

const collections = ['blog', 'notes']
const results = await Promise.all(collections.flatMap((collection) => [
  listContent(collection, true),
  listContent(collection),
]))

const cutoff = Date.now() - sevenDays
const pinned = []
const recentCandidates = []

for (let index = 0; index < collections.length; index += 1) {
  pinned.push(...results[index * 2])
  recentCandidates.push(...results[index * 2 + 1])
}

const recent = recentCandidates
  .filter((document) => activityTime(document) >= cutoff)
  .sort((left, right) => activityTime(right) - activityTime(left))
  .slice(0, 3)

function uniqueEntries(documents, label) {
  const seen = new Set()
  return documents.flatMap((document) => {
    if (seen.has(document.url)) return []
    seen.add(document.url)
    return [entry(document, typeof label === 'function' ? label(document) : label)]
  })
}

const pinnedLines = uniqueEntries(pinned, 'Pinned')
const recentLines = uniqueEntries(recent, recentKind)

const section = [
  startMarker,
  '## From max.run',
  '',
  '_Updated nightly through the max.run MCP server._',
  ...(pinnedLines.length ? ['', '### Pinned', '', ...pinnedLines] : []),
  ...(recentLines.length ? ['', '### New or updated in the last 7 days', '', ...recentLines] : []),
  endMarker,
].join('\n')

const readme = await readFile(readmePath, 'utf8')
const start = readme.indexOf(startMarker)
const end = readme.indexOf(endMarker)
if (start === -1 || end === -1 || end < start) throw new Error('README sync markers are missing or invalid')

const nextReadme = `${readme.slice(0, start)}${section}${readme.slice(end + endMarker.length)}`
await writeFile(readmePath, nextReadme)
