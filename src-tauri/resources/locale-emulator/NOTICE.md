# Locale Emulator (Bundled)

This directory ships **Locale Emulator v2.5.0.1** — the official portable binaries from the upstream release, embedded inside the gal-lib app so users don't need to install LE separately.

- Upstream project: https://github.com/xupefei/Locale-Emulator
- Release: https://github.com/xupefei/Locale-Emulator/releases/tag/v2.5.0.1
- License: **LGPL-3.0**

The files here are unmodified official binaries from the v2.5.0.1 distribution:

- `LEProc.exe` — command-line launcher
- `LECommonLibrary.dll` — shared managed assembly required by LEProc at runtime (referenced but **not** shipped in the portable ZIP; extracted verbatim from the official `LEInstaller.exe` payload — 17920 bytes, `PublicKeyToken=a5ce8326c28d7c91`)
- `LoaderDll.dll` — DLL injection bootstrap
- `LocaleEmulator.dll` — locale-API hook DLL
- `LEVersion.xml` — version metadata read by LEProc
- `Lang/` — UI translations (used by the GUI tools we don't ship; kept for completeness)

LE is LGPL-3.0; per the license terms, this NOTICE provides the source link and version info. The LE source tree is **not** modified by gal-lib — we invoke `LEProc.exe game.exe` as a separate process and let it do its own DLL injection. Users wishing to build LE from source should follow the upstream README.

The upstream repository was archived on 2022-04-15. v2.5.0.1 (2021-08-25) is the final release and continues to work on Windows 10 / 11.
