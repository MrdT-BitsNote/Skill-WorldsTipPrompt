# Skill-WorldsTipPrompt

WorldsTip 提示词优化 —— 一份真源，两种形态：

- **技能包**（`skill/`）：任意支持 `SKILL.md` 的 Agent 可用，已按 SkillHub 规范打包；
- **DSH 插件**（`plugin/`）：DeepSeek Harness 输入框的「优化」按钮，或 `/polish <文本>` 命令。

两者共用同一套改写规则，`skill/references/rewrite-prompt.md` 与 `plugin/index.js` 的系统提示词同源。

## 目录结构

```text
.
├── skill/                 # 技能真源（SKILL.md 在根）
│   ├── SKILL.md
│   └── references/
│       ├── modes.md           四种模式细则
│       ├── examples.md        6 组对照 + 7 种失败模式
│       ├── rewrite-prompt.md  固定改写指令（与插件同源）
│       └── dsh-plugin.md      插件形态说明
├── plugin/                # DSH bundle
│   ├── package.json
│   ├── cordis.patch.yml       # 含可配置项示例
│   ├── index.js               # /polish 命令 + 模型调用
│   ├── client.js              # 输入框按钮
│   ├── locale/                # 中英文案
│   └── docs/DETAIL.md
├── evals/                 # 回归用例（开发资产，不进发布包）
│   ├── cases.json             技能 6 条
│   ├── cases-plugin.json      插件 4 条
│   └── README.md              指标与复跑方式
├── tools/eval_prompt_polish.py  打分器（不调用模型）
├── docs/overview.md       # 技能概述（可用于商店详情页）
└── sync.ps1               # 从工作区真源同步到本仓库
```

## 快速开始

### 技能（SkillHub / 任意 Agent）

把 `skill/` 目录放进 Agent 的 skills 目录即可：

```text
<skills-dir>/worldstip-prompt-polish/SKILL.md
```

SkillHub 安装需带 `--dir`：

```powershell
skillhub install worldstip-prompt-polish --dir <Agent 的 skills 目录>
```

触发说法：`帮我优化提示词`、`这句怎么问更清楚`、`这段 prompt 有问题吗`、`按结构写`、`压缩成一句`。

### 插件（DeepSeek Harness）

在 DSH 的插件管理器里安装本目录下的 `plugin/`（本地目录安装），或用配置补丁插入一行：

```yaml
- insert:
    - id: dsh-prompt-polish
      name: 'dsh-prompt-polish'
      config:
        model: deepseek-v4-flash   # 可选
        temperature: 0.2           # 可选
        maxTokens: 1024            # 可选
        mode: clarity              # clarity | structured | detail | brief
```

安装后输入框工具行出现「优化」按钮；也可直接输入 `/polish <文本>`。

## 评测

```powershell
chcp 65001 > $null
$env:PYTHONIOENCODING = 'utf-8'
python tools/eval_prompt_polish.py --cases evals/cases.json --outputs <采样结果.json>
python tools/eval_prompt_polish.py --cases evals/cases-plugin.json --outputs <采样结果.json>
```

采样结果需要自己产生（技能规则或插件提示词跑一遍用例，存成 `{case_id: 改写结果}` 的 JSON），打分器不调用模型。指标定义见 `evals/README.md`。

## 版本

| 组件 | 版本 | 说明 |
|---|---|---|
| 技能 | 1.0.1 | 意图分诊、四种模式、单轮执行、事实清单核对 |
| 插件 | 1.0.0 | `/polish` 命令 + 输入框按钮 + 可配置模型/温度/长度/模式 |

## 许可

MIT，见 `LICENSE`。
