# 贡献指南（快速上手）

OpenCard DB 的卡片数据**只接受 Pull Request（PR）**，没有公开写入 API。根据你愿意
使用多少工具，从下面三条路径中任选其一，最终都会生成一个由自动检查审阅的 PR。

英文完整版见 [CONTRIBUTING.md](../CONTRIBUTING.md)；领域规则见
[docs/contributing.md](contributing.md)；校验报错对照见 [docs/faq.md](faq.md)；
社区行为准则见 [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)。

> **一个 PR 只加一张卡。** 审阅更快、来源更清晰、冲突更少。

---

## 路径 A — 不用任何工具（机器人替你写 PR）

适合不写代码、只想收录某张卡的人。

1. 新建 Issue，选择 **“Request a card / 求收录卡片”** 模板。
2. 填写国家（us/ca/cn）、卡片名称、发卡行、官方产品页链接；可选：条款链接、卡面
   链接、备注。
3. 提交后，机器人会解析表单并自动生成一个**草稿 PR**（draft），并在 Issue 下回复
   链接。

草稿只是起点，占位字段仍需填入真实且有官方来源的数据后，维护者才能合并。你或维护者
可直接在该 PR 上补全。

## 路径 B — 只用浏览器（无需克隆或安装）

适合会用 github.com、但不想在本地拉代码的人。GitHub 会根据文件名自动创建目录。

1. **Fork** 本仓库（右上角 **Fork**）。
2. 在你的 Fork 里点击 **Add file → Create new file**。
3. 在文件名输入框输入完整路径，例如 `data/us/my-card.json`；先输入 `data/us/`
   会让 GitHub 自动创建这些目录。
4. 另开一个标签页打开 [`templates/card.template.json`](../templates/card.template.json)，
   复制全部内容，粘贴到新文件中。
5. 修改字段：
   - `id` 必须等于 `{country}-{slug}`，并与文件名一致
     （`data/us/my-card.json` → `"id": "us-my-card"`）。
   - 设置 `country`、`name`、`issuer`、`issuer_id`、`network`、`network_tier`。
   - `sources` 与 `official_url` 至少要有一个**官方**发卡行/卡组织链接。
   - `last_verified` 填今天的核对日期（`YYYY-MM-DD`）。
6. 点击 **Commit new file**（提交到新分支），再点 **Create pull request**。
7. PR 标题用 `card(add): us-my-card`；GitHub 会预填表单，请把每一行 `**…:**` 都填好。

若检查变红，打开[校验报错对照](faq.md)，逐条对应修复方法。

## 路径 C — 本地克隆（完整工具链）

适合要加多张卡、或想在推送前本地校验的人。

```bash
git clone https://github.com/thedavidweng/opencard-db.git
cd opencard-db
npm ci

# 生成一张新卡的脚手架（交互式，或直接传参）：
npm run new:card -- --country us --slug my-card --name "My Card"

# 编辑 data/us/my-card.json，然后：
npm run validate
npm test
npm run optimize:images   # 仅当你在 images/ 下新增了图片时
```

用 `card(add): us-my-card`（或修改已有卡时用 `card(update): …`）作为 PR 标题，并填好
PR 表单。

---

## 域规则要点（务必牢记）

- **发卡行 ≠ 卡组织。** `issuer`/`issuer_id` 是发卡的银行（如招商银行、Chase）；
  `network` 是卡组织（visa/mastercard/amex/unionpay…）。二者是独立字段，即使是
  Amex/Discover 也不能混为一谈（如 Scotiabank 发行的 Amex 卡：发卡行是 Scotiabank，
  卡组织是 Amex）。
- **`network_tier` 是卡组织的等级包 slug，不是产品名。** 例如 `infinite`、`signature`、
  `world_elite`、`diamond`、`none`。产品营销名（如 Cobalt、Gold、Platinum、
  Sapphire Preferred）应放在 `name` 里，绝不能放进 `network_tier`。
- **来源必须是官方。** `sources` 里放发卡行/卡组织自家的产品页或条款页；第三方博客、
  数据库只能作为线索，不能当来源。
- **`last_verified` 填你核对官方页面的日期**（`YYYY-MM-DD`），用于标记数据新鲜度，
  不能填未来日期。

更多领域词汇见 [CONTEXT.md](../CONTEXT.md) 与 [docs/contributing.md](contributing.md)。
