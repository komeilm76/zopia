# 🛠️ Website setup — one-time checklist

Everything the documentation website needs that **cannot** be done from code:
creating the site repository, creating the deploy token, and activating the
workflow. Do it once. Total time: about 10 minutes — or 3 minutes if the
repository stays public (see [Path B](#-path-b--zopia-stays-public)).

> 🧭 Why these three exist — the site is published from a **separate public
> repository** so `komeilm76/zopia` can become private without taking the
> documentation offline ([D-26](12-standards.md#-key-decisions) ·
> [Website plan](14-website.md#-deployment-topology-d-26)).

## 🧭 Choose your path first

There are two supported ways to publish the site. They differ only in **where
GitHub Pages serves the files from**, and the choice is forced by one question:
*will `komeilm76/zopia` be private?*

| | Path A — zopia goes **private** | Path B — zopia stays **public** |
| --- | --- | --- |
| Template | `docs-workflow.yml.example` | [`docs-workflow-public.yml.example`](docs-workflow-public.yml.example) |
| Extra repository | a public `komeilm76.github.io` | none |
| Secret | `PAGES_DEPLOY_TOKEN` | none |
| Manual steps | the 4 below | [just one](#-path-b--zopia-stays-public) |
| Precedent | — | the same pipeline as `komeilm76/km-geoboard` |
| URL | <https://komeilm76.github.io/zopia/> | <https://komeilm76.github.io/zopia/> |

Pages served **directly** from a private repository requires a paid GitHub
plan; that is the only reason Path A exists. If the repository stays public,
jump to [Path B](#-path-b--zopia-stays-public) and ignore steps 1–3.

---

## 🚀 Path B — zopia stays public

One step, no secrets, no second repository.

1. Copy [`docs/development/docs-workflow-public.yml.example`](docs-workflow-public.yml.example)
   to `.github/workflows/docs.yml` on `main` (the two ways to do that are
   described in [step 3](#-step-3--activate-the-workflow) — the only difference
   is which template you copy).
2. In **<https://github.com/komeilm76/zopia/settings/pages>**, set
   **Build and deployment → Source** to **GitHub Actions**.
3. Open **Actions → docs → Run workflow**, and when it turns green visit
   <https://komeilm76.github.io/zopia/>.

That workflow uses `actions/upload-pages-artifact` + `actions/deploy-pages`, so
GitHub itself owns the deployment and nothing needs write access to another
repository. Everything else — snapshots on release, the quality audit, the
`/zopia/` base-path assertion — is identical to Path A.

> ⚠️ If you later make the repository private, the published site keeps
> working only until the next deployment; switch to Path A at that point.

---

## 🔐 Path A — zopia goes private

The remaining four steps are Path A only.

| # | Step | Where | Time |
| --- | --- | --- | --- |
| 1 | [Create the public site repository](#-step-1--create-the-public-site-repository) | github.com | 3 min |
| 2 | [Create the deploy token and add it as a secret](#-step-2--create-the-deploy-token-and-add-it-as-a-secret) | github.com | 4 min |
| 3 | [Activate the workflow](#-step-3--activate-the-workflow) | the zopia repository | 3 min |
| 4 | [Verify, then go private](#-step-4--verify-then-go-private) | both | 2 min |

---

## 🏗️ Step 1 — Create the public site repository

This repository holds **only the built website**. Its name must match your
GitHub username exactly, because that is what makes it a *user site* served at
`https://komeilm76.github.io/`.

1. Go to **<https://github.com/new>**.
2. Fill the form:
   - **Repository name**: `komeilm76.github.io` — exactly this, no typos, all lowercase.
   - **Description** (optional): `komeilm76 — package documentation hub`.
   - **Visibility**: select **Public**. ⚠️ This is the whole point — it stays public while `zopia` goes private.
   - **Initialize this repository with**: tick **Add a README file**. (A repository with no commits has no branch, and GitHub Pages needs a branch.)
3. Click **Create repository**.

### Turn on GitHub Pages for it

4. In the new repository, click **Settings** (top bar) → **Pages** (left sidebar).
5. Under **Build and deployment**:
   - **Source**: `Deploy from a branch`
   - **Branch**: `main`, folder `/ (root)`
6. Click **Save**.

GitHub shows *"Your site is live at https://komeilm76.github.io/"* after a
minute or two. The zopia docs will appear at
`https://komeilm76.github.io/zopia/` after step 3.

> 💡 Nothing you do later touches anything in this repository except the
> `zopia/` folder, so other packages can publish their docs here too
> ([R-231](14-website.md#-deployment-topology-d-26)).

---

## 🔑 Step 2 — Create the deploy token and add it as a secret

The zopia repository needs permission to write into the *other* repository.
GitHub's built-in automation token only works inside one repository, so this
needs a **fine-grained personal access token** limited to exactly one
repository and one permission.

### Create the token

1. Go to **<https://github.com/settings/personal-access-tokens/new>**
   (the same page via menus: click your avatar → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**).
2. Fill the form:
   - **Token name**: `zopia-docs-deploy`
   - **Expiration**: `1 year` (or `No expiration` if you prefer not to renew — see the renewal note below).
   - **Resource owner**: `komeilm76`
   - **Repository access**: choose **Only select repositories**, then pick **`komeilm76.github.io`** — and *nothing else*.
   - **Permissions** → **Repository permissions** → find **Contents** → set it to **Read and write**.
     (`Metadata: Read-only` is added automatically. Leave every other permission at *No access*.)
3. Click **Generate token**.
4. **Copy the token now** — it starts with `github_pat_…` and GitHub never shows it again. Keep it in your clipboard for the next step.

> 🔐 This token can only write files to your public site repository. It cannot
> read zopia's source, publish to npm, or touch any other repository.

### Add it to the zopia repository as a secret

5. Go to **<https://github.com/komeilm76/zopia/settings/secrets/actions>**
   (via menus: the zopia repository → **Settings** → **Secrets and variables** → **Actions**).
6. Click **New repository secret**.
7. Fill it in:
   - **Name**: `PAGES_DEPLOY_TOKEN` — exactly this, uppercase, with underscores.
   - **Secret**: paste the token you copied.
8. Click **Add secret**.

You will never see the value again, and neither will anyone reading the logs —
that is intended ([R-232](14-website.md#-deployment-topology-d-26)).

> 🔄 **When the token expires** (if you chose an expiry): GitHub emails you
> beforehand. Repeat this step with a new token and update the same secret —
> nothing else changes.

---

## ⚙️ Step 3 — Activate the workflow

The workflow file is already written and reviewed; it just has to be placed in
the folder GitHub watches. It lives in the repository as
[`docs/development/docs-workflow.yml.example`](docs-workflow.yml.example)
(Path A) or [`docs/development/docs-workflow-public.yml.example`](docs-workflow-public.yml.example)
(Path B). Copy **one** of them — the destination file name is `docs.yml` either way.

### Option A — in the browser (no tools needed)

1. Open the template:
   **<https://github.com/komeilm76/zopia/blob/main/docs/development/docs-workflow.yml.example>**
2. Click the **Copy raw file** icon (top-right of the file view) to copy its whole content.
3. Go to **<https://github.com/komeilm76/zopia/new/main>** (the *create a new file* page).
4. In the **Name your file…** box type exactly:

   ```text
   .github/workflows/docs.yml
   ```

   Typing `/` creates the folders automatically.
5. Paste the copied content into the editor.
6. Delete the three comment lines at the very top that say *"Copy this file to
   `.github/workflows/docs.yml` to activate it"* — they are instructions, not configuration. (Leaving them in is harmless; it is just tidier.)
7. Scroll down, choose **Commit directly to the `main` branch**, and click **Commit new file**.

### Option B — on your machine

```bash
git clone https://github.com/komeilm76/zopia.git
cd zopia
mkdir -p .github/workflows
cp docs/development/docs-workflow.yml.example .github/workflows/docs.yml
git add .github/workflows/docs.yml
git commit -m "ci: publish the documentation website"
git push origin main
```

### Run it the first time

8. Go to **<https://github.com/komeilm76/zopia/actions>**.
9. In the left sidebar click the **docs** workflow.
10. Click **Run workflow** (right side) → leave the branch as `main` → **Run workflow**.
11. Wait for the green ✅ (about two minutes). Click the run to watch the steps:
    *Install website dependencies → Build the website → Quality audit → Checkout the public site repository → Replace the /zopia/ sub-site → Commit and push.*

---

## ✅ Step 4 — Verify, then go private

1. Open **<https://komeilm76.github.io/zopia/>**. You should see the zopia home
   page with working styling, search, and the version switcher showing
   `v0.6`, `v0.5.2`, `v0.4.0`.
2. Click through one guide page and one `/v0.5/` page — the old one must show
   the orange *"you are reading old documentation"* banner.
3. Only then: zopia repository → **Settings** → scroll to **Danger Zone** →
   **Change repository visibility** → **Make private**.
4. Re-run the **docs** workflow once after going private (step 3 → *Run it the first time*) to
   confirm the pipeline still publishes. It will: the build runs inside the
   private repository, and only the built files are pushed out.

---

## ✅ After the setup

Nothing manual is needed again. From then on:

| 🎬 What you do | 🤖 What happens |
| --- | --- |
| Push a change to `docs/user/**`, `website/**`, `README.md`, or `CHANGELOG.md` on `main` | the site rebuilds and republishes within ~2 minutes |
| Publish a GitHub Release | the previous minor is snapshotted into the version switcher, then the site rebuilds ([R-222](14-website.md#-release-flow-integration)) |
| Edit prose | always in `docs/user/` — never inside `website/` ([R-216](14-website.md#-content-pipeline)) |

## 🆘 Troubleshooting

| 😖 Symptom | 🔍 Cause | 🛠️ Fix |
| --- | --- | --- |
| Workflow fails at *Checkout the public site repository* with `Repository not found` or `403` | the secret is missing, misspelled, expired, or the token does not include `komeilm76.github.io` | redo [step 2](#-step-2--create-the-deploy-token-and-add-it-as-a-secret); the name must be exactly `PAGES_DEPLOY_TOKEN` and the permission exactly *Contents: Read and write* |
| `https://komeilm76.github.io/zopia/` shows **404** | Pages is not enabled, or the first run has not finished | check repository → **Settings → Pages** shows a live URL, and that a `zopia/` folder exists in `komeilm76.github.io` |
| Page loads but is **unstyled** (plain text) | the `base` path is wrong or Jekyll ate the assets | the workflow already writes `.nojekyll` and asserts the `/zopia/` base — re-run it; if it still happens, open an issue with the failing run link |
| Workflow fails at *Quality audit* | a documentation change broke a rule (dead link, missing description, oversized page) | the log names the exact page and rule; fix it in `docs/user/` and push again |
| Workflow fails at *Commit new snapshots* | branch protection on `main` blocks the bot | allow GitHub Actions to push, or cut snapshots locally with `npm run snapshot -- <tag>` |

## 🔗 Next

- 🌐 [Website plan](14-website.md) — architecture, versioning, release flow
- ✂️ [Documentation split plan](13-documentation-split.md) — what gets published
- 📏 [Standards → Release flow](12-standards.md#-release-flow) — the release checklist
