# Self-hosted CV fonts

Subset variable WOFF2 files used by `templates/index.html`. No third-party font CDNs.

| File | Family | Source | License |
|---|---|---|---|
| `plus-jakarta-sans.woff2` | Plus Jakarta Sans | [tokotype/PlusJakartaSans](https://github.com/tokotype/PlusJakartaSans) | SIL OFL 1.1 |
| `inter.woff2` | Inter | [rsms/inter](https://github.com/rsms/inter) | SIL OFL 1.1 |
| `jetbrains-mono.woff2` | JetBrains Mono | [JetBrains/JetBrainsMono](https://github.com/JetBrains/JetBrainsMono) | SIL OFL 1.1 |

Subsets cover Latin, Latin Extended, and Cyrillic (U+0000–024F, U+0400–04FF) plus dashes, euro, and arrows used in the CV. The original OFL text is in `OFL.txt`.

Production URLs (R2 via the existing `/media/:filename` contract):

- `/media/cv-font-plus-jakarta-sans.woff2`
- `/media/cv-font-inter.woff2`
- `/media/cv-font-jetbrains-mono.woff2`
