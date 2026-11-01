# Bundled website fonts

The website ships Outfit (weights 100–900) and Cormorant Garamond (weights
500–700) as local WOFF2 assets. Next.js resolves the relative URLs in
`fonts.css` and emits the files with the website's static assets. Building
and viewing the website requires no requests to Google Fonts.

This replaces `next/font/google`, whose Next.js 15 loader downloads and
parses Google's current font URLs during each clean build. That dependency
caused the Ubuntu deployment to fail with `Cannot read properties of null
(reading '1')` in the Google font loader.

All seven files are unmodified font binaries from Google's official font
CDN. They retain the previous Latin, Latin Extended, Cyrillic, Cyrillic
Extended and Vietnamese coverage where provided by the family. Outfit is
provided in Latin and Latin Extended. `sources.json` records the original
URLs, byte sizes and SHA-256 hashes. The Cormorant files contain a 300–700
variable axis; the stylesheet registers the previous 500–700 display range.

Both families are distributed under the SIL Open Font License 1.1. The
complete upstream notices are included in `OFL-outfit.txt` and
`OFL-cormorant-garamond.txt`. The source repository revision for the licenses
is recorded in `sources.json`.

When updating fonts, preserve these notices, verify the files and hashes,
and test a clean production build without a Google font response mock.
