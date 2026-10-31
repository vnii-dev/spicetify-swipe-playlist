# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-10-31

First public release.

### Added

- **Swipe screen**: listen to each song and press ✓ add, ✕ skip or ? "Maybe". Supports several destination playlists, **Undo**, and saving/resuming an unfinished session.
- **Ways to load songs**: a pasted list (`Song - Artist`), a `.txt` or `.csv` file, a public playlist link, or your Liked Songs.
- **Discover**: reads a playlist's name and description (bio), searches for matching songs, and lets you choose how many to review. Approved songs can go to the same playlist or to another one.
- **Duplicate protection**: a warning and a confirmation before adding a song that is already in the playlist; songs repeated inside the same list are skipped.
- **Create a new playlist** from the app and use it as a destination.
- **Clean playlist**: keep, remove or move each song of an existing playlist.
- **Duplicates finder** for one or all playlists, with a button to remove a single duplicate or all of them.
- **Tools**: export a playlist to text, find unavailable songs, sort a playlist into a new one (title, artist, album, date added or random), find where a song is across all playlists, and back up / restore playlists to a `.json` file.
- **Queue button** (optional) to send the current song to the playback queue.
- **Diagnostics tab** with a write test, to help with bug reports.
- **Languages**: English, Português (Brasil) and Español, with an **Automatic** option that follows Spotify's language and then the system's.
- **Cancel button** for long operations (searches, scans, backups).
- Colors that follow the active Spicetify theme.

### Notes

- Playlists are read and edited through the Spotify client's internal APIs first, with the Web API as a fallback, because the Web API changed in February 2026 and can return rate-limit (429) errors. Every write is verified before it is trusted.

[Unreleased]: https://github.com/vnii-dev/spicetify-swipe-playlist/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/vnii-dev/spicetify-swipe-playlist/releases/tag/v1.0.0
