// Windows' own player and file dialog: $.audio.play has no player on Windows.
// Both run as `powershell -Command`, so they hold no double quote and no backslash.

// One process per session. It follows a control file and says where it is, a JSON line at a time.
export const PLAYER_SCRIPT: string = `
$ErrorActionPreference = 'Stop'
function Send($o) { [Console]::Out.WriteLine((ConvertTo-Json -InputObject $o -Compress)) }
try {
  Add-Type -AssemblyName PresentationCore, WindowsBase
  $p = New-Object System.Windows.Media.MediaPlayer
  $s = @{ file = ''; opened = 0; repeatOne = $false; seekId = 0; seen = ''; sent = ''; ticks = 0; bad = $true }
  $p.add_MediaFailed({ $s.bad = $true; Send @{ id = $s.opened; error = 'decode' } })
  $p.add_MediaEnded({
    $p.Position = [TimeSpan]::Zero
    if ($s.repeatOne) { $p.Play() } else { $p.Pause(); Send @{ id = $s.opened; ended = $true } }
  })
  $t = New-Object System.Windows.Threading.DispatcherTimer
  $t.Interval = [TimeSpan]::FromMilliseconds(120)
  $t.add_Tick({
    try {
      $s.ticks++
      if ($env:MA_PARENT -and ($s.ticks % 16) -eq 0 -and -not (Get-Process -Id $env:MA_PARENT -ErrorAction SilentlyContinue)) {
        $p.Close()
        [System.Windows.Threading.Dispatcher]::ExitAllFrames()
        return
      }
      $raw = [IO.File]::ReadAllText($env:MA_CTRL)
      if ($raw -ne $s.seen) {
        $c = ConvertFrom-Json $raw
        $s.seen = $raw
        if ($c.trackId -ne $s.opened) {
          $s.opened = $c.trackId
          $s.file = [string]$c.file
          $s.sent = ''
          $s.bad = $true
          $p.Close()
          if ($s.file) {
            if (Test-Path -LiteralPath $s.file) {
              $s.bad = $false
              $p.Open((New-Object System.Uri ([IO.Path]::GetFullPath($s.file))))
              $p.Pause()
            } else {
              Send @{ id = $s.opened; error = 'missing' }
            }
          }
        }
        $p.Volume = $c.volume / 100
        $s.repeatOne = [bool]$c.repeatOne
        if (-not $s.bad) {
          if ($c.seekId -ne $s.seekId) { $p.Position = [TimeSpan]::FromMilliseconds($c.seek) }
          if ($c.playing) { $p.Play() } else { $p.Pause() }
        }
        $s.seekId = $c.seekId
      }
      if ($s.bad) { return }
      $dur = 0
      if ($p.NaturalDuration.HasTimeSpan) { $dur = [int]$p.NaturalDuration.TimeSpan.TotalSeconds }
      $pos = [int][Math]::Floor($p.Position.TotalSeconds)
      $key = [string]$pos + ':' + [string]$dur
      if ($key -ne $s.sent) { $s.sent = $key; Send @{ id = $s.opened; pos = $pos; dur = $dur } }
    } catch {
      [Console]::Error.WriteLine($_.Exception.Message)
    }
  })
  $t.Start()
  [System.Windows.Threading.Dispatcher]::Run()
} catch {
  Send @{ fatal = [string]$_.Exception.Message }
  exit 1
}
`

// The invisible owner takes the hidden-window start flag and keeps the dialog on top.
// Paths come back URI-escaped, since a child's console encoding mangles Turkish letters.
export const PICKER_SCRIPT: string = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Opacity = 0
$owner.Show()
$owner.Activate()
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Title = 'Kedi: MP3'
$d.Filter = 'MP3 (*.mp3)|*.mp3'
$d.Multiselect = $true
if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
  foreach ($f in $d.FileNames) { [Console]::Out.WriteLine([Uri]::EscapeDataString($f)) }
}
$owner.Close()
`
