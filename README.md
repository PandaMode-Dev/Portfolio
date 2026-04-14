# Interactive resume — Alexander Guzman

Static site: `index.html` (resume), `roblox.html` (Roblox portfolio), shared `styles.css` and `app.js`. Ship icons use images in `assets/`.

## Publish with GitHub Pages (free hosting)

1. **Create a GitHub repository** (e.g. `resume` or `portfolio`). Do not add a license/readme if you want only your files; or use an empty repo.

2. **Push this folder** to the repo (replace `YOUR_USER` and `YOUR_REPO`):

   ```bash
   cd "path/to/nteractive Website Resume"
   git init
   git add .
   git commit -m "Add interactive resume site"
   git branch -M main
   git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
   git push -u origin main
   ```

3. **Turn on GitHub Pages**

   - Repo → **Settings** → **Pages**
   - **Build and deployment** → Source: **Deploy from a branch**
   - Branch: **main**, folder: **/ (root)** → Save

4. After a minute, the site will be at:

   `https://YOUR_USER.github.io/YOUR_REPO/`

   All links use **relative** paths (`assets/...`, `roblox.html`), so this URL works without extra configuration.

5. **Custom domain** (optional, professional `.com` / `.org`)

   - Buy a domain from a registrar (Cloudflare, Namecheap, etc.).
   - In **GitHub** repo → **Settings** → **Pages** → **Custom domain** → enter `www.yourdomain.com` (or apex).
   - Add the DNS records GitHub shows (usually **A** / **AAAA** for apex, **CNAME** for `www`).
   - Enable **Enforce HTTPS** once DNS validates.

`.nojekyll` is included so GitHub does not run Jekyll on your static files.

## Local preview

Open `index.html` in a browser, or from this folder run a simple server (if you have Python):

```bash
python -m http.server 8080
```

Then visit `http://localhost:8080`.
