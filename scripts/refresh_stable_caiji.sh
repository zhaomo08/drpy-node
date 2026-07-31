#!/usr/bin/env bash
# 探测公开采集站 JSON 接口，重写 json/采集*.json（稳定源列表）
# 用法: bash scripts/refresh_stable_caiji.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

python3 - <<'PY'
import json, subprocess, re
from pathlib import Path

candidates = [
  ("量子资源", "https://cj.lziapi.com", "/api.php/provide/vod", ""),
  ("光速资源", "https://api.guangsuapi.com", "/api.php/provide/vod", ""),
  ("暴风资源", "https://bfzyapi.com", "/api.php/provide/vod", ""),
  ("红牛资源", "https://www.hongniuzy2.com", "/api.php/provide/vod", ""),
  ("索尼资源", "https://suoniapi.com", "/api.php/provide/vod", ""),
  ("电影天堂", "http://caiji.dyttzyapi.com", "/api.php/provide/vod", ""),
  ("茅台资源", "https://caiji.maotaizy.cc", "/api.php/provide/vod", "https://mtjiexi.cc:966/?url="),
  ("无尽资源", "https://api.wujinapi.me", "/api.php/provide/vod", ""),
  ("IKUN资源", "https://ikunzyapi.com", "/api.php/provide/vod", ""),
  ("360资源", "https://360zy.com", "/api.php/provide/vod", "https://www.360jiexi.com/player/?url="),
  ("360资源备", "https://360zyzz.com", "/api.php/provide/vod", "https://www.360jiexi.com/player/?url="),
  ("U酷资源", "https://api.ukuapi88.com", "/api.php/provide/vod", "https://api.ukubf.com/m3u8/?url="),
  ("极速资源", "https://jszyapi.com", "/api.php/provide/vod", "https://jsjiexi.com/play/?url="),
  ("豪华资源", "https://hhzyapi.com", "/api.php/provide/vod", "https://hhjiexi.com/play/?url="),
  ("虎牙资源", "https://www.huyaapi.com", "/api.php/provide/vod", "https://huyajx.com/play?url="),
  ("魔都资源", "https://www.mdzyapi.com", "/api.php/provide/vod", "https://jiexi.moduzyjx.com/?url="),
  ("爱奇艺资源", "https://iqiyizyapi.com", "/api.php/provide/vod", "https://www.iqiyizyjx.com/?url="),
  ("天涯资源", "https://tyyszyapi.com", "/api.php/provide/vod", ""),
  ("快车资源", "https://caiji.kuaichezy.org", "/api.php/provide/vod", ""),
  ("快车资源备", "https://www.kuaichezy.com", "/api.php/provide/vod", ""),
  ("闪电影视", "https://sdzyapi.com", "/api.php/provide/vod", ""),
  ("樱花资源", "https://m3u8.apiyhzy.com", "/api.php/provide/vod", ""),
  ("如意资源", "https://cj.rycjapi.com", "/api.php/provide/vod", ""),
  ("百度资源", "https://api.apibdzy.com", "/api.php/provide/vod", ""),
  ("丫丫资源", "https://cj.yayazy.net", "/api.php/provide/vod", ""),
  ("速播资源", "https://subocaiji.com", "/api.php/provide/vod", "https://subojiexi.com/play/?url="),
  ("最大资源", "https://zuida.xyz", "/api.php/provide/vod", "https://jx.zuidplay.com/m3u8Player/?url="),
  ("豆瓣资源", "https://caiji.dbzy5.com", "/api.php/provide/vod", "https://doubanzyjx.com:966/?url="),
  ("猫眼资源", "https://api.maoyanapi.top", "/api.php/provide/vod", "https://jx.maoyanjx.top/player/?url="),
  ("金鹰资源", "https://jyzyapi.com", "/provide/vod", "https://hd.iapijy.com/play?url="),
  ("CK资源", "https://ckzy.me", "/api.php/provide/vod", ""),
]

DEFAULT_EXCLUDE = "电影|连续剧|综艺|动漫|电影片|综艺片|动漫片|资讯|新闻资讯|预告片|影视资讯|明星资讯|娱乐新闻|电影资讯|体育|未分类|伦理|福利"

def fetch(url: str):
    try:
        out = subprocess.check_output(
            ["curl", "-sL", "--max-time", "10", "-A", "Mozilla/5.0", url],
            stderr=subprocess.DEVNULL,
        )
        return json.loads(out.decode("utf-8", "replace"))
    except Exception:
        return None

results = []
for name, base, api, parse in candidates:
    join = "&" if "?" in api else "?"
    url = base.rstrip("/") + api + join + "ac=list"
    data = fetch(url)
    if not data or not isinstance(data, dict) or not data.get("list"):
        print("FAIL", name)
        continue
    classes = data.get("class") or []
    if not classes:
        data2 = fetch(base.rstrip("/") + api)
        if isinstance(data2, dict):
            classes = data2.get("class") or []
    names, ids = [], []
    for c in classes:
        n = str(c.get("type_name") or c.get("name") or "").strip()
        i = str(c.get("type_id") or c.get("id") or "").strip()
        if not n or not i:
            continue
        if re.search(r"伦理|福利|情色|色情|成人|两性|写真|美女|里番", n):
            continue
        names.append(n)
        ids.append(i)
    item = {
        "name": name,
        "url": base,
        "api": api,
        "parse_url": parse,
        "cate_exclude": DEFAULT_EXCLUDE,
        "_total": data.get("total") or 0,
    }
    if names and ids:
        item["class_name"] = "&".join(names)
        item["class_url"] = "&".join(ids)
    results.append(item)
    print(f"OK total={item['_total']} classes={len(names)} {name}")

# dedupe host
seen, uniq = set(), []
for it in sorted(results, key=lambda x: -(x.get("_total") or 0)):
    if it["url"] in seen:
        continue
    seen.add(it["url"])
    it.pop("_total", None)
    uniq.append(it)

top_names = {
    "暴风资源", "量子资源", "索尼资源", "茅台资源", "豆瓣资源", "快车资源", "最大资源",
    "闪电影视", "无尽资源", "光速资源", "红牛资源", "虎牙资源", "极速资源", "魔都资源",
    "电影天堂", "如意资源",
}
top = [x for x in uniq if x["name"] in top_names]

Path("json/采集2026静态.json").write_text(json.dumps(uniq, ensure_ascii=False, indent=2), encoding="utf-8")
Path("json/采集2025静态.json").write_text(json.dumps(uniq[:22], ensure_ascii=False, indent=2), encoding="utf-8")
Path("json/采集静态.json").write_text(json.dumps(top, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"written 2026={len(uniq)} 2025={min(22,len(uniq))} static={len(top)}")
PY

echo "done"