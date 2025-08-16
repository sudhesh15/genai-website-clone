import 'dotenv/config';
import { OpenAI } from 'openai';
import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import beautify from 'js-beautify';
import { exec } from 'child_process';

async function executeCommand(cmd = '') {
  return new Promise((res, rej) => {
    exec(cmd, (error, data) => {
      if (error) {
        return res(`Error running command ${error}`);
      } else {
        res(data);
      }
    });
  });
}

async function downloadAsset(url, destPath) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    await fs.writeFile(destPath, response.data);
    return true;
  } catch (err) {
    return false;
  }
}

async function cloneWebsite(url = '', customFolderName = '') {
  try {
    const origin = new URL(url);
    const folderName = customFolderName
      ? customFolderName
      : `cloned-${origin.hostname.replace(/\./g, '-')}`;
    await fs.ensureDir(folderName);

    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: 'networkidle2' });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    // Use setTimeout fallback instead of page.waitForTimeout
    await new Promise(resolve => setTimeout(resolve, 2000));

    const html = await page.content();
    await browser.close();

    const $ = cheerio.load(html);

    // Scrape CSS links
    let cssLinks = [];
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) cssLinks.push(href.startsWith('http') ? href : new URL(href, url).href);
    });

    // Remove old CSS links
    $('link[rel="stylesheet"]').remove();

    // Download CSS and concatenate
    let allCss = '';
    for (const cssUrl of cssLinks) {
      try {
        const cssContent = await axios.get(cssUrl).then(res => res.data);
        allCss += cssContent + '\n';
      } catch {}
    }
    $('head').append('<link rel="stylesheet" href="styles.css">');

    // Scrape and download all images in HTML, including lazy-loaded
    const imgTags = $('img');
    for (let i = 0; i < imgTags.length; ++i) {
      const img = imgTags[i];
      let src =
        $(img).attr('src') ||
        $(img).attr('data-src') ||
        $(img).attr('data-lazy') ||
        $(img).attr('data-original');
      if (!src || src.startsWith('data:image/')) continue;
      const absUrl = src.startsWith('http') ? src : new URL(src, url).href;
      try {
        const imgName = path.basename(new URL(absUrl).pathname);
        const imgPath = path.join(folderName, imgName);
        const success = await downloadAsset(absUrl, imgPath);
        if (success) {
          $(img).attr('src', imgName);
          $(img).removeAttr('data-src');
          $(img).removeAttr('data-lazy');
          $(img).removeAttr('data-original');
        }
      } catch {}
    }

    // Scrape images from inline style backgrounds
    const styleElems = $('[style]').toArray();
    for (const el of styleElems) {
      const style = $(el).attr('style');
      const regex = /background(?:-image)?:.*url\(["']?(.*?)["']?\)/;
      const match = regex.exec(style);
      if (match && match[1] && !match[1].startsWith('data:image/')) {
        let bgUrl = match[1].startsWith('http') ? match[1] : new URL(match[1], url).href;
        try {
          const imgName = path.basename(new URL(bgUrl).pathname);
          const imgPath = path.join(folderName, imgName);
          const success = await downloadAsset(bgUrl, imgPath);
          if (success) {
            $(el).attr(
              'style',
              style.replace(match[1], imgName)
            );
          }
        } catch {}
      }
    }

    // SVG images
    const svgImages = $('image').toArray();
    for (const el of svgImages) {
      const href = $(el).attr('href') || $(el).attr('xlink:href');
      if (href && !href.startsWith('data:image/')) {
        let svgUrl = href.startsWith('http') ? href : new URL(href, url).href;
        try {
          const imgName = path.basename(new URL(svgUrl).pathname);
          const imgPath = path.join(folderName, imgName);
          const success = await downloadAsset(svgUrl, imgPath);
          if (success) {
            $(el).attr('href', imgName);
            $(el).attr('xlink:href', imgName);
          }
        } catch {}
      }
    }

    // Scrape and download images referenced in CSS (url(...) values)
    const urlRegex = /url\(["']?(.*?)["']?\)/g;
    const cssImageLinks = [...allCss.matchAll(urlRegex)].map(match => match[1]);
    for (const cssImgUrl of cssImageLinks) {
      if (!cssImgUrl || cssImgUrl.startsWith('data:image/')) continue;
      const fullUrl = cssImgUrl.startsWith('http') ? cssImgUrl : new URL(cssImgUrl, url).href;
      try {
        const imgName = path.basename(new URL(fullUrl).pathname);
        const imgPath = path.join(folderName, imgName);
        const success = await downloadAsset(fullUrl, imgPath);
        if (success) {
          allCss = allCss.replace(
            new RegExp(cssImgUrl.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'),
            imgName
          );
        }
      } catch {}
    }

    const beautifiedHtml = beautify.html($.html(), { indent_size: 2 });
    const beautifiedCss = beautify.css(allCss, { indent_size: 2 });

    await fs.writeFile(path.join(folderName, 'index.html'), beautifiedHtml);
    await fs.writeFile(path.join(folderName, 'styles.css'), beautifiedCss);

    return `Website cloned. Files index.html, styles.css, and images saved in ./${folderName}/`;
  } catch (err) {
    return `Error cloning website: ${err.message}`;
  }
}

const TOOL_MAP = {
  executeCommand,
  cloneWebsite,
};

const client = new OpenAI();

async function main() {
  const SYSTEM_PROMPT = `
    You are an AI assistant who works on START, THINK and OUTPUT format.
    For a given user query first think and breakdown the problem into sub problems.
    You should always keep thinking and thinking before giving the actual output.

    Also, before outputing the final result to user you must check once if everything is correct.
    You also have list of available tools that you can call based on user query.

    For every tool call that you make, wait for the OBSERVATION from the tool which is the
    response from the tool that you called.

    Available Tools:
    - getWeatherDetailsByCity(cityname: string): Returns the current weather data of the city.
    - getGithubUserInfoByUsername(username: string): Retuns the public info about the github user using github api
    - executeCommand(command: string): Takes a linux / unix command as arg and executes the command on user's machine and returns the output
    - cloneWebsite(url: string, folderName?: string): Clones the exact UI of the specified website using scraping tools. Creates a folder and generates html and css files to replicate the site’s appearance.

    Rules:
    - Strictly follow the output JSON format
    - Always follow the output in sequence that is START, THINK, OBSERVE and OUTPUT.
    - Always perform only one step at a time and wait for other step.
    - Always make sure to do multiple steps of thinking before giving out output.
    - For every tool call always wait for the OBSERVE which contains the output from tool
    - Always return code files as multi-line code blocks, not as JSON strings or with escaped newlines.

    Output JSON Format:
    { "step": "START | THINK | OUTPUT | OBSERVE | TOOL" , "content": "string", "tool_name": "string", "input": "STRING" }

    Example:
    User: Can you clone https://example.com?
    ASSISTANT: { "step": "START", "content": "The user wants to clone the website at https://example.com" }
    ASSISTANT: { "step": "THINK", "content": "I need to see if there is an available tool to clone website UI" }
    ASSISTANT: { "step": "THINK", "content": "I see cloneWebsite tool that can scrape and recreate the site files using puppeteer and cheerio" }
    ASSISTANT: { "step": "TOOL", "input": "{\\"url\\":\\"https://example.com\\",\\"folderName\\":\\"example-folder\\"}", "tool_name": "cloneWebsite" }
    DEVELOPER: { "step": "OBSERVE", "content": "Website cloned. Files index.html, styles.css, and script.js are created in ./example-folder/" }
    ASSISTANT: { "step": "THINK", "content": "I successfully cloned the site's UI and saved the files" }
    ASSISTANT: { "step": "OUTPUT", "content": "The site https://example.com has been cloned. You can find the files in ./example-folder/" }
  `;

  const messages = [
    {
      role: 'system',
      content: SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content:
        'Hey, create a clone of https://www.piyushgarg.dev/ using html and css and save it in a folder named piyushgarg-dev',
    },
  ];

  while (true) {
    const response = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: messages,
    });

    const rawContent = response.choices[0].message.content;
    const parsedContent = JSON.parse(rawContent);

    messages.push({
      role: 'assistant',
      content: JSON.stringify(parsedContent),
    });

    if (parsedContent.step === 'START') {
      console.log(`🔥`, parsedContent.content);
      continue;
    }

    if (parsedContent.step === 'THINK') {
      console.log(`\t🧠`, parsedContent.content);
      continue;
    }

    if (parsedContent.step === 'TOOL') {
      const toolToCall = parsedContent.tool_name;
      if (!TOOL_MAP[toolToCall]) {
        messages.push({
          role: 'developer',
          content: `There is no such tool as ${toolToCall}`,
        });
        continue;
      }

      let toolInput = parsedContent.input;
      if (toolToCall === 'cloneWebsite') {
        try {
          const parsedInput = JSON.parse(toolInput);
          if (parsedInput.url && parsedInput.folderName) {
            toolInput = [parsedInput.url, parsedInput.folderName];
          } else if (parsedInput.url) {
            toolInput = [parsedInput.url];
          } else {
            toolInput = [toolInput];
          }
        } catch {
          toolInput = [toolInput];
        }
        const responseFromTool = await TOOL_MAP[toolToCall](...toolInput);
        console.log(`🛠️: ${toolToCall}(${toolInput}) =`, responseFromTool);
        messages.push({
          role: 'developer',
          content: JSON.stringify({ step: 'OBSERVE', content: responseFromTool }),
        });
        continue;
      }

      const responseFromTool = await TOOL_MAP[toolToCall](toolInput);
      console.log(`🛠️: ${toolToCall}(${toolInput}) = `, responseFromTool);
      messages.push({
        role: 'developer',
        content: JSON.stringify({ step: 'OBSERVE', content: responseFromTool }),
      });
      continue;
    }

    if (parsedContent.step === 'OUTPUT') {
      console.log(`🤖`, parsedContent.content);
      break;
    }
  }

  console.log('Done...');
}

main();
