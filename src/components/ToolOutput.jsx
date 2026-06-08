import { useState, useRef } from 'react'
import { downloadFile } from '../utils/downloadFile'

export default function ToolOutput({ output }) {
  if (!output) return null
  if (output.type === 'image') return <ImageOutput output={output} />
  if (output.type === 'search') return <SearchOutput output={output} />
  if (output.type === 'audio') return <AudioOutput output={output} />
  if (output.type === 'video') return <VideoOutput output={output} />
  if (output.type === 'webapp') return <WebappOutput output={output} />
  return null
}

// Playable inline preview of a self-contained HTML app/game. Uses srcdoc (the
// raw html survives a reload even though blob/data urls are stripped), sandboxed
// to allow scripts. "Open full screen" pops it large for real play-testing.
function WebappOutput({ output }) {
  const [full, setFull] = useState(false)
  if (!output.html && !output.url) return null
  const frame = (style) => (
    <iframe
      title={output.title || 'app'}
      srcDoc={output.html || undefined}
      src={output.html ? undefined : output.url}
      sandbox="allow-scripts allow-pointer-lock allow-modals allow-popups allow-same-origin"
      style={style}
    />
  )
  return (
    <div style={{ marginTop: 8 }}>
      {output.label && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace', marginBottom: 6, letterSpacing: '0.05em' }}>{output.label}</div>}
      {frame({ width: '100%', maxWidth: 480, height: 540, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, background: '#fff', display: 'block' })}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button onClick={() => setFull(true)} style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace', padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', cursor: 'pointer' }}>▶ Play full screen</button>
        {output.url && <a href={output.url} download={output.filename} target="_blank" rel="noreferrer" onClick={e => { e.preventDefault(); downloadFile(output.url, output.filename) }} style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace', textDecoration: 'none', padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)' }}>⬇ Download .html</a>}
        <DriveBadge url={output.driveUrl}/>
      </div>
      {full && (
        <div onClick={() => setFull(false)} style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 900, height: '90vh', position: 'relative' }}>
            <button onClick={() => setFull(false)} style={{ position: 'absolute', top: -34, right: 0, fontSize: 13, color: '#fff', background: 'transparent', border: 'none', cursor: 'pointer' }}>✕ Close</button>
            {frame({ width: '100%', height: '100%', border: 'none', borderRadius: 12, background: '#fff' })}
          </div>
        </div>
      )}
    </div>
  )
}

function VideoOutput({ output }) {
  return (
    <div style={{ marginTop:8 }}>
      {output.label && <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', fontFamily:'monospace', marginBottom:6, letterSpacing:'0.05em' }}>{output.label}</div>}
      <video controls src={output.url} style={{ width:'100%', maxWidth:480, borderRadius:12, border:'1px solid rgba(255,255,255,0.1)', display:'block' }}/>
      <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
        <a href={output.url} download target="_blank" rel="noreferrer" onClick={e => { e.preventDefault(); downloadFile(output.url, output.filename) }} style={{ fontSize:11, color:'rgba(255,255,255,0.5)', fontFamily:'monospace', textDecoration:'none', padding:'4px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.04)' }}>⬇ Download</a>
        <DriveBadge url={output.driveUrl}/>
      </div>
    </div>
  )
}

function DriveBadge({ url }) {
  if (!url) return null
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{ fontSize:11, color:'#74C69D', fontFamily:'monospace', textDecoration:'none', padding:'4px 10px', borderRadius:8, border:'1px solid rgba(116,198,157,0.3)', background:'rgba(116,198,157,0.08)' }}>✓ Saved to Drive</a>
  )
}

function ImageOutput({ output }) {
  const [loaded, setLoaded] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  return (
    <div style={{ marginTop:8 }}>
      {output.label && <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', fontFamily:'monospace', marginBottom:6, letterSpacing:'0.05em' }}>{output.label}</div>}
      {!loaded && (
        <div style={{ height:160, background:'rgba(255,255,255,0.04)', borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center', border:'1px solid rgba(255,255,255,0.08)' }}>
          <span style={{ fontSize:12, color:'rgba(255,255,255,0.3)', fontFamily:'monospace' }}>Loading image...</span>
        </div>
      )}
      <div style={{ display: loaded ? 'block' : 'none' }}>
        <img
          src={output.url} alt={output.prompt}
          onLoad={() => setLoaded(true)}
          onClick={() => setZoomed(true)}
          style={{ width:'100%', maxWidth:480, borderRadius:12, border:'1px solid rgba(255,255,255,0.1)', cursor:'zoom-in', display:'block' }}
        />
        <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
          <a href={output.url} download target="_blank" rel="noreferrer" onClick={e => { e.preventDefault(); downloadFile(output.url, output.filename) }} style={{ fontSize:11, color:'rgba(255,255,255,0.5)', fontFamily:'monospace', textDecoration:'none', padding:'4px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.04)' }}>⬇ Download</a>
          <button onClick={() => setZoomed(true)} style={{ fontSize:11, color:'rgba(255,255,255,0.5)', fontFamily:'monospace', padding:'4px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.04)', cursor:'pointer' }}>⤢ Expand</button>
          <DriveBadge url={output.driveUrl}/>
        </div>
      </div>
      {zoomed && (
        <div onClick={() => setZoomed(false)} style={{ position:'fixed', inset:0, zIndex:500, background:'rgba(0,0,0,0.92)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'zoom-out', padding:20 }}>
          <img src={output.url} alt={output.prompt} style={{ maxWidth:'90vw', maxHeight:'90vh', borderRadius:12, objectFit:'contain' }}/>
        </div>
      )}
    </div>
  )
}

function AudioOutput({ output }) {
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef(null)
  const toggle = () => {
    if (!audioRef.current || !output.url) return
    if (playing) { audioRef.current.pause(); setPlaying(false) }
    else { audioRef.current.play(); setPlaying(true) }
  }
  return (
    <div style={{ marginTop:8 }}>
      {output.label && <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', fontFamily:'monospace', marginBottom:6, letterSpacing:'0.05em' }}>{output.label}</div>}
      <div style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:12, padding:'12px 14px', maxWidth:340 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <button onClick={toggle} style={{ width:36, height:36, borderRadius:'50%', background:'#6366f1', border:'none', color:'white', fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{playing ? '⏸' : '▶'}</button>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:12, color:'rgba(255,255,255,0.7)', fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{output.title || 'Generated Audio'}</div>
          </div>
        </div>
        {output.url && <audio ref={audioRef} src={output.url} onEnded={() => setPlaying(false)} style={{ display:'none' }}/>}
      </div>
      <div style={{ display:'flex', gap:8, marginTop:8 }}>
        <a href={output.url} download target="_blank" rel="noreferrer" onClick={e => { e.preventDefault(); downloadFile(output.url, output.filename) }} style={{ fontSize:11, color:'rgba(255,255,255,0.5)', fontFamily:'monospace', textDecoration:'none', padding:'4px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.04)' }}>⬇ Download</a>
        <DriveBadge url={output.driveUrl}/>
      </div>
    </div>
  )
}

function SearchOutput({ output }) {
  return (
    <div style={{ marginTop:8, background:'rgba(99,102,241,0.06)', border:'1px solid rgba(99,102,241,0.2)', borderRadius:12, padding:'14px 16px', maxWidth:480 }}>
      <div style={{ fontSize:10, color:'#7EB8F7', fontFamily:'monospace', marginBottom:8, letterSpacing:'0.07em' }}>🔍 {(output.tool || 'SEARCH').toUpperCase()} RESULTS</div>
      <div style={{ fontSize:13, color:'rgba(255,255,255,0.8)', lineHeight:1.65, marginBottom: output.citations?.length ? 10 : 0 }}>{output.text}</div>
      {output.citations?.length > 0 && (
        <div style={{ borderTop:'1px solid rgba(255,255,255,0.08)', paddingTop:8 }}>
          <div style={{ fontSize:10, color:'rgba(255,255,255,0.25)', fontFamily:'monospace', marginBottom:6 }}>SOURCES</div>
          {output.citations.map((c, i) => (
            <a key={i} href={c.url} target="_blank" rel="noreferrer" style={{ display:'block', fontSize:11, color:'#6366f1', fontFamily:'monospace', marginBottom:4, textDecoration:'none', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>↗ {c.title || c.url}</a>
          ))}
        </div>
      )}
    </div>
  )
}
