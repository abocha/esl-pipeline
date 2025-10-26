#!/usr/bin/env node
import { getFfmpegPath } from '../src/index.js';

async function main() {
  try {
    const path = await getFfmpegPath();
    console.log(path);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

main();
