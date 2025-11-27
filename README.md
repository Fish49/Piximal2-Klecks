
Kleki: 🖌️ [Demo](https://kleki.com/) | ❓ [About](https://kleki.com/about/) | 📝 [Dev Blog](https://blog.kleki.com/)
Piximal2-Klecks: 🖌️ [Demo](https://paishofish49.net) | ❓ About (see spec.md) | 📝 No Dev Blog

<p style="text-align:center">
<img src="https://bitbof.com/stuff/2022-01-klecks/2022-03-klecks-github.png" alt="Klecks"><br>
</p>

Klecks (German for "splash of color", pronounced "clex") is the official open-source release of the community-funded online painting app [Kleki](https://kleki.com).

Klecks can run in standalone mode (e.g. on [kleki.com](https://kleki.com)), or embed (e.g. on [2draw.net](https://2draw.net)) for drawing communities.

Piximal2-Klecks is a fork of Klecks by PaiShoFish49 to host his esolang: Piximal2

## Features
- Layers
- Pen-support with pressure and stabilizer
- Touch gestures
- Brushes: pen, blend, sketchy, pixel, chemy, smudge, eraser
- Tools: selection, paint bucket, text, shapes, gradient
- WebGL-powered filters: blur, tilt-shift, curves, distort, noise.
- Lineart extraction
- Editing tools: transform, crop/expand, resize, perspective
- Supports all major form factors: desktop, tablet and phone
- Multi-language (10+ languages)
- Piximal2

---

Created by developer/artist [bitbof](https://bitbof.com)
Forked and modified by developer/artist [PaiShoFish49](https://github.com/Fish49)

---

# Commands
- initialize via `npm ci` (requires node and npm to be installed already)
- `npm run lang:build` - generate language files necessary to run Klecks
- `npm run lang:build -- --missing` - generate language files and list all keys with a missing translation.
- `npm run start` - dev server (to run it locally)
- `npm run build` - build standalone into `/dist/`
- `npm run build:embed` - build of embed into `/dist/`
- `npm run build:help` - build help page (when clicking the question mark) into `/dist/`

# Embed
Example usage of the embed can be found under: `/examples/embed/`

# Docker
To run Klecks (standalone) within a Docker container, run the following commands in project root:

`docker-compose build`

`docker-compose up -d`

It is then accessible through: http://localhost:5050

# Contributing

How you can contribute to this project:
- Bug reporting (detailed bug reports that are reproducible)
- Contribute to a translation (see below)
- Donate to this project (Klecks, Kleki) [Donate](https://kleki.com/donate/)

# Translations
Are you a native speaker or have advanced skills in a language? Any contribution by you is highly encouraged and appreciated!

### Where are translation files?
Translations are located in `src/languages` where each translation is its own JSON5 file, e.g. `de.json5` for German.
Within such a file everything except `value` is to be kept in sync with `_base-en.json5`.

### Structure of a translation file
```json5
{
  // key by which this text is referenced in code
  stabilizer: {
    
    // A hint, further explaining the text
    hint: 'Common feature in drawing software to make lines smoother',
    
    // Original text (English)
    original: 'Stabilizer',
    
    // Translated text
    value: '抖动修正'
  },
  // ...
}
```

### Creating/editing a translation
To **create a new translation** run `npm run lang:add <code>`, which creates `src/languages/<code>.json5`. You find all
(ISO 639-1) language codes in `src/languages/languages.json`. The generated file will already include everything except `value`.
To **edit an existing translation**, simply edit one of the files in `src/languages`. If a language file is out of sync with
`src/languages/_base-en.json5` (English), whatever key is out of sync will be ignored and fall back on English. English is the
source of truth. A translation cannot add new keys without them also being present in `_base-en.json5`.

To **see your changes** in Klecks, run `npm run lang:build`. It needs to be run whenever changes to `src/languages` are
made or it won't be up-to-date. Then build or start Klecks.

A translation should try not to cause additional line-breaks in the UI if possible. Test to make sure translations
fit the context of the application. Note, some texts are only visible in the standalone-version and vice versa with
the embed-version.

### List of commands
- `npm run lang:add <code>` - creates new language file `src/languages/<code>.json5`.
  - See (ISO 639-1) language codes in `src/languages/languages.json`
- `npm run lang:sync <code>` - synchronizes with base file. (TODO)
- `npm run lang:build` - generates JSON & TS files in `src/app/languages`
  - Problems are printed to the command line output

# Help fund this project
Klecks and Kleki are community funded. [Donate today](https://kleki.com/donate/).
Piximal2-Klecks is a passion project and is not funded.

# License

bitbof © 2025 - Released under the MIT License. Icons by bitbof are public domain (excluding the Klecks logo, bitbof logo).
While Kleki and Klecks are jointly developed, Kleki's license is separate from Klecks. Kleki must be licensed from bitbof.

Piximal2: PaiShoFish49 © 2025 - MIT License.

# Piximal 2

Klecks is a beautiful and open source project, and I (PaiShoFish49) have taken it and brutely tacked on Piximal 2. Piximal 2 is the successor of Piximal 1. Piximal (both 1 and 2) are programming languages written in color as opposed to words. I have been using Kleki nearly every day for several years, so I jumped at the opportunity to use its source code for my own project. Piximal 2 on Klecks uses the MIT license as well so dive into my ugly code if you dare. Maybe I'll work on this project more in the future, maybe I'll implement Piximal 1 or make the P2 tab more beautiful or add more features or something. There are a lot of bugs, especially related to the fact that running Piximal 2 programs doesn't use Klecks' history system. Maybe I'll fix that someday. to learn more about Piximal 2, you can refer to `spec.md`.

Disclaimer: Piximal 2 is my passion project. I really hope you like it, and definitely feel free to give feedback or make suggestions or anything like that, but at the end of the day, I do have other things begging for my attention. Do not be surprised when my code is buggy or unreadable or downright gross (Though like I said, feel free to leave feedback, or edit the code! I am happy to accept contributions!).