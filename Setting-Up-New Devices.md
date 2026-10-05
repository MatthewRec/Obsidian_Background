# Welcome to Brain

This vault syncs to the private GitHub repo through the Obsidian Git plugin:
- When Obsidian opens, it pulls from GitHub, so notes from other devices show up.
- Every 5 minutes it commits your changes and pushes them to GitHub.
- To sync right away, open the command palette (Ctrl/Cmd+P) and run **Git: Commit-and-sync**.

## Adding another device

### Windows / Mac / Linux
1. Install [Obsidian](https://obsidian.md), [git](https://git-scm.com) and the [GitHub CLI](https://cli.github.com).
2. Run `gh auth login`, then `gh auth setup-git`.
3. Run `git clone https://github.com/<username>/<Obsidian vault name>.git ~/Obsidian`.
4. In Obsidian, choose **Open folder as vault**, pick `~/Obsidian`, and click **Trust author and enable plugins**.

### iPhone / iPad
1. On GitHub, go to Settings → Developer settings → Fine-grained tokens. Create a token for the private repo only, with **Contents: Read and write**.
2. In Obsidian, create a new empty vault. Go to Settings → Community plugins, turn them on, then install and enable **Git**.
3. Open the command palette and run **Git: Clone an existing remote repo**. Enter `https://github.com/<username>/<Obsidian vault name>.git`, your GitHub username and the token. Clone into the vault root.
4. Restart Obsidian.

Git on iOS is slow with large attachments. If it gives trouble, use the Working Copy app instead.

## If a note has a conflict
If you edit the same note on two devices before they sync, the note will contain `<<<<<<<` / `>>>>>>>` markers. Keep the text you want, delete the markers, and sync again.
