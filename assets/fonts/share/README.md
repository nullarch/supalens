# Local share-image fonts

Unmodified Noto Sans KR and JP regional subset OTFs, regular and bold, from
[Noto Sans CJK 2.004](https://github.com/notofonts/noto-cjk/tree/523d033d6cb47f4a80c58a35753646f5c3608a78/Sans/SubsetOTF).
The upstream [OFL 1.1 license](LICENSE) is included. Copyright metadata remains
embedded in the original font binaries. These are licensed font assets, not
customer-specific subsets. A monochrome Noto Emoji font from
[v2.034](https://github.com/googlefonts/noto-emoji/tree/9a5261d871451f9b5183c93483cbd68ed916b1e9/fonts)
and its [license](EMOJI-LICENSE) provide a local symbol fallback. Total font size:
19,069,072 bytes. Some newer emoji are unavailable and composite sequences can
render as separate constituent symbols; no universal emoji coverage is claimed.

The app keeps Inter/CJK system fallbacks. The standalone image renderer uses
embedded Noto sans-serif so Latin, Korean and Japanese do not depend on system
fonts or network access. Locale selects the preferred regional Han forms;
the other region remains a fallback. This is not universal Unicode/emoji coverage.

Maintenance: `node scripts/fetch-share-fonts.mjs` downloads only fixed paths from
the pinned commit and refuses to overwrite different existing bytes. It is not
part of install, build or image handling. No query/answer text is passed to it.

SHA-256:

```
69975a0ac8472717870aefeab0a4d52739308d90856b9955313b2ad5e0148d68  NotoSansKR-Regular.otf
5a6ceb287ed2fc6cfc6213144ebea68cbd94b20fc9eb873d8486493bf02d9bda  NotoSansKR-Bold.otf
dff723ba59d57d136764a04b9b2d03205544f7cd785a711442d6d2d085ac5073  NotoSansJP-Regular.otf
1b0edfb500b73a4fa8a4fcaae1bbbd403994e08e73e3e0da37e70d3853f42c5f  NotoSansJP-Bold.otf
6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2  LICENSE
415dc6290378574135b64c808dc640c1df7531973290c4970c51fdeb849cb0c5  NotoEmoji-Regular.ttf
6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2  EMOJI-LICENSE
```

Runtime uses [Satori with embedded fonts](https://github.com/vercel/satori#fonts)
and [Resvg rasterization](https://github.com/thx/resvg-js), with system fonts disabled.
There is no remote image or additional-asset loader. Next's bundled `next/og`
fallback loader was not retained: supplying fonts to that wrapper alone does not
disable its dynamic Google Fonts / emoji fallback requests.

`satori` is pinned; its `fflate` dependency is narrowly overridden to 0.7.5,
the patched release for [GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98).
The renderer does not process uploaded archives. This is not a security audit
of the wider application's existing dependency tree.
