## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## How it was tested

<!-- Commands you ran, or what you clicked through. -->

## Checklist

- [ ] `npx tsc --noEmit -p .`, `npm test` and `npm run lint` pass
- [ ] `node scripts/check-public-tree.mjs` passes
- [ ] New UI text is in `messages/en.json`, `ko.json` and `ja.json`
- [ ] Hosted-only behaviour is gated on `isCloud()`; nothing new requires an outside service to self-host
- [ ] A new invariant (security, limits, cleanup) comes with a test
- [ ] Commits are signed off (`git commit -s`) — see CONTRIBUTING.md
