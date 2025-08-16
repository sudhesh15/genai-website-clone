1. Folder Structure

GENAI-WEBSITE-CLONE/
├── node_modules/
├── .env
├── .gitignore
├── package-lock.json
├── package.json
├── README.md
└── website-cloner.js

2. High-level Explanation of website-cloner.js
Purpose:
This script clones the visual UI of any public website.

How it works (high level):

Accepts a website URL (and optionally a target folder name).

Uses Puppeteer to load and render the website as a browser would.

Scrapes all visible HTML, CSS files, and images (including lazy-loaded, background images, SVGs).

Downloads those assets and rewrites links so they work locally.

Outputs a folder (e.g., cloned-example.com/) containing an index.html, styles.css, and images for offline viewing of the site’s appearance.

3. How to Run
Install dependencies:

npm install
Set your OpenAI API key in .env:
OPENAI_API_KEY=your_api_key

Run the website cloner script:

node website-cloner.js
The script will prompt or use hardcoded settings to clone the target website as described above.
