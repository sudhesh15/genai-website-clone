GENAI Website Cloner
This project is a simple website UI cloner built with Node.js.
It lets you clone the HTML, CSS, and images of any public website for offline viewing.

📂 Folder Structure
GENAI-WEBSITE-CLONE/
├── node_modules/
├── .env
├── .gitignore
├── genai-website-clone-application.mp4 (demo video, optional)
├── package-lock.json
├── package.json
├── README.md
└── website-cloner.js

🚀 High-Level Overview of website-cloner.js
Loads a target website using Puppeteer (headless browser).

Extracts and rewrites the HTML structure with Cheerio.

Scrapes all linked CSS files, merges them, and saves to styles.css.

Downloads all images, background styles, and SVGs for offline use.

Saves results in a local folder containing:

index.html

styles.css

media assets (images, icons, etc.)

This gives you a static UI copy of the site.

⚙️ How to Run
Install dependencies with:
npm install

Make sure .env file is created with necessary keys (if required).

Run the website cloner script:
node website-cloner.js

The cloned site files will be saved in a new folder. For example:
cloned-example.com/
├── index.html
├── styles.css
├── image1.png
└── ...

📝 Notes
This clones only the UI (frontend) of the website.

Backend code, APIs, or dynamic functionality will not be cloned.

Works best on static or semi-static sites.

Puppeteer may need extra steps in some environments (Chromium dependencies).
