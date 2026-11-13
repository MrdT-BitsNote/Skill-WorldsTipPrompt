# Prompt-polish 回归评测

用固定用例给「提示词优化」打分，覆盖两个载体：

- `cases.json` — 技能（`worldstip-prompt-polish`）6 条，含意图分诊场景；
- `cases-plugin.json` — DSH 插件 `/polish` 4 条，只测改写（插件不做意图分诊）。

评测本身不调用模型：它给「用例 id → 改写结果」的 JSON 打分，所以同一套用例可以跑技能、跑插件、也可以人工抽样。

## 指标

| 指标 | 定义 | 目标 |
|---|---|---|
| 事实保留率 | `must` 里每个 token（路径、标识符、报错、数字）都出现在输出 | 1.0 |
| 凭空新增 | `forbidden` 里的内容（原文没有的技术栈/字段等）不得出现 | 0 |
| 意图判定 | 评估类用例须命中 `must_any`（如"问题/冗余/不可验收"） | 通过 |
| 膨胀预算 | 输出比输入多出的字符数 ≤ `add_max`（按类型 30–400） | 不超 |
| 语言 | 中文用例 CJK 占比 > 0.3；英文用例 0 个 CJK 字符 | 通过 |

> 用绝对字符预算而不是长度倍数：短草稿加一个"验收"小标题就会是 3 倍，按倍数会误杀。

## 跑一次

在 workbox 根目录执行：

```powershell
chcp 65001 > $null
$env:PYTHONIOENCODING = 'utf-8'

python tools\eval_prompt_polish.py --cases evals\prompt-polish\cases.json --outputs evals\prompt-polish\outputs.json
python tools\eval_prompt_polish.py --cases evals\prompt-polish\cases-plugin.json --outputs evals\prompt-polish\outputs-plugin.json
```

`--json` 输出完整明细；退出码 0 表示全部通过。

## 采样方式

`outputs.json` / `outputs-plugin.json` 是 2026-11-13 的一次真实采样：

- 技能：把 SKILL.md 第 1–6 节作为指令交给模型，一次性处理 6 条用例；
- 插件：把 `index.js` 里的 `SYSTEM_PROMPT` + clarity 模式指令交给模型，处理 4 条用例。

要重新采样，按上面两种方式再做一次，把结果写成同样的 JSON 结构即可。

## 基线（2026-11-13）

| 载体 | 用例 | 通过 | 事实保留 | 凭空新增 |
|---|---|---|---|---|
| 技能 `worldstip-prompt-polish` v1.0.1 | 6 | 6 | 1.0 | 0 |
| 插件 `dsh-prompt-polish`（config 支持后） | 4 | 4 | 1.0 | 0 |

## 注意

- 采样是一次性结果，不是稳定复现；它证明"规则能跑出预期形态"，不证明每次都对。
- 用例集只有 10 条，覆盖 6 类场景；新增失败案例时优先往 `cases.json` 里加，而不是改阈值。
- 改 `add_max` 等于改验收标准，改动要说明理由。
