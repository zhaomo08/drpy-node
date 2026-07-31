#!/usr/bin/env node
/**
 * 预构建 /config 订阅快照，降低 Vercel 冷启动时扫源/解析成本。
 * 生成目录: data/config-snapshots/
 * 站点 API 使用占位符 __HOST__，运行时替换为真实域名。
 *
 * 用法: node scripts/build-config-snapshots.mjs
 */
import {readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync} from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {createHash} from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'config-snapshots');
const HOST = '__HOST__';

const jsDir = path.join(ROOT, 'spider/js');
const dr2Dir = path.join(ROOT, 'spider/js_dr2');
const configDir = path.join(ROOT, 'config');
const jsonDir = path.join(ROOT, 'json');
const subDir = path.join(ROOT, 'public/sub');
const reportPath = path.join(ROOT, 'data/source-checker/report.json');
const playerPath = path.join(configDir, 'player.json');
const parsesPath = path.join(configDir, 'parses.conf');
const mapPath = path.join(configDir, 'map.txt');

const TARGET_SUBS = ['fast', 'stable', 'stablex', 'green', 'all', 'tv'];

function md5(s) {
    return createHash('md5').update(String(s)).digest('hex');
}

function readJson(p, fallback = null) {
    if (!existsSync(p)) return fallback;
    return JSON.parse(readFileSync(p, 'utf-8'));
}

function loadSubs() {
    const list = readJson(path.join(subDir, 'sub.json'), []);
    const map = new Map(list.map((s) => [s.code, s]));
    return map;
}

function loadOrder(sortName) {
    const candidates = [
        path.join(subDir, `${sortName}.html`),
        path.join(subDir, `${sortName}.example.html`),
        path.join(subDir, 'order_common.html'),
        path.join(subDir, 'order_common.example.html'),
    ];
    for (const p of candidates) {
        if (existsSync(p)) {
            return readFileSync(p, 'utf-8').split('\n').map((x) => x.trim()).filter(Boolean);
        }
    }
    return [];
}

function naturalSortByName(sites, orderList = []) {
    if (!orderList.length) {
        return sites.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
    }
    const rank = (name) => {
        const n = String(name || '');
        for (let i = 0; i < orderList.length; i++) {
            if (n.includes(orderList[i])) return i;
        }
        return orderList.length + 1;
    };
    return sites.sort((a, b) => {
        const ra = rank(a.name);
        const rb = rank(b.name);
        if (ra !== rb) return ra - rb;
        return String(a.name).localeCompare(String(b.name), 'zh');
    });
}

function loadSitesMap() {
    const map = {};
    if (!existsSync(mapPath)) return map;
    const lines = readFileSync(mapPath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
        const parts = line.split('@@').map((x) => x.trim());
        if (parts.length < 2) continue;
        const key = parts[0];
        const queryStr = parts[1] || '';
        const alias = parts[2] || key;
        if (!map[key]) map[key] = [];
        map[key].push({alias, queryStr});
    }
    return map;
}

function loadFailedKeys() {
    const report = readJson(reportPath, null);
    const failed = new Set();
    const keep = new Set();
    if (!report?.sources) return {failed, keep, exportTime: null};
    for (const s of report.sources) {
        if (!s?.key) continue;
        if (s.manuallyMarked && s.status === 'success') {
            keep.add(s.key);
            continue;
        }
        if (s.status === 'error') failed.add(s.key);
    }
    return {failed, keep, exportTime: report.exportTime || null};
}

function guessMeta(baseName) {
    const name = baseName;
    let searchable = 1;
    let filterable = 1;
    if (/设置|推送|配置/.test(name)) searchable = 0;
    return {searchable, filterable, quickSearch: 0};
}

function buildDsSites(sitesMap) {
    const files = readdirSync(jsDir).filter((f) => f.endsWith('.js') && !f.startsWith('_'));
    // 跳过 APP 模板文件本体（由 map/模板配置展开）
    const valid = files.filter((f) => !/^APP.*\[模板]\.js$/i.test(f));
    const sites = [];

    // App 模板展开
    const tplPath = path.join(jsonDir, 'App模板配置.json');
    if (existsSync(tplPath)) {
        try {
            const tpl = JSON.parse(readFileSync(tplPath, 'utf-8'));
            for (const [key, config] of Object.entries(tpl)) {
                if (!valid.includes(`${key}[模板].js`) && !files.includes(`${key}[模板].js`)) continue;
                for (const [name] of Object.entries(config || {})) {
                    if (name === '示例') continue;
                    sites.push({
                        key: `drpyS_${name}_${key}`,
                        name: `${name}[M](${String(key).replace('App', '').toUpperCase()})`,
                        type: 4,
                        api: `${HOST}/api/${key}[模板]`,
                        searchable: 1,
                        filterable: 1,
                        quickSearch: 0,
                        ext: `../json/App模板配置.json$${name}`,
                        lang: 'ds',
                    });
                }
            }
        } catch {
            // ignore
        }
    }

    for (const file of valid) {
        if (/\[模板]\.js$/i.test(file)) continue;
        const baseName = path.basename(file, '.js');
        const meta = guessMeta(baseName);
        const mapped = sitesMap[baseName];
        const entries = Array.isArray(mapped) && mapped.length
            ? mapped.map((m) => ({
                key: `drpyS_${m.alias}`,
                name: `${m.alias}(DS)`,
                queryStr: m.queryStr || '',
            }))
            : [{key: `drpyS_${baseName}`, name: `${baseName}(DS)`, queryStr: ''}];

        for (const ent of entries) {
            const api = `${HOST}/api/${baseName}`;
            let ext = '';
            if (ent.queryStr) {
                const qs = ent.queryStr.startsWith('?') ? ent.queryStr.slice(1) : ent.queryStr;
                const sp = new URLSearchParams(qs);
                if (sp.get('type') === 'url' && sp.get('params')) {
                    ext = sp.get('params');
                } else if (ent.queryStr.startsWith('{')) {
                    ext = ent.queryStr;
                } else {
                    ext = ent.queryStr.startsWith('?') ? ent.queryStr : `?${qs}`;
                }
            }
            sites.push({
                key: ent.key,
                name: ent.name,
                type: 4,
                api,
                ...meta,
                ext,
                lang: 'ds',
            });
        }
    }
    return sites;
}

function buildDr2Sites(sitesMap) {
    if (!existsSync(dr2Dir)) return [];
    const files = readdirSync(dr2Dir).filter((f) => f.endsWith('.js') && !f.startsWith('_'));
    const sites = [];
    for (const file of files) {
        const baseName = path.basename(file, '.js');
        const meta = guessMeta(baseName);
        const mapped = sitesMap[baseName];
        const entries = Array.isArray(mapped) && mapped.length
            ? mapped.map((m) => ({key: `drpy2_${m.alias}`, name: `${m.alias}(DR2)`, queryStr: m.queryStr || ''}))
            : [{key: `drpy2_${baseName}`, name: `${baseName}(DR2)`, queryStr: ''}];
        for (const ent of entries) {
            let ext = `${HOST}/js/${file}`;
            if (ent.queryStr) {
                const qs = ent.queryStr.startsWith('?') ? ent.queryStr.slice(1) : ent.queryStr.replace(/^\?/, '');
                ext += (ext.includes('?') ? '&' : '?') + qs;
            }
            sites.push({
                key: ent.key,
                name: ent.name,
                type: 3,
                api: `${HOST}/public/drpy/drpy2.min.js`,
                ...meta,
                ext,
                lang: 'dr2',
            });
        }
    }
    return sites;
}

function applySubFilter(sites, sub) {
    if (!sub) return sites;
    const reg = new RegExp(sub.reg || '.*');
    if (sub.mode === 0) return sites.filter((s) => reg.test(s.name));
    if (sub.mode === 1) return sites.filter((s) => !reg.test(s.name));
    return sites;
}

function applyHealthy(sites, failed, keep, strict = false) {
    let out = sites.filter((s) => keep.has(s.key) || !failed.has(s.key));
    if (strict) {
        const weak = /\[密\]|密\+|\[差\]|\[擦\]|原始/;
        out = out.filter((s) => !weak.test(s.name || ''));
    }
    return out;
}

function buildParses() {
    const parses = [];
    if (!existsSync(parsesPath)) return parses;
    const lines = readFileSync(parsesPath, 'utf-8').split('\n');
    for (const line of lines) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const parts = t.split(',');
        if (parts.length < 2) continue;
        const name = parts[0].trim();
        let url = parts[1].trim().replaceAll('{{hostName}}', HOST.replace(/^https?:\/\//, ''));
        // 快照里保留占位，运行时再替换 host
        url = url.replaceAll(HOST.replace(/^https?:\/\//, ''), '__HOSTNAME__');
        const type = Number(parts[2] || 0);
        parses.push({name, url, type});
    }
    return parses;
}

function buildSnapshot(subCode, subMap, sitesMap, failed, keep) {
    const sub = subMap.get(subCode) || (subCode === 'all' ? {code: 'all', reg: '.*', mode: 0, sort: 'order_common'} : null);
    if (!sub) return null;

    let sites = [...buildDsSites(sitesMap), ...buildDr2Sites(sitesMap)];
    // hide adult-ish by default for green-like; yellow keeps
    if (subCode !== 'yellow' && subCode !== 'all') {
        sites = sites.filter((s) => !/\[密\]|密+/.test(s.name));
    }
    sites = applySubFilter(sites, sub);

    const strict = ['stable', 'stablex', 'fast'].includes(subCode);
    sites = applyHealthy(sites, failed, keep, strict);

    const order = loadOrder(sub.sort || 'order_common');
    sites = naturalSortByName(sites, order);

    const player = readJson(playerPath, {}) || {};
    const parses = buildParses();
    const lives = [];
    if (process.env.LIVE_URL || true) {
        // 运行时 generateLivesJSON 会再处理；这里给占位避免空
        lives.push({
            name: '直播',
            type: 0,
            url: `${HOST}/public/lives/`,
            playerType: 1,
            epg: '',
            logo: '',
        });
    }

    return {
        version: 1,
        builtAt: new Date().toISOString(),
        sub: subCode,
        healthy: strict ? '2' : '1',
        reportExportTime: null,
        sites_count: sites.length,
        sites,
        parses,
        lives,
        wallpaper: player.wallpaper || '',
        spider: player.spider || '',
        homepage: player.homepage || '',
        logo: player.logo || '',
        sniffer: player.sniffer || undefined,
        rules: player.rules || undefined,
        ads: player.ads || undefined,
        doh: player.doh || undefined,
        snapshot: true,
    };
}

function main() {
    mkdirSync(OUT_DIR, {recursive: true});
    const subMap = loadSubs();
    const sitesMap = loadSitesMap();
    const {failed, keep, exportTime} = loadFailedKeys();

    const index = {builtAt: new Date().toISOString(), files: [], reportExportTime: exportTime};

    for (const code of TARGET_SUBS) {
        const snap = buildSnapshot(code, subMap, sitesMap, failed, keep);
        if (!snap) {
            console.log('skip', code);
            continue;
        }
        snap.reportExportTime = exportTime;
        const file = `${code}.json`;
        const outPath = path.join(OUT_DIR, file);
        writeFileSync(outPath, JSON.stringify(snap, null, 0), 'utf-8');
        index.files.push({sub: code, file, sites_count: snap.sites_count, healthy: snap.healthy});
        console.log(`OK ${code}: ${snap.sites_count} sites -> ${path.relative(ROOT, outPath)}`);
    }

    writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2), 'utf-8');
    console.log('done', OUT_DIR);
    console.log('index hash', md5(JSON.stringify(index)).slice(0, 12));
}

main();
