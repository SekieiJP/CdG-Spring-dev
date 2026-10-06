#!/usr/bin/env python3
"""Build the PRO tier report from explicit editorial ratings and existing evidence."""
import csv
import hashlib
import html
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/pro-card-tier'
SOURCE = ROOT / 'game/data/cards_pro.csv'
SHA = lambda b: hashlib.sha256(b).hexdigest()
raw = SOURCE.read_bytes()
short_path = OUT / 'effect-short-texts.json'
short_bytes = short_path.read_bytes()
short_data = json.loads(short_bytes)
assert short_data['cardsSha256'] == SHA(raw)
assert short_data['parserSha256'] == SHA((ROOT / 'game/js/cardManager.js').read_bytes())
short_cards = {c['cardNo']: c for c in short_data['cards']}
assert set(short_cards) == set(range(1, 52))
assert all(c['roundTripVerified'] for c in short_cards.values())
with SOURCE.open(encoding='utf-8-sig', newline='') as handle:
    catalog = {int(row['cardNo']): row for row in csv.DictReader(handle)}
rating_bytes = (OUT / 'editorial-ratings.json').read_bytes()
ratings = json.loads(rating_bytes)
evidence_path = ROOT / 'solver/research-results/pro-card-tier-20261006/evidence.json'
evidence = json.loads(evidence_path.read_text())
assert set(catalog) == set(range(1, 52))
assert sorted(row[0] for row in ratings) == list(range(1, 52))
assert len(evidence['groups']) == 6
assert all(group['n'] == 1000 and len(group['cards']) == 51 for group in evidence['groups'].values())
current_card_version = 'sha256:' + SHA(raw)
assert all(group['versions'][1] == current_card_version for group in evidence['groups'].values())
cards = []
for number, universality, power, comment, adjustment, reason in ratings:
    assert 0 <= universality <= 5 and 0 <= power <= 5
    assert 20 <= len(comment) <= 50, (number, len(comment))
    row = catalog[number]
    assert short_cards[number]['effect'] == row['effectPro'].strip()
    image = ROOT / f'game/data/cardIcon/icon{number:02}.png'
    assert image.is_file()
    samples = {}
    for key, group in evidence['groups'].items():
        item = next(c for c in group['cards'] if int(c['cardNo']) == number)
        samples[key] = {'games': group['n'], 'offeredGames': item['gamesOffered'],
                        'acquiredGames': item['gamesAcquired'], 'drawn': item['drawn'],
                        'placed': item['placed'], 'acquiredSupportAtLeast250': item['gamesAcquired'] >= 250,
                        'placementPerDraw': round(item['placed'] / item['drawn'], 4) if item['drawn'] else None}
    cards.append({'cardNo': number, 'name': row['cardName'], 'category': row['category'],
                  'rarity': row['rarity'], 'effect': row['effectPro'], 'topText': short_cards[number]['topText'], 'sourceTopText': row['topEffectPro'],
                  'universality': universality, 'power': power,
                  'total': round(11 * universality + 9 * power, 1),
                  'comment': comment, 'commentLength': len(comment),
                  'adjustment': adjustment, 'reason': reason,
                  'image': f'../../game/data/cardIcon/icon{number:02}.png',
                  'imageSha256': SHA(image.read_bytes()), 'observations': samples})
cards.sort(key=lambda c: (-c['total'], -c['power'], -c['universality'], c['cardNo']))
for index, card in enumerate(cards):
    card['tier'] = 'SABC'[min(index // 13, 3)]
counts = dict(Counter(c['tier'] for c in cards))
assert counts == {'S': 13, 'A': 13, 'B': 13, 'C': 12}
first, second = [next(c for c in cards if c['cardNo'] == n) for n in [1, 2]]
assert (first['universality'], first['power'], first['total'], first['tier']) == (second['universality'], second['power'], second['total'], second['tier'])
artifact = {'date': '2026-10-06', 'difficulty': 'PRO / 通常', 'cardCount': 51,
            'criteria': {'universalityWeight': .55, 'powerWeight': .45,
                         'formula': 'total = 20 × (0.55 × universality + 0.45 × power)',
                         'ratingScale': '0〜5の編集評点。ゲーム得点の実測増分ではない。',
                         'tierSizes': counts, 'tieBreak': 'power降順、universality降順、cardNo昇順',
                         'rarityBonus': 0},
            'provenance': {'cardsSha256': SHA(raw), 'ranksSha256': SHA((ROOT/'game/data/rankPro.csv').read_bytes()),
                           'editorialSha256': SHA(rating_bytes), 'evidenceSha256': SHA(evidence_path.read_bytes()), 'shortTextsSha256': SHA(short_bytes)},
            'cards': cards}
(OUT / 'card-tiers.json').write_text(json.dumps(artifact, ensure_ascii=False, indent=2) + '\n')
def short_text_markup(value):
    lines = []
    for line in value.splitlines():
        match = re.match(r'^(\[[長講事]+\] ?|〈[^〉]+〉)(.*)', line)
        prefix, body = (match.group(1), match.group(2)) if match else ('', line)
        rendered = f'<span class="short-atom">{html.escape(prefix)}</span>' if prefix else ''
        tokens = body.split(', ') if body else []
        rendered += ''.join(f'<span class="short-atom">{html.escape(token + (", " if i < len(tokens) - 1 else ""))}</span>' for i, token in enumerate(tokens))
        lines.append(rendered)
    return '\n'.join(lines)

labels = {'S': '構築を支える', 'A': '頼れる主力', 'B': '役割が合えば', 'C': '条件を見極める'}
rows = []
for tier in 'SABC':
    buttons = []
    for card in [c for c in cards if c['tier'] == tier]:
        buttons.append(f'''<button class="tile" type="button" data-card="{card['cardNo']}" aria-label="No.{card['cardNo']:02} {html.escape(card['name'])}・{tier}ランク・寸評を読む"><span class="identity">No.{card['cardNo']:02}<span class="rarity {card['rarity']}">{card['rarity']}</span></span><img src="{card['image']}" alt="{html.escape(card['name'])}のイラスト" width="104" height="104"><span class="card-name">{html.escape(card['name'])}</span><span class="card-toptext">{short_text_markup(card['topText'])}</span></button>''')
    rows.append(f'<section class="tier-row"><div class="rank rank-{tier}"><b>{tier}</b><span>{labels[tier]}</span><small>{counts[tier]}枚</small></div><div class="tier-cards">{"".join(buttons)}</div></section>')
page = r'''<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PRO カードティア表</title>
<style>
:root{color-scheme:dark;font-family:"Hiragino Sans","Yu Gothic",Meiryo,sans-serif;background:#10141a;color:#e7ebf0}*{box-sizing:border-box}body{margin:0;padding:24px}main{max-width:1792px;margin:auto}h1,h2,p{margin:0}a{color:#acd9ef}.tools{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 18px}.tools p{font-size:14px;color:#b5bdc9}.download{padding:10px 15px;border:1px solid #526175;border-radius:8px;text-decoration:none;color:#fff;white-space:nowrap}
#tier-chart{background:#1a2029;padding:24px;border:1px solid #3d495a;border-radius:12px}.heading{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:20px}.heading h1{font-size:32px;font-weight:800;letter-spacing:.02em}.eyebrow{font-size:12px;letter-spacing:.2em;color:#bac8d7;margin-bottom:7px}.heading p{font-size:15px;color:#cbd3dd;margin-top:8px}.stamp{text-align:right;font-size:13px;color:#bcc8d5;line-height:1.8;white-space:nowrap}
.tier-row{display:flex;border:1px solid #3b4655;border-bottom:0;background:#131820;min-height:183px}.tier-row:last-of-type{border-bottom:1px solid #3b4655}.rank{flex:0 0 78px;color:#202329;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:7px;padding:9px 4px}.rank b{font-family:Arial,sans-serif;font-size:42px;line-height:1}.rank span{font-size:10px;line-height:1.5;font-weight:700}.rank small{font-size:11px}.rank-S{background:#ed9f97}.rank-A{background:#efc082}.rank-B{background:#e7dc9e}.rank-C{background:#a9cda8}.tier-cards{flex:1;min-width:0;display:grid;grid-template-columns:repeat(13,minmax(0,1fr));align-content:start;padding:7px;gap:5px}.tile{padding:5px 5px 6px;border:1px solid #4d5664;border-radius:4px;min-width:0;background:#f8fafc;color:#212938;font:inherit;display:flex;flex-direction:column;align-items:center;cursor:pointer;-webkit-tap-highlight-color:transparent}.tile:focus-visible{outline:3px solid #9de0ff;outline-offset:2px}.identity{width:100%;display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:750;height:19px;margin-bottom:3px}.rarity{padding:1px 5px;border-radius:4px;background:#e8ebf0;color:#485260;font-size:10px}.rarity.R{background:#d5eaf7;color:#225174}.rarity.SR{background:#efdcff;color:#613788}.rarity.SSR{background:#ffe3ae;color:#745114}.tile img{width:100%;height:auto;aspect-ratio:1;max-width:104px;object-fit:contain;background:#fff}.card-name{display:block;width:100%;font-size:12px;font-weight:700;line-height:17px;min-height:34px;overflow-wrap:anywhere;text-align:center;margin-top:5px}.card-toptext{display:block;width:100%;color:#47566a;font-size:11px;font-weight:400;line-height:16px;text-align:left;white-space:pre-line;overflow-wrap:anywhere;margin-top:6px;padding-top:6px;border-top:1px solid #dce1e8}.short-atom{display:inline-block;white-space:nowrap}
.chart-foot{margin-top:17px;color:#c3ccd9;font-size:12px;line-height:1.9}.chart-foot strong{color:#eff4fc}.notes{margin:24px 0;padding:18px;background:#1a2029;border:1px solid #394656;border-radius:10px;font-size:14px;line-height:1.9}.notes h2{font-size:18px;margin-bottom:8px}.notes p+p{margin-top:10px}.tier-index{margin-top:15px;color:#b8c2d0;font-size:13px;line-height:1.8}
dialog{color:#eff4fa;background:#1d2531;border:1px solid #607083;border-radius:13px;width:min(720px,calc(100% - 24px));max-height:calc(100% - 30px);padding:22px}dialog::backdrop{background:#000b}.close{float:right;background:#293647;color:white;border:1px solid #76889d;border-radius:5px;padding:7px 12px;font:inherit;cursor:pointer}.detail-top{display:flex;gap:19px;align-items:flex-start;margin:15px 0}.detail-top img{width:155px;max-width:35%;background:#fff;border-radius:5px}.detail-top h2{font-size:21px;line-height:1.5;padding-right:15px}.detail-meta{color:#c4cedd;font-size:14px;line-height:2;white-space:pre-line}.detail-top>div{min-width:0;flex:1}.comment{font-size:18px;line-height:1.8;padding:13px;border-left:4px solid #eabf87;background:#141b25}.effect,.reason{font-size:14px;line-height:1.85;margin-top:14px;white-space:pre-wrap}.detail-subtitle{font-size:13px;color:#b3c8dd;margin-top:16px}#sample-grid{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}th,td{text-align:left;padding:6px;border-bottom:1px solid #3b4756;white-space:nowrap}.sample-note{font-size:12px;color:#b8c4d2;line-height:1.7;margin-top:8px}
@media(max-width:1400px){.tier-cards{grid-template-columns:repeat(10,minmax(0,1fr))}}@media(max-width:1000px){.tier-cards{grid-template-columns:repeat(7,minmax(0,1fr))}.heading{display:block}.stamp{text-align:left;margin-top:8px}}@media(max-width:650px){body{padding:10px}#tier-chart{padding:12px}.heading h1{font-size:25px}.heading p{font-size:12px}.rank{flex-basis:42px;padding:4px}.rank b{font-size:28px}.rank span{font-size:9px;writing-mode:vertical-rl}.rank small{font-size:10px}.tier-cards{grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;padding:5px}.identity{font-size:10px}.card-name{font-size:11px;line-height:16px;min-height:32px}.card-toptext{font-size:10px;line-height:15px}.tools{align-items:flex-start}.tools p{font-size:12px}.download{font-size:12px;padding:8px}.stamp{font-size:11px}.detail-top{gap:12px}.detail-top h2{font-size:17px}.comment{font-size:16px}}
@media print{body{padding:0;background:white}.tools,.notes,.tier-index{display:none}#tier-chart{border-radius:0}.tier-cards{grid-template-columns:repeat(13,minmax(0,1fr))}}
</style>
<main><div class="tools"><p>カードをタップすると、寸評・調整案・評価の理由を読めます。</p><a class="download" href="tier-list.png" download>画像を保存</a></div>
<div id="tier-chart"><header class="heading"><div><div class="eyebrow">CDG SPRING / PRO</div><h1>PRO カードティア表</h1><p>汎用性 55% ＋ 適切な場面でのカードパワー 45%</p></div><div class="stamp">2026.10.06<br>全レアリティ共通評価・基本カード含む</div></header>
__ROWS__
<footer class="chart-foot"><strong>全51枚：S 13 / A 13 / B 13 / C 12</strong>　同じランク内は総合評点順。レア度の加点はありません。<br>一発勝負はリセマラなし。15点挑戦での反復・コンボ価値も評価。実測記録＋実際の効果＋攻略上の判断から評点を付けています。<br>短縮表示は実効果から生成。長=室長・講=講師・事=事務。体=体験・入=入塾・満=満足・経=経理。<br>［］は配置制限、〈〉は発動条件（基本効果に追加）。[!]は支払い、×は個数。🤹=並行・✊=情熱・💡=発想・🗑️=整理・💤=疲労。</footer></div>
<section class="notes"><h2>この表の読み方</h2><p>汎用性は、役割の広さ・配置枠の競合・発動条件と支払い・序盤から終盤までの使いやすさを0〜5で評価。パワーは、準備を整えて使う場合の得点閾値への寄与、退塾回避、繰り返し使うドローや追加取得の成長力を0〜5で評価しています。</p><p>総合評点＝20×（汎用性×0.55＋パワー×0.45）。全51枚をまとめて高い順に13・13・13・12枚へ区切りました。基本カードも同じ基準です。境界付近は小差なので、隣のランクと厳密な優劣が決まったと読むより、手持ちとの相性を見てください。</p><p>6方略各1,000ゲームの旧検証、3,000ゲームの追加観測、取得を変える局面比較を参照しました。観測の取得率・配置率をそのまま因果的な強さには換算せず、取得ゲーム250未満の個別セルは少数として扱います。評点はゲーム得点の実測増分ではありません。</p><p>ゲームバランスの提案はPROについての寸評です。カード数値は変更していません。短縮表示は全51枚を本体の効果パーサーから生成し、再解析で数値・配置制限・条件・トークン数を照合しています。</p><p><a href="../CdG-PRO-Card-Tier.md">全51枚の寸評と評価基準</a>　／　<a href="card-tiers.json">全カードの評価データ</a>　／　<a href="../../outputs/01a10fbf-c498-7bb2-bf3d-5e58ead6df06/PRO-Card-Tier.xlsx">Excelブック</a></p></section>
<div class="tier-index">レア度ではなく、使える場面と狙える働きの両方で見るための攻略メモ。No.01とNo.02は同じ効果なので同じ評価です。</div>
</main><dialog id="detail" aria-labelledby="detail-name"><button class="close" type="button">閉じる</button><div class="detail-top"><img id="detail-image" alt=""><div><h2 id="detail-name"></h2><div id="detail-meta" class="detail-meta"></div></div></div><p id="detail-comment" class="comment"></p><p id="detail-effect" class="effect"></p><p id="detail-reason" class="reason"></p><p class="detail-subtitle">過去の6方略の観測（条件付き使用率は少数セルを非表示）</p><div id="sample-grid"></div><p class="sample-note">6方略は同じ1,000開始を共有。これらの値はその方略が選んだ結果を含み、カード単独の得点増分ではありません。基本カードの取得は初期配布です。</p></dialog>
<script type="application/json" id="tier-data">__DATA__</script>
<script>
const report=JSON.parse(document.getElementById('tier-data').textContent),byNo=new Map(report.cards.map(c=>[c.cardNo,c]));
const names={'control':'基準','full-median':'安定','full-ceiling':'高得点目標','full-engine':'回転重視','acq-ceiling':'取得のみ高得点','delete-basic':'基本札の削除'};
const detail=document.getElementById('detail');document.querySelectorAll('[data-card]').forEach(button=>button.addEventListener('click',()=>{
 const c=byNo.get(Number(button.dataset.card));document.getElementById('detail-image').src=c.image;document.getElementById('detail-image').alt=c.name;
 document.getElementById('detail-name').textContent='No.'+String(c.cardNo).padStart(2,'0')+' '+c.name;
 document.getElementById('detail-meta').textContent=c.tier+'ランク ／ '+c.rarity+' ／ '+c.category+'\n汎用性 '+c.universality.toFixed(1)+'・パワー '+c.power.toFixed(1)+'・総合 '+c.total.toFixed(1);
 document.getElementById('detail-comment').textContent=c.comment;document.getElementById('detail-effect').textContent='実際の効果\n'+c.effect;
 document.getElementById('detail-reason').textContent='評価の理由と調整案（'+c.adjustment+'）\n'+c.reason;
 const table=document.createElement('table'),head=document.createElement('tr');for(const value of ['方略','取得ゲーム','配置／ドロー']){const th=document.createElement('th');th.textContent=value;head.append(th);}table.append(head);
 for(const [key,o] of Object.entries(c.observations)){const row=document.createElement('tr');for(const value of [names[key],o.acquiredGames+'/1000',o.acquiredSupportAtLeast250&&o.placementPerDraw!==null?(o.placementPerDraw*100).toFixed(1)+'%':'少数：集計値は参考扱い']){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}table.append(row);}
 document.getElementById('sample-grid').replaceChildren(table);detail.showModal();
}));detail.querySelector('.close').addEventListener('click',()=>detail.close());detail.addEventListener('click',event=>{if(event.target===detail){const r=detail.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)detail.close();}});
</script></html>'''
page = page.replace('__ROWS__', '\n'.join(rows)).replace('__DATA__', json.dumps(artifact, ensure_ascii=False).replace('</', '<\\/'))
(OUT / 'index.html').write_text(page)
report = '''# PRO・全51カードのティア表と寸評

2026-10-06。通常PROを対象に、基本カードを含む全51枚をレア度の加点なしでまとめた。S/A/Bは各13枚、Cは12枚。[画像版](pro-card-tier/tier-list.png)と[カードをタップして読む版](pro-card-tier/index.html)、[寸評・調整案・評価基準のExcelブック](../outputs/01a10fbf-c498-7bb2-bf3d-5e58ead6df06/PRO-Card-Tier.xlsx)を用意した。画像には既存のカードイラストを使い、[TierMaker](https://tiermaker.com/)を参考に4段の体裁で並べている。

## 評価基準

総合評点＝**20×（汎用性U×0.55＋カードパワーP×0.45）**。U・Pはともに0〜5。取得回数だけで決めず、実測・実効果・攻略上の判断を合わせて付けた編集評点であり、ゲームの得点増分そのものではない。

| 評点 | 主に見ること | 高く評価する例 |
| --- | --- | --- |
| 汎用性U | 多くの構築での役割、置き場と通常枠の競合、支払いと発動条件、使える時期 | 安定・成長・回転の複数方略につながり、引いた札を置き切れる |
| パワーP | 適切な準備をした時の得点閾値と退塾回避への寄与、繰り返し使う成長、後続のドロー・追加取得・圧縮 | 体験と入塾を大きく伸ばす、コスト札の反復を支える、序盤からエンジンを回す |

パワーは「極端な閾値の直前で一度だけ使った最大加点」より、条件が整った構築でゲーム全体をどれだけ伸ばせるかを重くした。満足や経理の減点回避、並行による配置数、情熱・発想による後続も含める。一発勝負はリセマラなし。15点挑戦では序盤の反復価値も見るが、リセマラによる取得保証を汎用性に加算しない。

全51枚を総合評点の高い順に13/13/13/12枚へ区切る。同点はP→U→Noの順。同じ名前・効果の基本No1/2は同じ評点・ランク。レアリティごとに順位を分けたり、SSRを優遇したりしない。境界の小差は統計的に優劣を確定した差ではないので、具体的な手持ちでは隣接ランクも候補に残す。

## 参照した記録

- [6方略各1,000ゲームの検証](../solver/research-results/pro-strategy-20261003/validation.json)：基準、安定、高得点目標、回転、取得のみ変更、基本札の削除。共通の1,000開始を使った延べ6,000完走。今回の[51枚×6方略の記述集計](../solver/research-results/pro-card-tier-20261006/evidence.json)は元記録から再集計し、本体・カード・得点表・完走・リセマラなし・重複を確認した。
- [3,000開始の追加観測](../solver/research-results/pro-mean125-20261004/card-observation-candidates.json)：取得機会、ドロー、配置先、実際の増分、トークンの使われ方を参照。一覧は取得250ゲーム以上の観測候補が中心で、全カードの因果的な順位を測ったものではない。
- [No43/51の取得対照・各500局面](../solver/research-results/pro-mean125-20261004/card-scenes-development-trials.json)、[No45/47/49の取得対照・各500局面](../solver/research-results/pro-mean125-20261004/card-growth-development-trials.json)、[250以上を満たす条件別比較](../solver/research-results/pro-mean125-20261004/card-growth-subgroups.json)、[攻略方針](CdG-PRO-Strategy-Guide.md)、[実際の14/16点の判断例](CdG-PRO-Decision-Examples.md)。

取得・配置の頻度は方略の選び方に左右されるので、数値をそのまま因果パワーやUの自動点数にしない。取得ゲーム250未満の個別セルや条件別250局面未満は少数として扱い、仕様と相性を中心に判断した。新しいゲーム試行は行っていない。局面比較は別札を取った場合との差であり、基礎からのカード単独の点数ではない。

## この表で特に大切にしたこと

並行のトーク・清掃・兄弟紹介・ファイリングは、通常枠を残して成長や安全を重ねられるため上位。手紙は満足15を作れた時の反復力を評価する一方、未成立や最終ターンの弱さはUで差し引いた。派遣は経理が崩れた時のPを高くし、健康な経理では役割が薄く、14止まりである点をUに反映した。

公開模試の柔軟さは高く評価したが、500局面の取得比較で他の候補に対する平均差は−0.034点とほぼ同等だった。手紙も全500局面では+0.040点に留まり、旧方略が選んだ400局面では+0.245点。CMとリフォームの大きい効果は認めつつ、500局面で平均差−0.618/−1.342点だった支払い・疲労の重さを総合評価へ反映した。これらは比較した局面・後続方略についての結果。

画像とブックの短縮表示は本体パーサーの実効果から作成した。大抽選会は「体験3・満足7・経理−1」で掲載し、全51枚の数値・配置制限・発動条件・トークン数を再解析して照合した。バランス案はPROへの感想であり、カード数値の変更はしていない。Cにも序盤の基礎や特定局面の切り札があり、不要札という意味ではない。

## 全カードの寸評

各寸評は29〜34文字（日本語の文字数）で、調整方向も文中に含めた。U/P/総合は比較用の評点。ティア内は総合順に掲載。

'''
for tier in 'SABC':
    report += f"### {tier}ランク・{labels[tier]}（{counts[tier]}枚）\n\n| No | カード | レア | U | P | 総合 | 寸評・調整案 |\n| --- | --- | --- | ---: | ---: | ---: | --- |\n"
    for c in [c for c in cards if c['tier'] == tier]:
        report += f"| {c['cardNo']:02} | {c['name']} | {c['rarity']} | {c['universality']:.1f} | {c['power']:.1f} | {c['total']:.1f} | {c['comment']} |\n"
    report += '\n'
report += '''## バランス調整で増やしたい選択肢

上位の並行という楽しさは残し、通常枠を使う札にも置く理由を作りたい。トーク・清掃・実績掲示を少し抑える案と、発動窓が短い補習、室長専用の通信、負担が重いCM・リフォームを使いやすくする案を組み合わせる。経理回復の土台を一律に弱めるより、支払いをどの札で支えるかを選べる方が構築の幅を作りやすい。

調整方向は寸評としての提案。実際に数値を変更する際は、取得・配置・削除の条件をそろえた全250開始以上の比較で、平均・S+率・15点率・退塾を再確認する。

[全評点・理由・実効果・51画像の指紋](pro-card-tier/card-tiers.json)。再生成元は[編集評点](pro-card-tier/editorial-ratings.json)。

## 再生成と表示確認

`node solver/build-pro-card-short-texts.mjs`で実効果に合う短縮表示を生成し、`python3 solver/build-pro-card-tier.py`で本文・評価JSON・HTMLを再生成する。`npm ci`済みの環境で`node solver/render-pro-card-tier.mjs`を実行すると、画像を書き出し、全51枚の詳細と390px幅の表示、画像・リンク・寸評の完全性を確認する。[表示確認記録](../solver/research-results/pro-card-tier-20261006/artifact-audit.json)には実行できたブラウザエンジンも記録した。今回の確認はChromium。WebKitは実行ファイルがないため未実施で、Safari実機での確認とは異なる。

記述集計をやり直す場合は、保存済み原記録を持つチェックアウトを引数に`node solver/collect-pro-card-tier-evidence.mjs <原記録を持つリポジトリ>`を実行してから上記2手順を行う。この集計も画像の確認も、新しいゲーム試行は実行しない。原記録は公開リポジトリに含めず、資料には集計と指紋を残した。
'''
(ROOT / 'docs/CdG-PRO-Card-Tier.md').write_text(report)
print(json.dumps({'cards': len(cards), 'tiers': counts, 'commentMin': min(c['commentLength'] for c in cards),
                  'commentMax': max(c['commentLength'] for c in cards), 'rarities': dict(Counter(c['rarity'] for c in cards))}, ensure_ascii=False))
