// Run server TypeScript with Node's test runner, without another test dependency.
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) specifier = new URL(`../src/${specifier.slice(2)}`, import.meta.url).href
  if (specifier.startsWith('.') || specifier.startsWith('file:')) {
    const url = new URL(specifier, context.parentURL)
    if (!/\.[a-z]+$/i.test(url.pathname) && existsSync(fileURLToPath(`${url.href}.ts`))) specifier = `${url.href}.ts`
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (new URL(url).pathname.endsWith('.ts') && !url.includes('/node_modules/')) {
    const source = await readFile(new URL(url), 'utf8')
    return { format: 'module', shortCircuit: true, source: ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText }
  }
  return nextLoad(url, context)
}
