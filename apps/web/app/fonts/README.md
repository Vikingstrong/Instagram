# Local application fonts

Geist, Geist Mono and Grand Hotel are unchanged upstream font binaries distributed
under the SIL Open Font License 1.1. Each family directory includes its upstream
`OFL.txt`; preserve these notices when redistributing the files.

Source: [google/fonts](https://github.com/google/fonts/tree/45e3d5269e4a17d823f6d84470bc084dc5ae46f6),
commit `45e3d5269e4a17d823f6d84470bc084dc5ae46f6`. Downloads were made once during development;
`pnpm dev` and `pnpm build` do not contact Google Fonts. Runtime files are served
from the same application origin through `next/font/local`.

| Local binary | Upstream path (under `ofl/`) | SHA-256 |
| --- | --- | --- |
| `geist/Geist-Variable.ttf` | `geist/Geist[wght].ttf` | `73894e0448cae90a92b6c2f8732b7bb9acb7b94c418bff559dad4a18e1de9659` |
| `geistmono/GeistMono-Variable.ttf` | `geistmono/GeistMono[wght].ttf` | `d00e590b8eb3a59acc329b2d044fd143ae935090b7da33199ebee27cc7de8196` |
| `grandhotel/GrandHotel-Regular.ttf` | `grandhotel/GrandHotel-Regular.ttf` | `ec7ae65d49c936cb5ed32534ab74dbd40c56733de5145ac3aae9da362e02b50f` |

The variable faces retain weights 100–900; Grand Hotel uses weight 400. Existing
CSS variables and `display: swap` are preserved. These are full upstream TTFs
(about 397 KiB total), rather than Google's Latin web subsets. Review font size,
licensing and browser rendering when updating; do not silently substitute a
system font or modify/subset a binary without checking license requirements.

To update, choose an explicit upstream commit, replace the font and license files,
update the paths/hashes here, then run the standard build and the Playwright font
check on desktop/mobile. No package, build-time download or TLS bypass is needed.
