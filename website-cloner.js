import 'dotenv/config';
import { OpenAI } from 'openai';
import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';

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

async function cloneWebsite(url = '') {
  try {
    const folderName = `cloned-${new URL(url).hostname.replace(/\./g, '-')}`;
    await fs.ensureDir(folderName);

    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });

    const html = await page.content();

    const $ = cheerio.load(html);
    let cssLinks = [];
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) cssLinks.push(href);
    });

    for (const link of cssLinks) {
      let cssUrl = link.startsWith('http') ? link : new URL(link, url).href;
      const cssContent = await axios.get(cssUrl).then(res => res.data).catch(() => '');
      await fs.writeFile(path.join(folderName, `styles.css`), cssContent, { flag: 'a' });
    }

    await fs.writeFile(path.join(folderName, `index.html`), html);

    await browser.close();

    return `Website cloned. Files index.html, styles.css, and script.js are created in ./${folderName}/`;
  } catch (err) {
    return `Error cloning website: ${err.message}`;
  }
}

const TOOL_MAP = {
  executeCommand: executeCommand,
  cloneWebsite: cloneWebsite,
};

const client = new OpenAI();

async function main() {
  // These api calls are stateless (Chain Of Thought)
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
    - cloneWebsite(url: string): Clones the exact UI of the specified website using scraping tools. Creates a folder and generates html, css, and js files to replicate the site’s appearance.

    Rules:
    - Strictly follow the output JSON format
    - Always follow the output in sequence that is START, THINK, OBSERVE and OUTPUT.
    - Always perform only one step at a time and wait for other step.
    - Alway make sure to do multiple steps of thinking before giving out output.
    - For every tool call always wait for the OBSERVE which contains the output from tool
    - Always return code files as multi-line code blocks, not as JSON strings or with escaped newlines.

    Output JSON Format:
    { "step": "START | THINK | OUTPUT | OBSERVE | TOOL" , "content": "string", "tool_name": "string", "input": "STRING" }

    Example:
    User: Can you clone https://example.com?
    ASSISTANT: { "step": "START", "content": "The user wants to clone the website at https://example.com" }
    ASSISTANT: { "step": "THINK", "content": "I need to see if there is an available tool to clone website UI" }
    ASSISTANT: { "step": "THINK", "content": "I see cloneWebsite tool that can scrape and recreate the site files using puppeteer and cheerio" }
    ASSISTANT: { "step": "TOOL", "input": "https://example.com", "tool_name": "cloneWebsite" }
    DEVELOPER: { "step": "OBSERVE", "content": "Website cloned. Files index.html, styles.css, and script.js are created in ./cloned-example-com/" }
    ASSISTANT: { "step": "THINK", "content": "I successfully cloned the site's UI and saved the files" }
    ASSISTANT: { "step": "OUTPUT", "content": "The site https://example.com has been cloned. You can find the files in ./cloned-example-com/" }
  `;

  const messages = [
    {
      role: 'system',
      content: SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content:
        'Hey, create a clone of https://sudheshholla.in/ using html, css and js and save it in a folder named portfolio',
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

      const responseFromTool = await TOOL_MAP[toolToCall](parsedContent.input);
      console.log(
        `🛠️: ${toolToCall}(${parsedContent.input}) = `,
        responseFromTool
      );
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