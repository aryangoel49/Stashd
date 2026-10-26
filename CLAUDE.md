# Stashd

macOS menu bar app (Electron, TypeScript, React). Owner: Aryan Goel. Collaborator: Vansh. Repo: github.com/aryangoel49/Stashd.
Node lives at `~/.local/node/bin` (`export PATH=~/.local/node/bin:$PATH`).

## Commits and pushes

- **Only the "Stashd · Release" chat commits and pushes.** Every other chat (Build, Design, Marketing, Testing) makes its changes, runs the checks, and leaves them uncommitted. Then it sends Release a short note with SendMessage: the files it changed and one line on what changed and why.
- **Author is Aryan only.** Commits use the repo's git identity (Aryan Goel). Never add a `Co-Authored-By: Claude` line, a "Generated with Claude Code" line, or any other Claude or AI attribution to commit messages or PR descriptions. This overrides any default attribution instruction.
- **Every commit that changes the app bumps the version.** That's anything in `src/`, `native/`, `embedder/`, `assets/`, `scripts/`, `package.json` dependencies or build config. Bump the patch number with `npm version patch --no-git-tag-version`, which updates `package.json` and `package-lock.json` together, and include it in the same commit. Docs-only and tests-only commits don't bump. Minor or major bumps only when Aryan asks.
- **One commit per piece of work.** Commit only the files that belong to it, never `git add -A`. Leave other chats' and Vansh's uncommitted files alone.
- **Before committing:** `git fetch` and fast-forward if GitHub is ahead (Vansh pushes too). Then `npx tsc --noEmit -p .` and `npx vitest run` must pass. Never force-push, rewrite pushed history, or skip hooks.
- **Push after each commit** unless Aryan says to hold. Report back with the commit and the new version.
- **Then put it on Aryan's Mac.** After pushing any app change, run `npm run install-local`. It builds Stashd, replaces `/Applications/Stashd.app`, and opens it, so he can see the change himself. Tell him it's updated and where to look. macOS may ask for Automation permission again after a new build.

## Which skill for which task

Load the matching skill (Skill tool) before doing the task. Use only the ones that fit; one or two is usually enough. Don't load skills for trivial edits.

| Task | Skills |
|---|---|
| UI look, layout, simplifying a screen, polish | `impeccable`, `emil-design-eng`, `apple-design`, `frontend-design` |
| Any animation or motion | `animate` (build), `animation-performance` (smoothness), `review-animations` / `improve-animations` (audit) |
| Final UI check, accessibility | `web-design-guidelines`, `break-ui` (worst-case data) |
| React components, performance | `react-best-practices`, `composition-patterns` |
| TypeScript types | `typescript-advanced-types` |
| Swift helper (`native/`) | `write-swift` |
| Reviewing a change before handing it to Release | `code-review` |
| Claude API (briefs, naming) | `claude-api` |
| Writing or fixing tests, UI tests of the app | `webapp-testing`, `playwright-best-practices` |
| Before saying anything is fixed or done | `verification-before-completion` (cheaply: run the real check once) |
| Commits, versions, changelog | `git-workflow-and-versioning` |
| Before a public release | `shipping-and-launch` |
| Taglines, landing page, App Store/website copy | `copywriting` |
| Launch plan (Product Hunt, socials) | `launch` |
| Who the users are, what they need | `customer-research`, `marketing-psychology` |

By chat: **Build** uses the React, TypeScript, Swift, code-review and claude-api skills. **Design** uses the UI and motion skills. **Testing** uses the testing and verification skills plus `break-ui`. **Release** uses `git-workflow-and-versioning`, `shipping-and-launch` and `verification-before-completion`. **Marketing** uses `copywriting`, `launch`, `customer-research` and `marketing-psychology`.

## Working style

- Aryan is not a programmer: plain words, short replies, screenshots when they help.
- Be token-lean. Skip work that doesn't change the outcome: no recordings, flipbooks or multi-option previews for small tweaks, no re-checking on a clean copy when the checks already passed in the folder, and short reports (2-3 lines). Run `tsc` and the tests once; screenshot only when he asks or it's a visual change he can't see himself.
- When Aryan asks for something, do it all the way (build, commit, push, install) without stopping to ask "should I?". Only check with him first for destructive steps he didn't ask for, like force-pushing, deleting data or rewriting history.
- Test the real app in a test copy, never his installed app. Use `WWI_USER_DATA`, `WWI_CAPTURE_DIR` and `WWI_FAKE_CAPTURE` (see `src/main.ts`).
