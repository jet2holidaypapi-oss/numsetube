# ViewTube 🎬

A YouTube-like video platform with upload, watch, like/dislike, comments, and messaging.

## Features
- 📹 Upload & watch videos (up to 500MB)
- 👍👎 Like & dislike videos
- 💬 Comment on videos
- ✉️ Message creators directly
- 🔔 Subscribe to channels
- 🔍 Search videos
- 👤 User profiles & channels

## Deploying to Render

### Step 1: Push to GitHub
```bash
git init
git add .
git commit -m "Initial ViewTube"
git remote add origin https://github.com/YOUR_USERNAME/viewtube.git
git push -u origin main
```

### Step 2: Deploy on Render
1. Go to [render.com](https://render.com) and sign in
2. Click **New → Web Service**
3. Connect your GitHub repo
4. Render will auto-detect the `render.yaml` config

**Or manually set:**
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Node Version:** 18+

### Step 3: Add a Persistent Disk
1. In your Render service → **Disks**
2. Add a disk:
   - **Name:** `viewtube-data`
   - **Mount Path:** `/var/data`
   - **Size:** 10 GB (or more)

### Step 4: Set Environment Variables
In Render → **Environment**:
- `SESSION_SECRET` → click "Generate" for a random value
- `DATA_DIR` → `/var/data`
- `NODE_ENV` → `production`

### Step 5: Deploy!
Click **Deploy** and your site will be live at `https://your-service.onrender.com`

## Local Development
```bash
npm install
npm run dev   # requires nodemon
# or
npm start
```

Visit http://localhost:3000

## Notes
- Videos are stored on disk — the persistent disk is **required** on Render or videos will be lost on redeploy
- SQLite database is also stored on the persistent disk at `/var/data/viewtube.db`
- Max video size: 500MB (adjustable in server.js)
