'use strict';

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { buildGraphData, writeGraphData, VAULT_ROOT } = require('./generate.js');

const DEBOUNCE_MS = 2500;
const LOG_PATH = path.join(__dirname, 'watch.log');

function log(line) {
  const entry = `[${new Date().toISOString()}] ${line}\n`;
  try {
    fs.appendFileSync(LOG_PATH, entry);
  } catch (err) {
    // A locked/busy log file must never bring down the watcher itself.
    console.error(`log write failed: ${err.stack || err}`);
  }
  console.log(entry.trim());
}

process.on('uncaughtException', (err) => {
  log(`uncaughtException: ${err.stack || err}`);
});
process.on('unhandledRejection', (err) => {
  log(`unhandledRejection: ${err && err.stack || err}`);
});

let timer = null;

function scheduleRegen() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(regen, DEBOUNCE_MS);
}

function regen() {
  try {
    const data = writeGraphData();
    const ghostCount = data.nodes.filter((n) => n.type === 'ghost').length;
    log(`regenerated: nodes=${data.nodes.length} (ghost=${ghostCount}) edges=${data.links.length}`);
  } catch (err) {
    log(`ERROR: ${err.stack || err}`);
  }
}

log('watcher starting');
regen(); // fresh graph-data.js immediately at startup, before entering watch mode

const watcher = chokidar.watch(VAULT_ROOT, {
  ignored: [/(^|[\/\\])\.(obsidian|git|trash)([\/\\]|$)/, /node_modules/],
  ignoreInitial: true,
  persistent: true,
  awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
});

watcher
  .on('add', scheduleRegen)
  .on('change', scheduleRegen)
  .on('unlink', scheduleRegen)
  .on('addDir', scheduleRegen)
  .on('unlinkDir', scheduleRegen)
  .on('error', (err) => log(`watcher error: ${err.stack || err}`))
  .on('ready', () => log('watcher ready, watching for vault changes'));
