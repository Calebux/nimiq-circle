'use client'

import { useState } from 'react'

/** Copy with the async API, then the old textarea trick; webviews often block the first. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    area.setSelectionRange(0, text.length)
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {}
    area.remove()
    return ok
  }
}

export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  // Set when copying is blocked outright: the text is then shown to long-press and copy by hand.
  const [manual, setManual] = useState<string | null>(null)
  async function copy(key: string, text: string) {
    if (await copyText(text)) {
      setManual(null)
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600)
    } else setManual(text)
  }
  /** System share sheet when there is one; otherwise copy the text and link together. */
  async function share(key: string, input: { title: string; text: string; url: string }) {
    if (navigator.share) {
      try {
        await navigator.share(input)
        return
      } catch {
        // Dismissed share sheet: fall through to copying.
      }
    }
    await copy(key, `${input.text}\n${input.url}`)
  }
  return { copied, manual, copy, share }
}

/** Shown when the webview blocks copying: press and hold to copy by hand. */
export function ManualCopy({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <section className="rounded-card bg-sun-soft p-4 text-sm text-sun-ink shadow-soft">
      <p className="font-semibold">Copying is blocked here. Press and hold to copy this:</p>
      <textarea readOnly value={text} rows={4} onFocus={(e) => e.currentTarget.select()} className="mt-2 w-full resize-none rounded-[var(--radius-inner)] bg-white p-3 text-ink outline-none" />
    </section>
  )
}
