import { tokenize } from '../lib/follow'

// Script with already-read words highlighted and an optional pace marker (word index).
export function ScriptText({ text, read = 0, pacer }: { text: string; read?: number; pacer?: number }) {
  let n = 0
  return (
    <p className="rs-script rs-script--big">
      {text.split(/(\s+)/).map((chunk, i) => {
        if (!chunk.trim()) return chunk
        const index = n
        n += tokenize(chunk).length
        const cls = [index < read ? 'rs-word--read' : '', pacer !== undefined && index === Math.floor(pacer) ? 'rs-word--pace' : ''].join(' ').trim()
        return cls ? <span key={i} className={cls}>{chunk}</span> : chunk
      })}
    </p>
  )
}
