import { useEffect, useRef } from 'react'
import { mountMusicBreaks } from './musicBreaks'
import './music.css'

const PRO_PROFILE = {
  key: 'pmb.pro.cfg',
  defaults: { focusUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }
}

export function MusicMode({ pro }: { pro: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const cleanup = mountMusicBreaks(el, pro ? PRO_PROFILE : {})
    return () => {
      cleanup()
      el.innerHTML = ''
    }
  }, [pro])
  return <div ref={ref} />
}
