import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeSetArgs } from 'claude-code'

import type { Player, Track } from '../types'
import { makeColors } from './make-colors.js'
import { PICKER_SCRIPT, PLAYER_SCRIPT } from './player-script'
import { SCENE } from './scene'

const SAVED = 'player'
const DIM = 'karartma'
const DEFAULT_DIM = 50

const { theme, problems } = makeColors({
  label: 'Kedi',
  only: 'dark',
  roles: { accent: '#ff9f45', danger: '#ff7b6e', success: '#7fd18b', warning: '#f2c14e', pro: '#b48cff' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#120b07',
        'surface-1': '#1a110b',
        'surface-2': '#22170f',
        'surface-3': '#251910',
        'text-primary': '#fffaf4',
        'text-secondary': '#f6eadf',
        'text-muted': '#f4e8dc',
      },
    },
  },
})

// `opacity` is the warm dark veil the app lays under the conversation column, so the words
// read over the bright meadow: 0 is none.
const ground = (dim: number) =>
  ({
    colors: theme,
    overrideColorScheme: 'dark',
    backdrop: { scene: 'kedi', glass: { blur: 0, tint: '#140a04', opacity: dim / 100 } },
  }) satisfies ThemeSetArgs

// `code` is the family that follows the app's Code font setting: set to Deathmatch TR, the
// font in this mod's font folder, the chat is drawn in it. The blackletter runs narrow and has
// one weight, so it is drawn larger and never made bolder.
const look = (dim: number): ThemeSetArgs => ({
  ...ground(dim),
  style: {
    Text: { fontFamily: ['code'], fontSize: 21, lineHeight: 32 },
    Heading: { fontFamily: ['code'] },
    ToolUse: { fontFamily: ['code'] },
  },
})

// The list starts empty: the person adds their own songs with + MP3.
const INITIAL: Player = {
  tracks: [],
  index: 0,
  playing: false,
  pos: 0,
  dur: 0,
  volume: 30,
  muted: false,
  repeatOne: false,
  picking: false,
  listOpen: false,
  hidden: false,
}
const player = atom({ plugin: 'kedi-tema', key: 'player' } as const, INITIAL, { shape: 'player-1' })

// These start over on a reload, as the child process does.
let running = false
let controlPath = ''
let seek = 0
let seekId = 0
let trackId = 0
let writes: Promise<void> = Promise.resolve()

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

// "15. Song (Soundtrack) - Artist.mp3" reads as "Song".
function titleOf(file: string): string {
  const name = (file.split(/[\\/]/).pop() ?? file).replace(/\.mp3$/i, '')
  const short = name
    .replace(/^\d{1,3}\.\s+/, '')
    .replace(/\s*\([^)]*\)\s+-\s+.*$/, '')
    .trim()

  return short || name
}

async function setLook($: EngineInterface, dim: number): Promise<void> {
  try {
    await $.theme.set(look(dim))
  } catch (error) {
    // A build that refuses `style` still takes the ground and colors.
    $.ui.log(String(error))
    await $.theme.set(ground(dim))
  }
}

function send($: EngineInterface): Promise<void> {
  writes = writes
    .then(async () => {
      const { tracks, index, playing, volume, muted, repeatOne } = await read($, player)
      const control = {
        file: tracks[index]?.file ?? '',
        trackId,
        playing,
        volume: muted ? 0 : volume,
        repeatOne,
        seek,
        seekId,
      }
      await $.fs.write(controlPath, JSON.stringify(control))
    })
    .catch(error => $.ui.log(`kedi-tema: ${String(error)}`))

  return writes
}

async function save($: EngineInterface): Promise<void> {
  const { tracks, index, volume, repeatOne, hidden } = await read($, player)
  await $.store.set(SAVED, { tracks, index, volume, repeatOne, hidden })
}

async function start($: EngineInterface): Promise<void> {
  if (running) return
  running = true
  seek = 0
  seekId = 0
  trackId += 1

  try {
    const env = await $.process.hookEnv()
    controlPath = `${env.CLAUDE_PLUGIN_DATA}/player-${env.CLAUDE_CODE_SESSION_ID}.json`
    await send($)

    const child = $.process.spawn({
      argv: ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-Command', PLAYER_SCRIPT],
      env: { MA_CTRL: controlPath, MA_PARENT: env.CLAUDE_PID ?? '' },
    })

    void (async () => {
      let buffer = ''
      let failure = 'Oynatıcı kapandı, ▶ ile yeniden başlar.'

      try {
        for await (const { stream, text } of child) {
          if (stream === 'stderr') {
            $.ui.log(`kedi-tema: ${text}`, { to: 'debug' })
            continue
          }
          buffer += text
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.trim().startsWith('{')) continue
            const said = JSON.parse(line) as {
              id?: number
              pos?: number
              dur?: number
              ended?: boolean
              error?: string
              fatal?: string
            }

            if (said.fatal !== undefined) failure = said.fatal
            // A line about a track that was already skipped says nothing about this one.
            if (said.id !== trackId) continue

            if (said.error !== undefined) {
              const error = said.error === 'missing' ? 'Dosya bulunamadı, taşınmış olabilir.' : 'Bu MP3 açılamadı.'
              await update($, player, now => ({ ...now, playing: false, error }))
            } else if (said.ended) {
              await step($, 1, true)
            } else if (said.pos !== undefined) {
              const { pos, dur = 0 } = said
              await update($, player, now => ({ ...now, pos, dur: dur || now.dur }))
            }
          }
        }
      } catch (error) {
        failure = String(error)
      }
      running = false
      await update($, player, now => ({ ...now, playing: false, error: failure }))
    })()
  } catch (error) {
    running = false
    await update($, player, now => ({ ...now, playing: false, error: String(error) }))
  }
}

async function change($: EngineInterface, edit: (now: Player) => Player): Promise<void> {
  await update($, player, edit)

  if (running) {
    await send($)
  } else {
    await update($, player, ({ error: _, ...now }): Player => now)
    await start($)
  }
}

async function select($: EngineInterface, index: number, playing?: boolean): Promise<void> {
  trackId += 1
  seek = 0
  await change($, ({ error: _, ...now }): Player => ({
    ...now,
    index,
    pos: 0,
    dur: 0,
    playing: playing ?? now.playing,
  }))
  await save($)
}

async function step($: EngineInterface, by: 1 | -1, playing?: boolean): Promise<void> {
  const { tracks, index } = await read($, player)
  if (tracks.length > 0) await select($, (index + by + tracks.length) % tracks.length, playing)
}

async function jump($: EngineInterface, to: (now: Player) => number): Promise<void> {
  const now = await read($, player)
  const pos = Math.max(0, Math.min(Math.max(0, now.dur - 1), to(now)))
  seek = pos * 1000
  seekId += 1
  await change($, old => ({ ...old, pos }))
}

// Like any player: back restarts the song, and early in the song goes to the one before.
async function previous($: EngineInterface): Promise<void> {
  const { pos, tracks } = await read($, player)
  if (pos > 3 || tracks.length < 2) await jump($, () => 0)
  else await step($, -1)
}

async function louder($: EngineInterface, by: number): Promise<void> {
  await change($, now => ({ ...now, muted: false, volume: Math.max(0, Math.min(100, now.volume + by)) }))
  await save($)
}

async function remove($: EngineInterface, at: number): Promise<void> {
  const { tracks, index } = await read($, player)
  const left = tracks.filter((_, i) => i !== at)

  if (at === index) {
    trackId += 1
    seek = 0
  }
  await change($, ({ error: _, ...now }): Player => ({
    ...now,
    tracks: left,
    index: Math.max(0, Math.min(left.length - 1, at < index ? index - 1 : index)),
    playing: left.length > 0 && now.playing,
    ...(at === index ? { pos: 0, dur: 0 } : {}),
  }))
  await save($)
}

async function pick($: EngineInterface): Promise<void> {
  if ((await read($, player)).picking) return
  await update($, player, now => ({ ...now, picking: true }))

  try {
    const { exitCode, stdout, stderr } = await $.process.run(
      ['powershell.exe', '-NoLogo', '-NoProfile', '-STA', '-Command', PICKER_SCRIPT],
      { timeoutMs: 600000 },
    )
    if (exitCode !== 0) throw new Error(stderr.trim() || 'Dosya penceresi açılamadı.')

    const before = await read($, player)
    const key = (file: string) => file.replaceAll('\\', '/').toLowerCase()
    const known = new Set(before.tracks.map(track => key(track.file)))
    const added = stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => line !== '')
      .map(line => decodeURIComponent(line))
      .filter(file => !known.has(key(file)))
      .map((file): Track => ({ file, title: titleOf(file) }))

    if (added.length > 0) {
      if (before.tracks.length === 0) trackId += 1
      await change($, now => ({ ...now, tracks: [...now.tracks, ...added] }))
      await save($)
    }
  } catch (error) {
    await update($, player, now => ({ ...now, error: String(error) }))
  }
  await update($, player, now => ({ ...now, picking: false }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))
    if (unpainted !== undefined) $.ui.log(unpainted)

    await setLook($, Number((await $.store.get(DIM)) ?? DEFAULT_DIM))
    await $.command.register({ name: 'muzik', description: 'Müzik şeridini gizle veya göster' })
    await $.command.register({ name: 'karartma', description: 'Sohbetin arkasını karart: 0 (hiç) ile 100 arası' })

    if (!running) {
      const saved = (await $.store.get(SAVED)) as Partial<Player> | undefined
      const tracks = saved?.tracks ?? INITIAL.tracks
      // A load starts no sound and no player: the first press starts it.
      await update($, player, () => ({
        ...INITIAL,
        tracks,
        index: Math.max(0, Math.min(tracks.length - 1, saved?.index ?? 0)),
        volume: saved?.volume ?? INITIAL.volume,
        repeatOne: saved?.repeatOne ?? INITIAL.repeatOne,
        hidden: saved?.hidden ?? INITIAL.hidden,
      }))
    }

    return next(e)
  })

  on('command.run', { command: 'muzik' }, async $ => {
    const hidden = !(await read($, player)).hidden
    await update($, player, now => ({ ...now, hidden }))
    await save($)

    return { text: hidden ? 'Müzik şeridi gizlendi. /muzik geri getirir.' : 'Müzik şeridi yazı kutusunun üstünde.' }
  })

  on('command.run', { command: 'karartma' }, async ($, e) => {
    const typed = e.args.trim()
    const dim = Number(typed)

    if (typed === '' || !Number.isInteger(dim) || dim < 0 || dim > 100) {
      return { text: 'Kullanım: /karartma 0 ile 100 arası bir sayı. 0 hiç karartmaz.' }
    }
    await $.store.set(DIM, dim)
    await setLook($, dim)

    return { text: `Karartma %${dim} oldu.` }
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'mobile') return next(e)
    if (e.props.scene !== 'kedi' || e.props.plugin !== 'kedi-tema') return next(e)

    const { Svg } = $.ui.resolve(e)

    return <Svg source={SCENE} alt="Gün batımında çayırda oturan, ağzındaki sigaradan duman yükselen turuncu kedi" isInteractive />
  })

  // The player lives in the chat itself, above the message box. It opens no pane.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.hasSurvey) return next(e)

    const now = await read($, player)
    if (now.hidden) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const track = now.tracks[now.index]
    const heard = now.muted ? 0 : now.volume

    return (
      <Box flexDirection="column" gap={1} paddingX={1} backgroundColor="#140a04">
        <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1}>
          <Button key="previous" label="⏮" onPress={() => previous($)} />
          <Button
            key="play"
            variant="primary"
            label={now.playing ? '⏸' : '▶'}
            onPress={() => change($, old => ({ ...old, playing: old.tracks.length > 0 && !old.playing }))}
          />
          <Button key="next" label="⏭" onPress={() => step($, 1)} />
          <Text color="#ffb15c" weight="semibold">
            {cut(track?.title ?? 'Liste boş: + MP3', 18)}
          </Text>
          <Text tabular color="#f6eadf">{`${clock(now.pos)}/${clock(now.dur)}`}</Text>
          <Button key="quieter" label="−" onPress={() => louder($, -5)} />
          <Button
            key="mute"
            label={`${heard === 0 ? '🔇' : '🔊'} %${heard}`}
            onPress={() => change($, old => ({ ...old, muted: !old.muted }))}
          />
          <Button key="louder" label="+" onPress={() => louder($, 5)} />
          <Button
            key="add"
            label={now.picking ? 'Seçiliyor…' : '+ MP3'}
            onPress={() => {
              // The dialog waits on the person, longer than a press may take.
              void pick($)
            }}
          />
          <Button
            key="list"
            label={now.listOpen ? '▾ Liste' : `▴ Liste ${now.tracks.length}`}
            onPress={() => update($, player, old => ({ ...old, listOpen: !old.listOpen }))}
          />
        </Box>
        {now.listOpen && (
          <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1}>
            <Button key="back" label="−10 sn" onPress={() => jump($, old => old.pos - 10)} />
            <Button key="forward" label="+10 sn" onPress={() => jump($, old => old.pos + 10)} />
            <Button
              key="repeat"
              label={now.repeatOne ? 'Tekrar: bu şarkı' : 'Tekrar: tüm liste'}
              onPress={async () => {
                await change($, old => ({ ...old, repeatOne: !old.repeatOne }))
                await save($)
              }}
            />
          </Box>
        )}
        {now.listOpen &&
          now.tracks.map((one, i) => (
            <Box flexDirection="row" alignItems="center" columnGap={1}>
              <Button
                key={`track-${i}`}
                plain
                dimColor={i !== now.index}
                label={`${i === now.index ? '♪ ' : ''}${i + 1}. ${cut(one.title, 48)}`}
                onPress={() => select($, i, true)}
              />
              <Button key={`remove-${i}`} plain dimColor label="✕" onPress={() => remove($, i)} />
            </Box>
          ))}
        {now.error !== undefined && <Text color="error">{now.error}</Text>}
      </Box>
    )
  })
}
