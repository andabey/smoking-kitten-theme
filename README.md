# Kedi Tema

A theme mod for the Claude desktop app's Code tab: a sunset meadow with a kitten behind the
conversation, where only the smoke, the sun shafts from the left and the dust in the light
move, a warm veil so the words stay readable, the chat in an Old English blackletter, and a
music player above the message box. The player starts empty: **+ MP3** adds songs from your
computer, and the list and volume are kept between sessions. The player runs on Windows.

Commands: `/muzik` hides or shows the player, `/karartma 0-100` sets the veil behind the chat.

## The font

The chat is drawn in the app's **Code font**. To see the blackletter:

1. Install `font/DeathmatchTR.ttf` (right click → Install).
2. In Claude: Settings → Appearance → Code → Code font, type `Deathmatch TR`.
3. Close Claude fully and open it again.

Deathmatch is by KongFont, under CC BY-NC (nothing commercial). This copy adds the Turkish
letters it lacks; `font/LICENSE.txt` says what changed.

## Install

At the prompt of a terminal session:

```
/plugin install kedi-tema --marketplace andabey/smoking-kitten-theme
```

From a shell:

```
claude plugin install kedi-tema --marketplace andabey/smoking-kitten-theme
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with
`andabey/smoking-kitten-theme`, then Add plugin.

The repository is public, so anyone can install it with these lines; no GitHub sign-in is needed.

The backdrop is a vector redraw of a picture found online, and this repository holds no copy of
the picture itself.
