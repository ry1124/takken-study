# -*- coding: utf-8 -*-
"""テキスト(Markdown)と毎日の計画(make_plan.py が作る plan.json)から、アプリ用の js/data.js を作る。
テキストを追加・修正したら data_src に .md を置いてこのスクリプトを実行し、version.js を上げて公開する。"""
import html
import json
import re
from pathlib import Path


HERE = Path(__file__).parent
APP = HERE.parent
PLAN_JSON = HERE / "plan.json"   # make_plan.py が作る

# 科目の一覧。md がまだ無い科目は「準備中」として表示する
SUBJECTS = [
    {"id": "gyoho", "name": "宅建業法", "file": "01_gyoho.md", "when": "10/16〜11/21"},
    {"id": "horei", "name": "法令上の制限", "file": "02_horei.md", "when": "11/23〜12/19"},
    {"id": "kenri", "name": "権利関係", "file": "03_kenri.md", "when": "12/21〜2/6"},
    {"id": "zei", "name": "税・その他", "file": "04_zei.md", "when": "2/8〜2/27"},
]

# 計画表の「今日のテーマ」に出てくる単元名(計画作成時の並び)。章番号と同じ順番
PLAN_TOPICS = {
    "gyoho": ["宅建業の定義（宅地・建物・取引・業）", "免許の種類・免許換え・届出", "免許の欠格事由",
              "事務所・案内所・標識・帳簿", "宅建士の登録・宅建士証", "登録の移転・変更の登録",
              "営業保証金", "保証協会（弁済業務保証金）", "媒介契約（一般・専任・専属専任）",
              "広告の規制・取引態様の明示", "重要事項説明（35条）基本", "重要事項説明（35条）区分所有・貸借",
              "37条書面（契約書）", "8種制限：クーリング・オフ", "8種制限：手付金等の保全措置",
              "8種制限：損害賠償額の予定・手付・他人物売買", "8種制限：担保責任の特約・割賦販売",
              "報酬額の制限（売買）", "報酬額の制限（貸借）", "その他の業務上の規制（禁止行為）",
              "監督処分・罰則", "住宅瑕疵担保履行法"],
}


def inline(text):
    t = html.escape(text, quote=False)
    return re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)


def md_to_html(md):
    """このテキストで使っている書式(見出し・段落・箇条書き・番号付き・入れ子・表・太字)だけを変換する"""
    out, lines, i = [], md.split("\n"), 0
    while i < len(lines):
        ln = lines[i]
        if not ln.strip():
            i += 1
            continue
        if ln.startswith("### "):
            out.append(f"<h3>{inline(ln[4:])}</h3>")
            i += 1
        elif ln.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            head, body = rows[0], [r for r in rows[1:] if not all(re.fullmatch(r"-+", c) for c in r)]
            t = "<div class='table-wrap'><table><thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead><tbody>"
            t += "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in body)
            out.append(t + "</tbody></table></div>")
        elif re.match(r"^(- |\d+\. )", ln):
            items = []
            while i < len(lines) and re.match(r"^( {4})?(- |\d+\. )", lines[i]):
                sub = lines[i].startswith("    ")
                m = re.match(r"^(?: {4})?(- |\d+\. )(.*)$", lines[i])
                kind = "ul" if m.group(1) == "- " else "ol"
                if sub and items:
                    items[-1]["sub"].append((kind, m.group(2)))
                else:
                    items.append({"kind": kind, "text": m.group(2), "sub": []})
                i += 1
            tag = items[0]["kind"]
            s = f"<{tag}>"
            for it in items:
                s += f"<li>{inline(it['text'])}"
                if it["sub"]:
                    st = it["sub"][0][0]
                    s += f"<{st}>" + "".join(f"<li>{inline(x)}</li>" for _, x in it["sub"]) + f"</{st}>"
                s += "</li>"
            out.append(s + f"</{tag}>")
        else:
            out.append(f"<p>{inline(ln)}</p>")
            i += 1
    return "\n".join(out)


def parse_quiz(block, chap_id):
    """「### 確認問題」節から、問題文と答え・解説を取り出す"""
    qs = re.findall(r"^\d+\. (.+)$", block, re.M)
    ans_line = re.search(r"\*\*答え\*\*：(.+)$", block, re.M).group(1)
    answers = {}
    for m in re.finditer(r"(\d+) ([○×])(?:（(.*?)）)?", ans_line):
        answers[int(m.group(1))] = (m.group(2) == "○", m.group(3) or "")
    assert len(qs) == len(answers), f"{chap_id}: 問題{len(qs)}問と答え{len(answers)}個が合わない"
    return [{"id": f"{chap_id}-q{n}", "q": q, "a": answers[n][0], "exp": answers[n][1]}
            for n, q in enumerate(qs, 1)]


def load_questions():
    """data_src/questions/*.txt の問題(本試験レベル・解説つき)を、章idごとに読み込む"""
    bank = {}
    for path in sorted((HERE / "questions").glob("*.txt")):
        cur = None
        for block in re.split(r"\n\s*\n", path.read_text(encoding="utf-8")):
            m = re.search(r"^## (\S+)", block, re.M)
            if m:
                cur = m.group(1)
                bank.setdefault(cur, [])
            if not re.search(r"^Q: ", block, re.M):
                continue
            q = re.search(r"^Q: (.+)$", block, re.M).group(1).strip()
            a = re.search(r"^A: ([○×])", block, re.M).group(1)
            e = re.search(r"^E: (.+)", block, re.M | re.S).group(1).strip()
            n = len(bank[cur]) + 1
            bank[cur].append({"id": f"{cur}-h{n:02d}", "q": q, "a": a == "○", "exp": e})
    return bank


QUESTION_BANK = load_questions()

EXAM_TYPES = {"正": "正しいものはどれか", "誤": "誤っているものはどれか", "数": "正しいものはいくつあるか"}


def load_exam():
    """data_src/exam/*.txt の本試験形式(4択)の問題を、章idごとに読み込む。答えは各選択肢の○×から決める"""
    bank = {}
    for path in sorted((HERE / "exam").glob("*.txt")):
        cur = None
        for block in re.split(r"\n\s*\n", path.read_text(encoding="utf-8")):
            m = re.search(r"^## (\S+)", block, re.M)
            if m:
                cur = m.group(1)
                bank.setdefault(cur, [])
            if not re.search(r"^T: ", block, re.M):
                continue
            typ = re.search(r"^T: (\S)", block, re.M).group(1)
            stem = re.search(r"^S: (.+)$", block, re.M).group(1).strip()
            opts = [{"label": mm.group(1), "ok": mm.group(2) == "○", "t": mm.group(3).strip(), "e": mm.group(4).strip()}
                    for mm in re.finditer(r"^([1-4ア-エ])([○×]) (.+)\nE: (.+)$", block, re.M)]
            qid = f"{cur}-e{len(bank[cur]) + 1:02d}"
            assert len(opts) == 4, f"{qid}: 選択肢が{len(opts)}個"
            n_ok = sum(o["ok"] for o in opts)
            if typ == "正":
                assert n_ok == 1, f"{qid}: 正しいものが{n_ok}個"
                ans = next(i for i, o in enumerate(opts) if o["ok"]) + 1
            elif typ == "誤":
                assert n_ok == 3, f"{qid}: 誤っているものが{4 - n_ok}個"
                ans = next(i for i, o in enumerate(opts) if not o["ok"]) + 1
            else:
                assert n_ok >= 1, f"{qid}: 正しいものが0個"
                ans = n_ok   # 「一つ」〜「四つ」のどれか
            bank[cur].append({"id": qid, "kind": "exam", "type": typ, "lead": EXAM_TYPES[typ],
                              "stem": stem, "opts": opts, "ans": ans})
    return bank


EXAM_BANK = load_exam()


def build_subject(sub):
    path = HERE / sub["file"]
    if not path.exists():
        return {**{k: sub[k] for k in ("id", "name", "when")}, "ready": False, "intro": "", "chapters": []}
    md = path.read_text(encoding="utf-8")
    sections = re.split(r"^## ", md, flags=re.M)[1:]
    intro, chapters = "", []
    for sec in sections:
        title, body = sec.split("\n", 1)
        m = re.match(r"第(\d+)章 (.+)", title)
        if not m:
            intro = md_to_html(body)
            continue
        no = int(m.group(1))
        cid = f"{sub['id']}-{no:02d}"
        parts = re.split(r"^### 確認問題.*$", body, flags=re.M)
        lead = parts[0].strip().split("\n", 1)[0]
        chapters.append({"id": cid, "no": no, "title": m.group(2), "lead": lead,
                         "html": md_to_html(parts[0]),
                         # 問題集があればそれを使い、なければテキスト末尾の確認問題を使う
                         "quiz": QUESTION_BANK.get(cid) or (parse_quiz(parts[1], cid) if len(parts) > 1 else []),
                         "exam": EXAM_BANK.get(cid, [])})
    return {**{k: sub[k] for k in ("id", "name", "when")}, "ready": True, "intro": intro, "chapters": chapters}


def chapter_links(theme, subjects):
    """計画の「今日のテーマ」に出てくる単元から、対応する章のidを返す"""
    ids = []
    for sid, topics in PLAN_TOPICS.items():
        for n, t in enumerate(topics, 1):
            if t in theme:
                ids.append(f"{sid}-{n:02d}")
    ready = {c["id"] for s in subjects for c in s["chapters"]}
    return [i for i in ids if i in ready]


def build_plan(subjects):
    """make_plan.py が作った plan.json に、その日に読む章を結びつける"""
    days = json.loads(PLAN_JSON.read_text(encoding="utf-8"))
    for p in days:
        p["ch"] = chapter_links(p["theme"] + p["todo"], subjects)
    return days


subjects = [build_subject(s) for s in SUBJECTS]
plan = build_plan(subjects)
data = {"exam": "2027-10-17", "subjects": subjects, "plan": plan}
(APP / "js" / "data.js").write_text(
    "// build_data.py が作るデータ(手で編集しない)\nconst TAKKEN_DATA = " + json.dumps(data, ensure_ascii=False) + ";\n",
    encoding="utf-8")
nq = sum(len(c["quiz"]) for s in subjects for c in s["chapters"])
ne = sum(len(c["exam"]) for s in subjects for c in s["chapters"])
linked = sum(1 for p in plan if p["ch"])
print(f"章 {sum(len(s['chapters']) for s in subjects)} / 一問一答 {nq} / 本試験形式 {ne} / 計画 {len(plan)}日（章と結びついた日 {linked}）")
