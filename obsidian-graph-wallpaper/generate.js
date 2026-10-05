'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const VAULT_ROOT = 'C:\\Users\\matth\\Obsidian';
const GRAPH_JSON_PATH = path.join(VAULT_ROOT, '.obsidian', 'graph.json');
const OUTPUT_PATH = path.join(__dirname, 'graph-data.js');

const DEFAULT_NODE_COLOR = '#8a8a8a';
const UNRESOLVED_NODE_COLOR = 'rgba(138,138,138,0.4)';
const DEFAULT_LINK_COLOR = 'rgba(255,255,255,0.15)';
const BACKGROUND_COLOR = '#1e1e1e';

const LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

function walkVault(root) {
  const mdFiles = []; // { absPath, vaultPath }
  const attachmentPaths = []; // vaultPath (forward-slash)

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // .obsidian, .git, .trash, etc.
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absPath);
      } else if (entry.isFile()) {
        const vaultPath = path.relative(root, absPath).split(path.sep).join('/');
        if (entry.name.toLowerCase().endsWith('.md')) {
          mdFiles.push({ absPath, vaultPath });
        } else {
          attachmentPaths.push(vaultPath);
        }
      }
    }
  }

  walk(root);
  return { mdFiles, attachmentPaths };
}

function buildBasenameIndex(mdFiles) {
  const index = new Map(); // lowercased basename (no .md) -> [{ vaultPath, segments }]
  for (const { vaultPath } of mdFiles) {
    const base = vaultPath.slice(vaultPath.lastIndexOf('/') + 1).replace(/\.md$/i, '');
    const key = base.toLowerCase();
    const segments = vaultPath.split('/').length;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ vaultPath, segments });
  }
  return index;
}

function pickShortest(candidates) {
  return candidates
    .slice()
    .sort((a, b) => a.segments - b.segments || a.vaultPath.localeCompare(b.vaultPath))[0];
}

function resolveTarget(rawTarget, basenameIndex, attachmentPaths) {
  let target = rawTarget.trim().replace(/^\/+/, '');
  if (!target) return null;

  const hasExtension = /\.[a-z0-9]+$/i.test(target);
  const hasSlash = target.includes('/');

  // Try resolving as a note first.
  const noteBase = hasExtension ? target.replace(/\.md$/i, '') : target;
  const noteBaseName = noteBase.slice(noteBase.lastIndexOf('/') + 1);

  if (hasSlash) {
    const suffix = ('/' + noteBase + '.md').toLowerCase();
    const candidates = [];
    for (const [, arr] of basenameIndex) {
      for (const c of arr) {
        if (('/' + c.vaultPath).toLowerCase().endsWith(suffix)) candidates.push(c);
      }
    }
    if (candidates.length) return { type: 'note', vaultPath: pickShortest(candidates).vaultPath };
  } else {
    const candidates = basenameIndex.get(noteBaseName.toLowerCase());
    if (candidates && candidates.length) return { type: 'note', vaultPath: pickShortest(candidates).vaultPath };
  }

  // Not a note - try resolving as an attachment (dropped later per showAttachments:false).
  const attTarget = target.toLowerCase();
  const attMatch = attachmentPaths.find((p) => {
    const lp = p.toLowerCase();
    return hasSlash ? lp.endsWith('/' + attTarget) || lp === attTarget : lp.endsWith('/' + attTarget) || lp === attTarget || lp.slice(lp.lastIndexOf('/') + 1) === attTarget;
  });
  if (attMatch) return { type: 'attachment', vaultPath: attMatch };

  return { type: 'ghost', name: noteBaseName || target };
}

function stripCode(text) {
  // Remove fenced code blocks (```...```) and inline code spans (`...`) so
  // example wikilink syntax inside docs isn't parsed as a real link.
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

function extractLinks(text) {
  const targets = [];
  let m;
  const cleaned = stripCode(text);
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(cleaned)) !== null) {
    targets.push(m[1]);
  }
  return targets;
}

function loadColorGroups() {
  const raw = JSON.parse(fs.readFileSync(GRAPH_JSON_PATH, 'utf8'));
  const groups = Array.isArray(raw.colorGroups) ? raw.colorGroups : [];
  return groups
    .map((g) => {
      const match = /^path:"(.*)"$/.exec(g.query || '');
      if (!match) return null;
      const rgb = g.color && typeof g.color.rgb === 'number' ? g.color.rgb : null;
      if (rgb === null) return null;
      const hex = '#' + rgb.toString(16).padStart(6, '0').toUpperCase();
      return { needle: match[1], hex };
    })
    .filter(Boolean);
}

function loadForces() {
  const raw = JSON.parse(fs.readFileSync(GRAPH_JSON_PATH, 'utf8'));
  return {
    textFadeMultiplier: raw.textFadeMultiplier,
    nodeSizeMultiplier: raw.nodeSizeMultiplier,
    lineSizeMultiplier: raw.lineSizeMultiplier,
    centerStrength: raw.centerStrength,
    repelStrength: raw.repelStrength,
    linkStrength: raw.linkStrength,
    linkDistance: raw.linkDistance,
    scale: raw.scale,
  };
}

function colorForNode(vaultPath, colorGroups) {
  const lower = vaultPath.toLowerCase();
  for (const { needle, hex } of colorGroups) {
    if (lower.includes(needle.toLowerCase())) return hex;
  }
  return DEFAULT_NODE_COLOR;
}

function buildGraphData() {
  const { mdFiles, attachmentPaths } = walkVault(VAULT_ROOT);
  const basenameIndex = buildBasenameIndex(mdFiles);
  const colorGroups = loadColorGroups();
  const forces = loadForces();

  const nodesById = new Map();
  for (const { vaultPath } of mdFiles) {
    nodesById.set(vaultPath, {
      id: vaultPath,
      name: vaultPath.slice(vaultPath.lastIndexOf('/') + 1).replace(/\.md$/i, ''),
      type: 'note',
      resolved: true,
      color: colorForNode(vaultPath, colorGroups),
      degree: 0,
    });
  }

  const ghostByKey = new Map(); // lowercased target -> node id (== target text)

  const edgeSet = new Map(); // "a->b" (sorted) -> { source, target }

  for (const { absPath, vaultPath } of mdFiles) {
    const text = fs.readFileSync(absPath, 'utf8');
    const targets = extractLinks(text);
    for (const rawTarget of targets) {
      const resolved = resolveTarget(rawTarget, basenameIndex, attachmentPaths);
      if (!resolved || resolved.type === 'attachment') continue; // showAttachments:false

      let targetId;
      if (resolved.type === 'note') {
        if (resolved.vaultPath === vaultPath) continue; // skip self-links
        targetId = resolved.vaultPath;
      } else {
        const key = resolved.name.toLowerCase();
        if (!ghostByKey.has(key)) {
          const ghostId = 'ghost:' + resolved.name;
          ghostByKey.set(key, ghostId);
          nodesById.set(ghostId, {
            id: ghostId,
            name: resolved.name,
            type: 'ghost',
            resolved: false,
            color: UNRESOLVED_NODE_COLOR,
            degree: 0,
          });
        }
        targetId = ghostByKey.get(key);
      }

      const pairKey = [vaultPath, targetId].sort().join('->');
      if (!edgeSet.has(pairKey)) {
        edgeSet.set(pairKey, { source: vaultPath, target: targetId });
      }
    }
  }

  for (const { source, target } of edgeSet.values()) {
    const a = nodesById.get(source);
    const b = nodesById.get(target);
    if (a) a.degree += 1;
    if (b) b.degree += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    forces,
    colors: {
      background: BACKGROUND_COLOR,
      defaultNode: DEFAULT_NODE_COLOR,
      defaultLink: DEFAULT_LINK_COLOR,
      unresolvedNode: UNRESOLVED_NODE_COLOR,
    },
    nodes: Array.from(nodesById.values()),
    links: Array.from(edgeSet.values()),
  };
}

// Lively Wallpaper sometimes imports a wallpaper by copying the whole folder
// into its own library instead of referencing this project in place. When it
// does, regenerating graph-data.js here never reaches the screen - the copy
// under Lively's library is what's actually rendered. Find any such copies
// via Lively's own layout file and mirror the freshly generated data into
// them too, so the wallpaper stays live regardless of which mode Lively used.
function findLivelyMirrorTargets() {
  const targets = [];
  try {
    const layoutPath = path.join(
      os.homedir(),
      'AppData', 'Local', 'Lively Wallpaper', 'WallpaperLayout.json'
    );
    if (!fs.existsSync(layoutPath)) return targets;
    const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
    for (const entry of layout) {
      const dir = entry && entry.LivelyInfoPath;
      if (!dir) continue;
      if (path.resolve(dir) === path.resolve(__dirname)) continue; // already the real folder
      const marker = path.join(dir, 'graph-data.js');
      if (fs.existsSync(marker)) targets.push(marker);
    }
  } catch (err) {
    // Best-effort only; Lively may not be installed/running.
  }
  return targets;
}

function writeGraphData() {
  const data = buildGraphData();
  const body = 'window.GRAPH = ' + JSON.stringify(data, null, 2) + ';\n';
  const tmpPath = OUTPUT_PATH + '.tmp';
  fs.writeFileSync(tmpPath, body, 'utf8');
  fs.renameSync(tmpPath, OUTPUT_PATH);

  for (const mirrorPath of findLivelyMirrorTargets()) {
    try {
      const mirrorTmp = mirrorPath + '.tmp';
      fs.writeFileSync(mirrorTmp, body, 'utf8');
      fs.renameSync(mirrorTmp, mirrorPath);
    } catch (err) {
      // Best-effort mirror; the primary write above already succeeded.
    }
  }

  return data;
}

module.exports = { buildGraphData, writeGraphData, VAULT_ROOT, OUTPUT_PATH };

if (require.main === module) {
  const data = writeGraphData();
  const ghostCount = data.nodes.filter((n) => n.type === 'ghost').length;
  console.log(
    `nodes: ${data.nodes.length} (ghost: ${ghostCount}), edges: ${data.links.length}`
  );
}
