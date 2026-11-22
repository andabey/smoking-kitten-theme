export type Track = { file: string; title: string }

export type Player = {
  tracks: Track[]
  index: number
  playing: boolean
  pos: number
  dur: number
  volume: number
  muted: boolean
  repeatOne: boolean
  picking: boolean
  listOpen: boolean
  hidden: boolean
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'kedi-tema': { player: Shaped<Player> }
  }
}
