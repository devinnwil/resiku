import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'motion/react'

const SONGS = [
  {
    id: 1,
    title: 'Over My Dead Body',
    artist: 'Drake',
    album: 'Take Care',
    duration: 272,
    cover: 'https://upload.wikimedia.org/wikipedia/en/a/ae/Drake_-_Take_Care_cover.jpg',
    audio: '/audio/over-my-dead-body.mp3',
    lyrics: [
      { time: 20, text: "How I'm feeling, it doesn't matter" },
      { time: 25, text: "'Cause you know I'm okay" },
      { time: 30, text: 'Instead, I ask myself, "Why do you worry?"' },
      { time: 36, text: "When you know, you know I'm the same" },
      { time: 41, text: "I know, I know you don't love me, baby" },
      { time: 46, text: "They're trying to take you away from me" },
    ],
  },
  {
    id: 2,
    title: 'Rottweiler',
    artist: 'EsDeeKid',
    album: 'Rebel',
    duration: 96,
    cover: 'https://upload.wikimedia.org/wikipedia/en/c/c4/EsDeeKid_-_Rebel.jpg',
    audio: '/audio/rottweiler.mp3',
    lyrics: [
      { time: 12, text: "Yo, ay" },
      { time: 13, text: "Too much snow kid, coming like Canada" },
      { time: 16, text: "Got kush smoke all in me lungs" },
      { time: 17, text: "I'm running from plod, but I'm lacking the stamina" },
      { time: 19, text: "I'm whipping it smart, the NOS in me head" },
      { time: 21, text: "Got me gone, I can't fuck with the canister" },
    ],
  },
  {
    id: 3,
    title: 'Father Stretch My Hands Pt. 1',
    artist: 'Kanye West',
    album: 'The Life of Pablo',
    duration: 136,
    cover: 'https://upload.wikimedia.org/wikipedia/en/4/4d/The_life_of_pablo_alternate.jpg',
    audio: '/audio/father-stretch-my-hands.mp3',
    lyrics: [
      { time: 1,  text: "You're the only power" },
      { time: 4,  text: "You're the only power" },
      { time: 9,  text: "You're the only power" },
      { time: 14, text: "You're the only power" },
      { time: 17, text: "Fa (Fa), fa (fa), fa (fa)" },
      { time: 29, text: "Father..." },
    ],
  },
  {
    id: 4,
    title: 'ILoveUIHateU',
    artist: 'Playboi Carti',
    album: 'Whole Lotta Red',
    duration: 135,
    cover: 'https://upload.wikimedia.org/wikipedia/en/6/6c/Playboi_Carti_-_Whole_Lotta_Red.png',
    audio: '/audio/iloveuihateu.mp3',
    lyrics: [
      { time: 6,  text: "Yeah" },
      { time: 8,  text: "What?" },
      { time: 10, text: "Yo, Pi'erre, you wanna come out here?" },
      { time: 15, text: "What? What?" },
      { time: 19, text: "What? What?" },
      { time: 25, text: "Yeah" },
    ],
  },
  {
    id: 5,
    title: 'Orange Soda',
    artist: 'Baby Keem',
    album: 'Die for My Bitch',
    duration: 129,
    cover: 'https://upload.wikimedia.org/wikipedia/en/2/20/Die_for_My_Bitch.jpg',
    audio: '/audio/orange-soda.mp3',
    lyrics: [
      { time: 0,  text: "Bitch, sit on my face, I attack that" },
      { time: 3,  text: "Choose up, lil' junt, I'm finna pack him" },
      { time: 6,  text: "When it comes to my bitch, I'm straight active" },
      { time: 8,  text: "Dirtball in the coupe smokin' cat piss" },
      { time: 11, text: "Lil' bitch, shut the fuck up" },
      { time: 14, text: "Tell your best friend, shut the fuck up, ayy" },
    ],
  },
]

function formatTime(secs) {
  if (!secs || isNaN(secs)) return '0:00'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function parseLrc(lrc) {
  const lines = []
  for (const raw of lrc.split('\n')) {
    const m = raw.match(/\[(\d+):(\d+(?:\.\d+)?)\](.+)/)
    if (!m) continue
    const text = m[3].trim()
    if (text) lines.push({ time: parseInt(m[1]) * 60 + parseFloat(m[2]), text })
  }
  return lines
}

const ART_FULL = 125
const ART_MINI = 74
const SPRING = { type: 'spring', stiffness: 300, damping: 20 }
const LYRICS_HEIGHT = 324 // ~12 lines × 27px per line
const LINE_HEIGHT = 27
const LYRIC_TRANSITION = { duration: 0.4, ease: 'easeOut' }

export default function App() {
  const [trackIndex, setTrackIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [fetchedLyrics, setFetchedLyrics] = useState({})

  const audioRef = useRef(null)
  const progressBarRef = useRef(null)
  const coverRef = useRef(null)
  const lyricsScrollRef = useRef(null)
  const inFlightRef = useRef(new Set())

  // ── 3-D tilt via motion values (no re-renders on mouse move) ──
  const rawTiltX = useMotionValue(0)
  const rawTiltY = useMotionValue(0)
  const tiltX = useSpring(rawTiltX, { stiffness: 300, damping: 30 })
  const tiltY = useSpring(rawTiltY, { stiffness: 300, damping: 30 })
  const shineBackground = useTransform(
    [tiltX, tiltY],
    ([rx, ry]) =>
      `radial-gradient(circle at ${50 + ry * 4}% ${50 - rx * 4}%, rgba(255,255,255,0.22) 0%, transparent 55%)`
  )

  const song = SONGS[trackIndex]
  const hasPrev = trackIndex > 0

  // Resolved lyrics: LRCLIB fetch result, or fallback to hardcoded
  const lyrics = fetchedLyrics[song.id] ?? song.lyrics

  const activeLyricIndex = lyrics.findIndex((line, idx) => {
    const nextLine = lyrics[idx + 1]
    return currentTime >= line.time && (!nextLine || currentTime < nextLine.time)
  })

  // Collapsed panel: 4-line window anchored to the active lyric
  const windowStart = activeLyricIndex >= 0 ? activeLyricIndex : 0
  const collapsedLyrics = lyrics.slice(windowStart, windowStart + 4)

  // ── LRCLIB fetch ──
  useEffect(() => {
    const { id, artist, title, album } = song
    if (inFlightRef.current.has(id)) return
    inFlightRef.current.add(id)
    const a = encodeURIComponent(artist.split(',')[0].trim())
    const t = encodeURIComponent(title)
    const al = encodeURIComponent(album)
    fetch(`https://lrclib.net/api/get?artist_name=${a}&track_name=${t}&album_name=${al}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        const parsed = data.syncedLyrics ? parseLrc(data.syncedLyrics) : song.lyrics
        setFetchedLyrics(prev => ({ ...prev, [id]: parsed.length ? parsed : song.lyrics }))
      })
      .catch(() => setFetchedLyrics(prev => ({ ...prev, [id]: song.lyrics })))
  }, [song.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.src = song.audio
    audio.load()
    setCurrentTime(0)
    setDuration(0)
  }, [trackIndex, song.audio])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) audio.play().catch(() => setIsPlaying(false))
    else audio.pause()
  }, [isPlaying, trackIndex])

  const handleTimeUpdate = useCallback(() => {
    if (!isDragging && audioRef.current) {
      console.log('[sync] timeupdate:', audioRef.current.currentTime.toFixed(2)) // Debug: remove after verification
      setCurrentTime(audioRef.current.currentTime)
    }
  }, [isDragging])

  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current) setDuration(audioRef.current.duration)
  }, [])

  const handleEnded = useCallback(() => {
    setTrackIndex((i) => (i + 1) % SONGS.length)
  }, [])

  const seekTo = useCallback((clientX) => {
    const bar = progressBarRef.current
    if (!bar) return
    const rect = bar.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const t = ratio * (duration || 0)
    setCurrentTime(t)
    if (audioRef.current) audioRef.current.currentTime = t
  }, [duration])

  const handleProgressMouseDown = useCallback((e) => {
    e.preventDefault()
    setIsDragging(true)
    seekTo(e.clientX)
  }, [seekTo])

  useEffect(() => {
    if (!isDragging) return
    const onMove = (e) => seekTo(e.clientX)
    const onUp = () => setIsDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isDragging, seekTo])

  // Scroll popup to keep active line visible using real DOM scroll
  useEffect(() => {
    if (!lyricsOpen) return
    const container = lyricsScrollRef.current
    if (!container || activeLyricIndex < 0) return
    let top
    if (activeLyricIndex < 3) {
      top = 0
    } else if (activeLyricIndex > lyrics.length - 3) {
      top = container.scrollHeight - container.clientHeight
    } else {
      top = activeLyricIndex * LINE_HEIGHT - LYRICS_HEIGHT / 2 + LINE_HEIGHT / 2
    }
    container.scrollTo({ top, behavior: 'smooth' })
  }, [activeLyricIndex, lyricsOpen, lyrics.length])

  // Debug — Step 1: log popup state on open and on every active-line change
  useEffect(() => {
    if (!lyricsOpen) return
    console.log('POPUP RENDER - activeLyricIndex:', activeLyricIndex, '| currentTime:', currentTime.toFixed(2), '| song:', song.title)
    lyrics.forEach((line, i) => {
      const dist = activeLyricIndex >= 0 ? Math.abs(i - activeLyricIndex) : 2
      const op = dist === 0 ? 1 : Math.max(0.15, 1 - dist * 0.25)
      console.log(`  line ${i}: "${line.text.substring(0, 25)}" time=${line.time}s dist=${dist} opacity=${op.toFixed(2)}`)
    })
  }, [lyricsOpen, activeLyricIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debug — sync: log every active-line change
  useEffect(() => {
    console.log('[sync] activeLyricIndex:', activeLyricIndex, '→', lyrics[activeLyricIndex]?.text, '| currentTime:', currentTime.toFixed(1), 's')
  }, [activeLyricIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  const seekToTime = useCallback((t) => {
    setCurrentTime(t)
    if (audioRef.current) audioRef.current.currentTime = t
  }, [])

  // ── Cover tilt handlers ──
  const handleCoverMouseMove = useCallback((e) => {
    const el = coverRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    rawTiltY.set(((e.clientX - rect.left) / rect.width - 0.5) * 12)
    rawTiltX.set(-((e.clientY - rect.top) / rect.height - 0.5) * 12)
  }, [rawTiltX, rawTiltY])

  const handleCoverMouseLeave = useCallback(() => {
    rawTiltX.set(0)
    rawTiltY.set(0)
  }, [rawTiltX, rawTiltY])

  const progress = duration > 0 ? currentTime / duration : 0
  const prevFill = hasPrev ? '#323544' : '#A3A3A3'
  const artSize = lyricsOpen ? ART_MINI : ART_FULL

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#E8E8E6',
      padding: '40px 20px',
      fontFamily: 'system-ui, sans-serif',
      WebkitFontSmoothing: 'antialiased',
      MozOsxFontSmoothing: 'grayscale',
    }}>
      <audio
        ref={audioRef}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
      />

      <motion.div layout transition={SPRING} style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>

        {/* ─── Player card ─── */}
        <motion.div layout transition={SPRING} style={{
          backgroundColor: '#FEFEFE',
          borderRadius: '15px',
          outline: '1px solid rgba(0,0,0,0.05)',
          padding: '20px 24px',
          width: '544px',
          boxSizing: 'border-box',
        }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="#242323" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
              <span style={{ color: '#242323', fontSize: '16px', fontWeight: 600, lineHeight: '20px' }}>
                The Rotation
              </span>
            </div>
            <span style={{
              backgroundColor: 'rgba(244,244,244,1)',
              borderRadius: '9999px',
              outline: '1px solid rgba(0,0,0,0.032)',
              padding: '1px 8px',
              fontSize: '10px',
              lineHeight: '1',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#BDB7B6',
            }}>
              {trackIndex + 1}/{SONGS.length}
            </span>
          </div>

          {/* ── Main row ── */}
          <div style={{
            display: 'flex',
            gap: '14px',
            alignItems: lyricsOpen ? 'center' : 'stretch',
            marginBottom: '16px',
          }}>

            {/* Album art with 3D tilt */}
            <motion.div
              ref={coverRef}
              onMouseMove={handleCoverMouseMove}
              onMouseLeave={handleCoverMouseLeave}
              animate={{ width: artSize, height: artSize }}
              transition={SPRING}
              style={{
                flexShrink: 0,
                borderRadius: '16px',
                overflow: 'hidden',
                outline: '1px solid rgba(83,83,83,0.05)',
                position: 'relative',
                rotateX: tiltX,
                rotateY: tiltY,
                transformPerspective: 600,
                cursor: 'pointer',
              }}
            >
              <motion.img
                key={song.id}
                src={song.cover}
                alt={song.album}
                initial={{ opacity: 0, scale: 1.06 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              {/* Moving shine overlay */}
              <motion.div
                style={{
                  position: 'absolute', inset: 0,
                  background: shineBackground,
                  pointerEvents: 'none',
                }}
              />
            </motion.div>

            {/* Right column */}
            <div style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              ...(lyricsOpen ? {} : { height: `${ART_FULL}px` }),
            }}>

              {/* Title / artist / controls */}
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '27px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={song.title}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      transition={{ duration: 0.2 }}
                      style={{
                        color: '#242323', fontSize: '16px', fontWeight: 600,
                        lineHeight: '20px', whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis',
                      }}
                    >
                      {song.title}
                    </motion.div>
                  </AnimatePresence>
                  <div style={{
                    color: '#908C8C', fontSize: '12px', lineHeight: '16px',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {song.artist}
                  </div>
                </div>

                {/* Transport controls */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '15px',
                  padding: '7px 12px', flexShrink: 0,
                }}>
                  <motion.button
                    onClick={() => hasPrev && setTrackIndex((i) => i - 1)}
                    whileTap={hasPrev ? { scale: 0.82 } : {}}
                    style={{ ...btnReset, cursor: hasPrev ? 'pointer' : 'default' }}
                  >
                    <svg width="17" height="17" viewBox="0 0 25 24" fill="none"
                      style={{ transform: 'rotate(180deg)' }}>
                      <path d="M18.335 3.75C18.75 3.75 19.085 4.086 19.085 4.5V19.5C19.085 19.914 18.75 20.25 18.335 20.25C17.921 20.25 17.585 19.914 17.585 19.5V14.162L9.432 19.726C7.939 20.746 5.914 19.676 5.914 17.868V6.132C5.914 4.324 7.939 3.254 9.432 4.273L17.585 9.838V4.5C17.585 4.086 17.921 3.75 18.335 3.75Z"
                        fill={prevFill} />
                    </svg>
                  </motion.button>

                  <motion.button
                    onClick={() => setIsPlaying((p) => !p)}
                    whileTap={{ scale: 0.85 }}
                    style={{ ...btnReset, width: '26px', height: '24px', justifyContent: 'center' }}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      {isPlaying ? (
                        <motion.svg key="pause" width="26" height="24" viewBox="0 0 25 24" fill="none"
                          initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.14 }}>
                          <path d="M7 3.25C5.757 3.25 4.75 4.257 4.75 5.5V18.5C4.75 19.743 5.757 20.75 7 20.75H8.75C9.993 20.75 11 19.743 11 18.5V5.5C11 4.257 9.993 3.25 8.75 3.25H7Z" fill="#323544" />
                          <path d="M16.25 3.25C15.007 3.25 14 4.257 14 5.5V18.5C14 19.743 15.007 20.75 16.25 20.75H18C19.243 20.75 20.25 19.743 20.25 18.5V5.5C20.25 4.257 19.243 3.25 18 3.25H16.25Z" fill="#323544" />
                        </motion.svg>
                      ) : (
                        <motion.svg key="play" width="26" height="24" viewBox="0 0 25 24" fill="none"
                          initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.14 }}>
                          <path d="M5.914 6.132C5.914 4.324 7.939 3.254 9.432 4.273L20.086 11.141C21.419 12.041 21.419 13.959 20.086 14.859L9.432 21.727C7.939 22.746 5.914 21.676 5.914 19.868V6.132Z" fill="#323544" />
                        </motion.svg>
                      )}
                    </AnimatePresence>
                  </motion.button>

                  <motion.button
                    onClick={() => setTrackIndex((i) => (i + 1) % SONGS.length)}
                    whileTap={{ scale: 0.82 }}
                    style={btnReset}
                  >
                    <svg width="17" height="17" viewBox="0 0 25 24" fill="none">
                      <path d="M18.335 3.75C18.75 3.75 19.085 4.086 19.085 4.5V19.5C19.085 19.914 18.75 20.25 18.335 20.25C17.921 20.25 17.585 19.914 17.585 19.5V14.162L9.432 19.726C7.939 20.746 5.914 19.676 5.914 17.868V6.132C5.914 4.324 7.939 3.254 9.432 4.273L17.585 9.838V4.5C17.585 4.086 17.921 3.75 18.335 3.75Z"
                        fill="#323544" />
                    </svg>
                  </motion.button>
                </div>
              </div>

              {/* ── 4-row collapsed lyrics ── */}
              <AnimatePresence>
                {!lyricsOpen && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    style={{
                      flex: 1,
                      backgroundColor: 'rgba(255,255,255,0.4)',
                      borderRadius: '6px',
                      outline: '1px solid rgba(0,0,0,0.03)',
                      padding: '8px 36px 8px 10px',
                      position: 'relative',
                      overflow: 'hidden',
                      minHeight: 0,
                    }}
                  >
                    <motion.button
                      onClick={() => setLyricsOpen(true)}
                      whileTap={{ scale: 0.88 }}
                      style={{
                        position: 'absolute', top: '7px', right: '7px',
                        background: 'rgba(255,255,255,0.25)', border: 'none',
                        borderRadius: '4px', outline: '1px solid rgba(0,0,0,0.05)',
                        width: '24px', height: '24px', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', padding: 0,
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                        stroke="#323544" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15 3h6v6" /><path d="m21 3-7 7" />
                        <path d="m3 21 7-7" /><path d="M9 21H3v-6" />
                      </svg>
                    </motion.button>

                    <AnimatePresence initial={false}>
                      {collapsedLyrics.map((line, displayIdx) => {
                        const lyricIdx = windowStart + displayIdx
                        const isActive = displayIdx === 0
                        return (
                          <motion.p
                            key={`${song.id}-${lyricIdx}`}
                            initial={{ opacity: 0 }}
                            animate={{
                              opacity: [1, 0.75, 0.55, 0.4][displayIdx] ?? 0.4,
                              color: isActive ? '#242323' : '#9C9C9C',
                            }}
                            exit={{ opacity: 0 }}
                            transition={LYRIC_TRANSITION}
                            onClick={() => seekToTime(line.time)}
                            style={{
                              margin: '0 0 3px 0',
                              fontSize: '12px',
                              lineHeight: '16px',
                              fontWeight: isActive ? 600 : 400,
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {line.text}
                          </motion.p>
                        )
                      })}
                    </AnimatePresence>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* ── Progress bar ── */}
          <div>
            <div
              ref={progressBarRef}
              onMouseDown={handleProgressMouseDown}
              style={{
                position: 'relative', height: '18px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', userSelect: 'none',
              }}
            >
              <div style={{
                position: 'absolute', left: 0, right: 0, height: '4px',
                borderRadius: '9999px', backgroundColor: '#EBEBEB',
              }} />
              <div style={{
                position: 'absolute', left: 0, height: '4px',
                borderRadius: '9999px', backgroundColor: '#2C2C2C',
                width: `${progress * 100}%`,
              }} />
              {/* Thumb — hover-aware */}
              <motion.div
                animate={{ scale: isDragging ? 1.3 : 1 }}
                transition={{ duration: 0.12 }}
                style={{
                  position: 'absolute', width: '10px', height: '10px',
                  borderRadius: '9999px', backgroundColor: '#2C2C2C',
                  left: `calc(${progress * 100}% - 5px)`,
                  top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1px' }}>
              <span style={{ color: '#908C8C', fontSize: '10px', lineHeight: '12px' }}>
                {formatTime(currentTime)}
              </span>
              <span style={{ color: '#908C8C', fontSize: '10px', lineHeight: '12px' }}>
                {formatTime(duration || song.duration)}
              </span>
            </div>
          </div>
        </motion.div>

        {/* ─── Lyrics modal ─── */}
        <AnimatePresence mode="popLayout">
          {lyricsOpen && (
            <motion.div
              initial={{ x: 20, opacity: 0, scale: 0.96 }}
              animate={{ x: 0, opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, x: 20 }}
              transition={SPRING}
              style={{
                backgroundColor: '#FEFEFE',
                borderRadius: '15px',
                outline: '1px solid rgba(0,0,0,0.05)',
                padding: '25px',
                width: '430px',
                boxSizing: 'border-box',
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              {/* Modal header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ color: '#242323', fontSize: '16px', fontWeight: 600, lineHeight: '20px' }}>
                    {song.title}
                  </div>
                  <div style={{ color: '#908C8C', fontSize: '12px', lineHeight: '16px' }}>
                    Lyrics
                  </div>
                </div>
                <motion.button
                  onClick={() => setLyricsOpen(false)}
                  whileTap={{ scale: 0.85 }}
                  style={{
                    background: 'rgba(0,0,0,0.05)', border: 'none', borderRadius: '50%',
                    width: '24px', height: '24px', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', cursor: 'pointer', padding: 0, flexShrink: 0,
                    marginTop: '2px',
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                    stroke="#5C5C5C" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M1 1l8 8M9 1L1 9" />
                  </svg>
                </motion.button>
              </div>

              {/* Scrollable lyrics — real DOM scroll */}
              <div
                ref={lyricsScrollRef}
                className="no-scrollbar"
                style={{ overflowY: 'scroll', height: `${LYRICS_HEIGHT}px` }}
              >
                {lyrics.map((line, i) => {
                  const isActive = i === activeLyricIndex
                  // distance=2 when nothing active yet: all lines appear faded (opacity ~0.5)
                  // instead of distance=0 which would make everything fully lit
                  const distance = activeLyricIndex >= 0 ? Math.abs(i - activeLyricIndex) : 2
                  const lineOpacity = distance === 0 ? 1 : Math.max(0.15, 1 - distance * 0.25)
                  const lineScale = distance === 0 ? 1 : Math.max(0.92, 1 - distance * 0.02)
                  const lineFilter = distance === 0 ? 'blur(0px)' : `blur(${Math.min(distance * 0.5, 2)}px)`
                  return (
                    <motion.div
                      key={`modal-${song.id}-${i}`}
                      onClick={() => seekToTime(line.time)}
                      animate={{ opacity: lineOpacity, scale: lineScale, filter: lineFilter }}
                      transition={LYRIC_TRANSITION}
                      style={{ cursor: 'pointer', transformOrigin: 'left center', height: `${LINE_HEIGHT}px`, display: 'flex', alignItems: 'center' }}
                    >
                      <motion.p
                        animate={{ color: isActive ? '#242323' : '#8A8A8A' }}
                        transition={{ duration: 0.3 }}
                        style={{
                          margin: 0,
                          fontSize: '12px',
                          lineHeight: '1.4',
                          fontWeight: isActive ? 600 : 400,
                        }}
                      >
                        {line.text}
                      </motion.p>
                    </motion.div>
                  )
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </motion.div>
    </div>
  )
}

const btnReset = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
  display: 'flex',
  alignItems: 'center',
}
