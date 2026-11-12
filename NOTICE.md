# Licensing notice

Supalens is licensed under the GNU Affero General Public License, version 3 only
(`AGPL-3.0-only`). The full text is in [LICENSE](./LICENSE).

## Additional permission under AGPL-3.0 section 7

Supalens runs its analysis agents through the Claude Agent SDK
(`@anthropic-ai/claude-agent-sdk` and its platform packages), which Anthropic PBC distributes
under its own terms and which is not free software. It is installed from the npm registry as a
dependency; no part of it is included in this repository.

As an additional permission under section 7 of the AGPL-3.0, the copyright holders of Supalens
give you permission to combine Supalens with the Claude Agent SDK and to convey the resulting
work. The Corresponding Source for such a combined work need not include the source code of the
Claude Agent SDK. This permission applies only to that SDK; in every other respect the
AGPL-3.0 governs the combined work, and your use of the SDK itself remains subject to
Anthropic's terms.

If you modify Supalens you may extend this permission to your version, but you are not obliged
to. If you do not wish to, delete this section from your version.

## Third-party material

- `assets/fonts/share/` — Noto Sans KR, Noto Sans JP and Noto Emoji, SIL Open Font License 1.1
  (licence files alongside the fonts).
- `.agents/skills/supabase-postgres-best-practices/` — from Supabase, MIT License.
- `selfhost/db/roles.sql`, `selfhost/db/jwt.sql` — from the Supabase self-hosting kit
  (`supabase/supabase`, `docker/volumes/db`), Apache License 2.0.
- Fonts are installed from npm, not stored here: Inter and IBM Plex Mono (fontsource packages)
  and Pretendard, all SIL Open Font License 1.1.
- Dependencies are installed from npm under their own licences; see each package.

## Names and logos

The licence covers the code. It does not grant rights to the Supalens name or logo — see
[TRADEMARK.md](./TRADEMARK.md).
