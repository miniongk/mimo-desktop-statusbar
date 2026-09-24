# MiMo 会话统计条 · MiMo Desktop Session Status Bar

> 非官方第三方工具,与 Xiaomi 无关联。不修改 MiMo Desktop 的任何文件。
>
> Unofficial third-party tool, not affiliated with Xiaomi. It modifies no files inside MiMo Desktop.

给 MiMo Desktop 加一条常驻在输入框(composer)下方的实时统计条:上下文占用、token 用量、缓存命中、花费、生成速度、工具调用、子代理、任务进度。数据全部来自引擎自己的落库记录,不是估算;显示方式沿用应用的 CSS 变量,明暗主题自动跟随。

A live status bar docked under the composer of MiMo Desktop: context pressure, token usage, cache hit rate, cost, generation speed, tool calls, subagents and tasks. Every number comes from what the engine already wrote to its own database — nothing is estimated — and the bar inherits the app's CSS variables, so light and dark themes just work.

**[English](#english)** · **[中文](#中文)**

![status bar](test/preview-live.png)

上图是真实会话的数据。Real session data, not a mock-up: 26% context, 25.22M input tokens, 97% cache hit, $0.299, 102 tok/s, 249 tool calls.

![dark theme](test/preview-darktheme.png)

展开后是工具分布、步数/消息数、子代理状态、任务清单。Expand the `▾` panel for the tool breakdown, step/message counts, live subagents and the task list.

![detail panel](test/preview-expanded.png)

---

## English

### Install

One prerequisite: **MiMo Desktop**. There is nothing to compile and nothing else to install — the scripts run on the Node runtime that MiMo Desktop already ships.

> That runtime is MiMo's own `mimo-node` shim, not standalone Node, and it refuses to start unless `MIMO_ELECTRON_NODE_HOST` points at `Xiaomi MiMo.exe` (otherwise: `mimo-node: MIMO_ELECTRON_NODE_HOST is not set`). `bin\_env.cmd` resolves the host and sets it for you — a real Node on `PATH` also works and ignores the variable.

1. Download `mimo-desktop-statusbar-v1.0.0.zip` from [Releases](https://github.com/miniongk/mimo-desktop-statusbar/releases) and unpack it.
2. Double-click **`mimo-statusbar\安装.cmd`** (the filename means "install").
3. If it asks 「现在关闭并重启 MiMo 吗?」(restart MiMo now?) → click **Yes**. Only the first run needs this.

That single action does four things:

- copies itself to `%LOCALAPPDATA%\Programs\mimo-statusbar`
- creates Desktop / Start Menu shortcuts named 「MiMo 统计条」(a backup entry point)
- **adds the debug switch to the MiMo shortcuts** on the Desktop, Start Menu and taskbar — afterwards you launch MiMo exactly as usual and the bar is just there
- **registers a hidden logon watcher**: after an app update restarts MiMo without the switch, it puts MiMo back on the switch by itself
- **registers a keep-alive task** (every 5 minutes): the logon watcher only fires at login, so without this an injector that dies mid-session stays dead until the next login

MiMo's icons, name and install directory are untouched; the shortcuts only gain a launch argument. Everything is reversible (see Uninstall).

Optional flags (accepted by `bin\install.cmd`):

| Flag | Effect |
|---|---|
| `--dir <path>` | install somewhere else (default `%LOCALAPPDATA%\Programs\mimo-statusbar`) |
| `--no-shortcut` | do not create the 「MiMo 统计条」shortcut |
| `--enable` | enable right after installing (`安装.cmd` passes this) |

If MiMo Desktop is not in its default location, set `MIMO_STATSBAR_APP` to the full path of `Xiaomi MiMo.exe` before installing.

### Daily use

**There is nothing to click.** After installing:

- open MiMo the way you always do — the bar comes up with it
- when an app update restarts MiMo, the watcher restarts it once with the switch and the bar returns
- to enable or recover by hand: double-click 「MiMo 统计条」

| Want to | Do this |
|---|---|
| check auto-start is on | a shortcut named 「MiMo 会话统计条」in the Startup folder; delete it to turn off |
| check the keep-alive is on | `schtasks /Query /TN mimo-statusbar-keepalive` (remove with `schtasks /Delete /TN mimo-statusbar-keepalive /F`) |
| enable / recover manually | double-click 「MiMo 统计条」 (= `bin\enable.cmd`) |
| turn the bar off for now | double-click `bin\stop.cmd` |
| uninstall completely | double-click `bin\uninstall.cmd` |

It runs hidden — no console window stays open. The log is `logs\statusbar.log`. To stop the "restart MiMo after an update" behaviour, set `"recoverMiMo": "off"` in `config.json`.

Only one injector may run at a time (two would fight over the same DOM node); to take over deliberately use `bin\launch.cmd --force`.

### Why the first run restarts MiMo

MiMo Desktop holds a single-instance lock (`requestSingleInstanceLock` in `out/main/index.mjs`). Launching it again with extra arguments drops those arguments and just focuses the existing window, so the debug port never opens. The first run has to close the old process and start MiMo again with the switch.

Afterwards you never think about it: the shortcuts already carry the argument, and only an app update — which restarts MiMo its own way — needs the watcher's help.

The bar only ever adds `--remote-debugging-port=9222`. It never touches MiMo's files: not the install directory, not `app.asar`, not the config.

### What it shows

| Metric | Source |
|---|---|
| model / mode | `modelID`/`providerID`/`mode` of the newest main-agent message |
| context pressure (bar + % + counts) | `tokens.total` of that message ÷ context window |
| tokens (in ↑ / out ↓ / reasoning) | summed `tokens` buckets over every `step-finish` |
| cache hit rate | `cacheRead ÷ (input + cacheRead + cacheWrite)` |
| cost | sum of `step-finish.cost` (**the engine's own number** — see below) |
| generation speed | output tokens ÷ actual generation time (idle time excluded) |
| tool calls / breakdown | counts and grouping of `part` rows with `type=tool` |
| subagents | live status and turn counts from `actor_registry` |
| task progress | `task` rows grouped by status |
| steps / messages / compactions / title | inside the `▾` detail panel |

The context bar turns amber at 75% and red at 90%; the dot on the left breathes while a subagent is running or something happened in the last 4 seconds.

### How the cost is calculated

The `$` figure is **computed by the engine and written to the database**; the bar only sums it. It never touches a price list.

Once per model step the engine calls `getUsage()` and stores the result as `part.data.cost`:

```
input × price.input            ← input excludes the cached part
+ output × price.output        ← output excludes reasoning
+ reasoning × price.output     ← reasoning is billed at the output rate
+ cache.read × price.cache.read
+ cache.write × price.cache.write
```

Prices are **USD per 1M tokens**, accumulated with `Decimal`.

Three behaviours worth knowing:

- **A model with no price is recorded as 0.** In the source it is `costInfo?.input ?? 0`, so models without a price entry (some `mimo-*` channels, for instance) cost nothing. Tokens going up while `$` stays flat is normal.
- **The `input` bucket is the uncached part.** The engine subtracts `cacheRead` and `cacheWrite` first and bills cached tokens separately at `cache.read`, so nothing is double-counted.
- **Past 200k tokens it may switch price tier.** When `input + cache.read > 200000` and the model defines `experimentalOver200K`, that tier's prices are used instead.

The per-message `cost` is accumulated step by step (`message.cost += usage.cost`), so summing steps and summing messages agree exactly — verified to be a difference of 0.

**This is an estimate, not a bill.** Actual charges are whatever the platform bills you.

### Who sets model prices

Prices come from the **models.dev community catalog**: the engine fetches and caches it at `~/.cache/mimocode/models.json`, and the desktop keeps its own copy in `%APPDATA%\Xiaomi MiMo\models-with-claude.json`. Both hold the same data, keyed by `provider/model`.

Custom (BYOK) API models follow the same rule: if the id you configured exists in the catalog it gets that price; if not, `cost()` fills in zeros and the bar shows `$0`. **The desktop's custom-model form has no price field** (only name, API key and context limits), so setting a price means editing the config file yourself:

```jsonc
// ~/.config/mimocode/mimocode.json
"provider": {
  "myproxy": {
    "npm": "@ai-sdk/openai-compatible",
    "options": { "baseURL": "https://…/v1", "apiKey": "…" },
    "models": {
      "my-model": {
        "name": "my-model",
        "cost": {                        // USD / 1M tokens
          "input": 0.15,                 // uncached input
          "output": 0.6,                 // output (reasoning bills at the output rate;
                                         // a reasoning field in the catalog is ignored)
          "cache_read": 0.003,           // cache hit reads
          "cache_write": 0               // cache writes, optional
        },
        "context_over_200k": {           // optional: used past 200k tokens
          "input": 0.3, "output": 1.2, "cache_read": 0.006, "cache_write": 0
        }
      }
    }
  }
}
```

Restart MiMo afterwards for it to take effect.

Worked example, with the catalog price of `deepseek/deepseek-flash` (`0.15 / 0.6 / 0.003`) — the recomputation matches the database to the last digit:

| step | input | output | reasoning | cache.read | stored cost | recomputed |
|---|---|---|---|---|---|---|
| 1 | 42530 | 271 | 761 | 0 | 0.0069987 | 0.0069987 |
| 2 | 298 | 198 | 54 | 43520 | 0.00032646 | 0.00032646 |

### Configuration

`config.json`:

| Key | Default | Meaning |
|---|---|---|
| `port` | `9222` | debug port, shared with the launcher |
| `refreshMs` | `1000` | poll interval while idle |
| `busyRefreshMs` | `250` | poll interval while a subagent is running |
| `contextWindowOverride` | `null` | force a context window; otherwise looked up per `provider/model` |
| `pinnedSessionId` | `null` | pin one session (beats everything else) |
| `composerInputPath` | `null` | the file where the desktop records the open conversation |
| `recoverMiMo` | `"auto"` | after an update restarts MiMo without the switch: `auto` restart it, `ask` confirm first, `off` leave it |
| `log` | `true` | write the polling log |

Environment overrides: `MIMO_STATSBAR_CONFIG` (alternate config file), `MIMO_STATSBAR_APP` (alternate app path).

### Limitations

- **MiMo must be started with the debug switch.** The bar attaches over `--remote-debugging-port` instead of patching the app. Install adds that switch to the MiMo shortcuts and the logon watcher recovers from updates; running `Xiaomi MiMo.exe` bare will still come up without the bar.
- **The open conversation is tracked from the UI.** It uses the composer variant (dock = a conversation is open) plus the desktop's `currentKey`. On the new-task page you get `新对话 · 还没有数据` rather than the previous conversation's numbers.
- **The context window depends on the local model catalog.** No entry means tokens only. Use `contextWindowOverride` to pin it.
- **Token counts are exact; money is the engine's estimate.**

### Uninstall

Double-click `bin\uninstall.cmd`. It stops the injector, removes the 「MiMo 统计条」shortcuts, **restores the MiMo shortcuts** (strips the debug switch) and **removes the logon watcher and the keep-alive task**. Add `--purge` to delete the install directory as well.

### Troubleshooting

| Symptom | What to do |
|---|---|
| the bar vanished after an app update | the watcher restarts MiMo once (look for `自愈结果: restarted` in the log). If that is off, double-click 「MiMo 统计条」 |
| the bar never appears | check `logs\statusbar.log`. "端口 9222 上还没有调试接口" means MiMo came up without the switch — recover once by hand |
| no bar when launching `Xiaomi MiMo.exe` directly | expected: that launch has no switch. Use a MiMo icon, or wait for the watcher |
| numbers do not follow the conversation | look for `当前会话 ->` in the log; if missing, `bin\stop.cmd` then `bin\enable.cmd` |
| start refused (PID xxx) | an injector is already running **and the port is up**. Take over with `bin\launch.cmd --force`, or `bin\stop.cmd` first |
| turn off the auto-restart | `"recoverMiMo": "off"` in `config.json` |
| turn off auto-start | delete 「MiMo 会话统计条」from the Startup folder |

### Development

| Command | What it covers |
|---|---|
| `bin\test.cmd` | everything (each entry below is `bin\test.cmd <name>`) |
| `bin\test.cmd runtime` | the bundled `mimo-node` shim and `bin\_env.cmd` |
| `bin\test.cmd resolve` | which conversation is shown; new-task page, temporary keys, broken JSON |
| `bin\test.cmd stats` | the SQL layer against a fixture database |
| `bin\test.cmd render` | mounting and DOM assertions in headless Edge; writes the preview images |
| `bin\test.cmd e2e` | the real injector against the real `mimocode.db` |
| `bin\test.cmd shortcuts` | shortcut patching: idempotent, reversible, replaces rather than stacks |
| `bin\test.cmd autostart` | the logon .lnk shape |
| `node test/inspect-live.mjs` | against a running instance: does the bar match the DB |
| `bin\launch.cmd --dry-run` | what the launcher would do, without doing it |

Nothing to build — the source is the deliverable. Use `bin\test.cmd` (or `call bin\_env.cmd` first) rather than bare `node`, so the bundled runtime is resolved. `e2e.mjs` stands in a fake composer page, so it exercises everything except "does the app open the debug port".

### Why not DLL injection

Hooking the UI with an injected DLL does not work on Electron: the renderer is Chromium and getting at the DOM from native code means reaching into V8/Blink internals that break on every upgrade. Dropping a DLL into an application directory is also the textbook shape of malware, and antivirus treats it accordingly.

Two closer routes were tried and rejected:

- `NODE_OPTIONS=--require=hook.cjs` — the Electron fuse `EnableNodeOptionsEnvironmentVariable` is on in this build, but Electron strips `--require` for the main process (the same variable works under `ELECTRON_RUN_AS_NODE`), so nothing ever ran.
- patching the preload inside `app.asar` — possible, since `EnableEmbeddedAsarIntegrityValidation` is off, but it modifies application files and every update overwrites it.

External CDP injection it is: nothing inside MiMo changes, and stopping the injector is a clean exit.

### Development notes

Built with **MiMo Desktop**, using the **MiMo V2.6 pro** and **MiMo V2.6 Flash** models.

### License

MIT

---

## 中文

### 安装

前提只有一样:**MiMo Desktop 已经装好**。不需要装 Node,也不需要编译 —— 脚本直接用 MiMo Desktop 自带的那个 Node 运行时跑。

> 那个运行时其实是 MiMo 自己的 `mimo-node` 壳,不是独立 Node:它要求 `MIMO_ELECTRON_NODE_HOST` 指向 `Xiaomi MiMo.exe`,否则报 `mimo-node: MIMO_ELECTRON_NODE_HOST is not set`。`bin\_env.cmd` 会自动找到主程序并把变量设上 —— 如果 `PATH` 里有真正的 Node 也能用(那种情况会忽略这个变量)。

1. 从 [Releases](https://github.com/miniongk/mimo-desktop-statusbar/releases) 下载 `mimo-desktop-statusbar-v1.0.0.zip`,解压。
2. 双击 **`mimo-statusbar\安装.cmd`**。
3. 如果弹出「现在关闭并重启 MiMo 吗?」→ 点**是**(只有第一次,以及应用更新后需要)。

完事。这一个动作会做四件事:

- 复制到 `%LOCALAPPDATA%\Programs\mimo-statusbar`
- 建桌面 / 开始菜单快捷方式「MiMo 统计条」(备用入口)
- **给 MiMo 的桌面 / 开始菜单 / 任务栏快捷方式加上调试端口** —— 之后照常点 MiMo 图标,统计条就在
- **注册开机自启**(隐藏的看门狗):登录后静默常驻;应用更新把 MiMo 重启后若没带端口,它会自动补一次带端口的重启
- **注册自愈计划任务**(每 5 分钟):开机自启只在登录时跑一次,注入器如果中途死了会一直躺着 —— 这个任务会把它拉起来

  > 启动项是一个指向 `wscript.exe` 的快捷方式(不是脚本文件)。往启动文件夹里写 `.vbs` 会被杀软按恶意行为拦掉,快捷方式不会 —— 这也是它全程无窗口的原因。两者都指向**安装目录**,不依赖解压出来的那个文件夹。

MiMo 自己的图标、名字、安装目录都没动,只是快捷方式多了一个启动参数。全部可还原(见卸载)。

可选参数(`bin\install.cmd` 支持):

| 参数 | 作用 |
|---|---|
| `--dir <路径>` | 装到别处,默认 `%LOCALAPPDATA%\Programs\mimo-statusbar` |
| `--no-shortcut` | 不创建「MiMo 统计条」快捷方式 |
| `--enable` | 装完立刻启用(`安装.cmd` 默认带上) |

MiMo Desktop 不在默认位置时,先设环境变量 `MIMO_STATSBAR_APP` 指向 `Xiaomi MiMo.exe`,再运行安装。

### 日常使用

**什么都不用点。** 装完之后:

- 开机后像平常一样点 MiMo 图标,统计条跟着出现
- 应用更新导致 MiMo 自己重启时,看门狗会自动补一次带端口的重启,统计条自己回来
- 中途想手动启用/恢复:双击桌面「MiMo 统计条」

| 操作 | 怎么做 |
|---|---|
| 开机自启 | 已默认开启(启动文件夹里的「MiMo 会话统计条」快捷方式,删掉它即停) |
| 自愈(进程死了自动拉起) | 已默认开启(`schtasks /Query /TN mimo-statusbar-keepalive`;删除即停) |
| 手动启用 / 恢复 | 双击桌面「MiMo 统计条」(= `bin\enable.cmd`) |
| 暂时关掉统计条 | 双击 `bin\stop.cmd` |
| 完全卸载 | 双击 `bin\uninstall.cmd` |

后台隐藏运行,没有常驻窗口。运行记录在 `logs\statusbar.log`。想关掉「更新后自动重启 MiMo」这个行为,在 `config.json` 里设 `"recoverMiMo": "off"`。

同一时刻只允许一个注入器(它们会互相覆盖同一个 DOM 节点);确认要接管时用 `bin\launch.cmd --force`。

### 为什么第一次要重启

MiMo Desktop 带单实例锁(`out/main/index.mjs` 的 `requestSingleInstanceLock`)。已经在运行时,你再用带参数的方式启动它,新进程会把参数丢掉、只把旧窗口拉到前台 —— 调试端口永远不会打开。所以第一次必须关掉旧进程,由统计条带参数重新拉起。

之后就不用了:快捷方式已经带上参数,日常启动天生就是对的;只有应用更新会用别的方式重启 MiMo,那一次由看门狗自动补救。

统计条只是给应用加了一个 `--remote-debugging-port=9222` 参数,**没有改动 MiMo 的任何文件**。安装目录、`app.asar`、配置文件都保持原样。

### 显示什么

| 指标 | 来源 |
|---|---|
| 模型 / 模式 | 最近一条主代理消息的 `modelID`/`providerID`/`mode` |
| 上下文占用(条+百分比+用量) | 最近一条主代理消息的 `tokens.total` ÷ 上下文窗口 |
| token(输入↑/输出↓/思考) | 所有 `step-finish` 的 `tokens` 分桶求和 |
| 缓存命中率 | `cacheRead ÷ (input + cacheRead + cacheWrite)` |
| 花费 | `step-finish.cost` 求和(**引擎给的值**,不是我自己套价格表)—— 算法见下节 |
| 生成速度 | 输出 token ÷ 各消息实际生成耗时之和(不含等待) |
| 工具调用数 / 分布 | `part` 里 `type=tool` 的计数与分组 |
| 子代理 | `actor_registry` 的实时状态与轮数 |
| 任务进度 | `task` 表按状态计数 |
| 步数/消息数/压缩次数/会话标题 | 明细面板里,点击 `▾` 展开 |

上下文条在 75% 变琥珀、90% 变红;有子代理在跑或最近 4 秒内有动作时,左侧圆点会呼吸。

### 费用怎么算出来的

`$` 那一栏是**引擎自己算好写进库的**,统计条只做求和 —— 不碰价格表、不做乘法。

引擎在每个模型步结束时调一次 `getUsage()`,把结果写进 `part.data.cost`:

```
input × price.input            ← input 已减掉缓存部分
+ output × price.output        ← output 已减掉思考部分
+ reasoning × price.output     ← 思考按输出单价计
+ cache.read × price.cache.read
+ cache.write × price.cache.write
```

单价都是**美元 / 百万 token**,用 `Decimal` 累加后再转 number。

三条值得注意的行为:

- **模型没有价格 → 记 0。** 源码里是 `costInfo?.input ?? 0`,没有价目表的模型(比如部分 `mimo-*` 通道)全部按 0 计。所以 token 一直在涨、`$` 却不动,是正常的,不是 bug。
- **`input` 桶是「未走缓存」的部分。** 引擎先算 `inputTokens - cacheRead - cacheWrite`,命中的缓存 token 单独按 `cache.read` 计,不会重复计费。
- **超过 20 万 token 可能换价档。** `input + cache.read > 200000` 且模型配置了 `experimentalOver200K` 时,整单改用那一档的价格。

消息上的 `cost` 是逐步累加的(`message.cost += usage.cost`),所以步内求和与消息级求和完全一致 —— 实测两者差为 0。

**这是估算,不是账单。** 价目表来自本机的模型目录与引擎配置;实际扣费以平台为准。

### 价格是谁定的

价目表来自 **models.dev 社区目录**:引擎联网拉取并缓存在 `~/.cache/mimocode/models.json`,桌面另存一份在 `%APPDATA%\Xiaomi MiMo\models-with-claude.json`。两份数据同源,按 `provider/model` 取价。

自定义(BYOK)API 模型也是同一个匹配规则 —— 拼出来的 id 在目录里有,就有价;没有,`cost()` 归一化时全填 0,统计条就显示 `$0`。**桌面的「自定义模型」界面只有名字 / API Key / 上下文上限,没有价格输入框**,所以要改价只能动配置文件:

```jsonc
// ~/.config/mimocode/mimocode.json
"provider": {
  "myproxy": {
    "npm": "@ai-sdk/openai-compatible",
    "options": { "baseURL": "https://…/v1", "apiKey": "…" },
    "models": {
      "my-model": {
        "name": "my-model",
        "cost": {                        // 单位:美元 / 百万 token
          "input": 0.15,                 // 未走缓存的输入
          "output": 0.6,                 // 输出(思考按 output 单价计,目录里的 reasoning 字段会被忽略)
          "cache_read": 0.003,           // 缓存命中读取
          "cache_write": 0               // 缓存写入,可省略
        },
        "context_over_200k": {           // 可选:超过 20 万 token 时改用这一档
          "input": 0.3, "output": 1.2, "cache_read": 0.006, "cache_write": 0
        }
      }
    }
  }
}
```

改完配置要重启 MiMo 才生效(桌面设置里的提示也是 `Restart the app to enable custom models`)。

复算示例(拿本机目录对 `deepseek/deepseek-flash` 的价 `0.15 / 0.6 / 0.003` 验证,精确到末位):

| 步 | input | output | reasoning | cache.read | 库里的 cost | 复算 |
|---|---|---|---|---|---|---|
| 1 | 42530 | 271 | 761 | 0 | 0.0069987 | 0.0069987 |
| 2 | 298 | 198 | 54 | 43520 | 0.00032646 | 0.00032646 |

### 配置

`config.json`:

| 键 | 默认 | 说明 |
|---|---|---|
| `port` | `9222` | 调试端口,和启动器读的是同一份 |
| `refreshMs` | `1000` | 空闲时的轮询间隔 |
| `busyRefreshMs` | `250` | 有子代理在跑时的轮询间隔 |
| `contextWindowOverride` | `null` | 手工指定上下文窗口。不填就按 `provider/model` 去本机模型目录查,查不到就只显示 token 不显示百分比 |
| `pinnedSessionId` | `null` | 钉住某个会话(优先级最高,会盖过当前对话) |
| `composerInputPath` | `null` | 桌面记录「当前对话」的那个文件。`null` = 用 `%APPDATA%\Xiaomi MiMo\composer-input.json` |
| `recoverMiMo` | `"auto"` | 应用更新后 MiMo 自启但没带端口时怎么办:`auto` 自动补一次重启 / `ask` 先弹框 / `off` 不管 |
| `log` | `true` | 打印轮询日志 |

对应环境变量:`MIMO_STATSBAR_CONFIG`(换配置文件)、`MIMO_STATSBAR_APP`(换可执行文件路径)。

### 已知限制

- **MiMo 必须带调试端口启动。** 统计条不改应用文件,靠 `--remote-debugging-port` 附加。安装时会给 MiMo 的快捷方式加上这个参数,并注册开机自启的看门狗自动补救;但如果你直接运行 `Xiaomi MiMo.exe`(不带参数),统计条会缺席,直到看门狗把它拉回正轨。
- **当前会话跟着界面走。** 判定依据是 composer 变体(是否打开着一条对话)+ 桌面 `composer-input.json` 的 `currentKey`。在新建任务页会显示 `新对话 · 还没有数据`,不会拿上一条对话的数字充数。刚新建、引擎还没落库的对话,`currentKey` 是临时 `c…` key,同样按新对话处理。
- **上下文窗口取决于本机模型目录。** 目录里没有对应条目就只能显示 token。用 `contextWindowOverride` 兜底。
- **花了多少 token 是准确的,钱是引擎估的。** 数值直接取自引擎的 `cost` 字段。

### 卸载

双击安装目录里的 `bin\uninstall.cmd`(默认装在 `%LOCALAPPDATA%\Programs\mimo-statusbar`)。它会:

1. 停掉后台注入器(统计条约 10 秒内从界面上消失)
2. 删掉「MiMo 统计条」快捷方式
3. **还原 MiMo 的桌面 / 开始菜单 / 任务栏快捷方式**(去掉加上的调试端口)
4. **移除开机自启和自愈计划任务**

想连安装目录一起删掉,用 `bin\uninstall.cmd --purge`。

MiMo 本身没有被改过,不需要恢复任何东西。之后正常启动 MiMo 即可。

### 故障排查

| 现象 | 原因 / 做法 |
|---|---|
| **应用更新后统计条不见了** | 看门狗会自动补一次带端口的重启(日志里有 `自愈结果: restarted`)。若被关掉过(`recoverMiMo: off`)或自启没装上,双击桌面「MiMo 统计条」即可 |
| 统计条一直没出现 | 看 `logs\statusbar.log`。若是「端口 9222 上还没有调试接口」,说明 MiMo 没带调试端口启动 —— 双击桌面「MiMo 统计条」手动恢复一次 |
| 直接运行 `Xiaomi MiMo.exe` 时没有统计条 | 预期行为:那样启动不带调试端口。用桌面/开始菜单/任务栏的 MiMo 图标(已被统计条接管),或等看门狗补救 |
| 统计条显示了但数字不随对话切换 | 看日志里有没有「当前会话 -> …」;没有就是注入器没在轮询,`bin\stop.cmd` 后再 `bin\enable.cmd` |
| 重复启动被拒(PID xxx) | 已有注入器在跑**且端口是通的**。确认要接管时用 `bin\launch.cmd --force`,或先 `bin\stop.cmd` |
| 想关掉「更新后自动重启 MiMo」 | `config.json` 里设 `"recoverMiMo": "off"` |
| 不想要开机自启 | 删掉启动文件夹里的「MiMo 会话统计条」快捷方式 |

诊断脚本:`node test\inspect-page.mjs` 看挂载与选择器,`node test\inspect-live.mjs` 核对会话与数字(`bin\_env.cmd` 会找到可用的 Node)。

### 开发

| 命令 | 说明 |
|---|---|
| `bin\test.cmd` | 全部(下面每条都是 `bin\test.cmd <名字>`) |
| `bin\test.cmd runtime` | MiMo 自带的 `mimo-node` 壳与 `bin\_env.cmd` 的解析 |
| `bin\test.cmd resolve` | 会话识别:currentKey 优先,含新任务页 / 临时 key / 坏 JSON 的边界 |
| `bin\test.cmd stats` | 数据层:自建 SQLite fixture,覆盖空会话、只有子代理、压缩等边界 |
| `bin\test.cmd render` | 渲染层:headless Edge 里挂载并断言 DOM,输出三张预览图 |
| `bin\test.cmd e2e` | 全链路:真实注入器 + 真实 `mimocode.db`,验证切换对话、新任务页、自愈退场 |
| `bin\test.cmd shortcuts` | 快捷方式补丁:幂等、还原、替换而非叠加端口(在临时目录里做) |
| `bin\test.cmd autostart` | 开机自启 .lnk 的形状 |
| `node test/inspect-live.mjs` | 对正在跑的实例:核对统计条显示的会话/数字是否与桌面 currentKey 及数据库一致 |
| `bin\launch.cmd --dry-run` | 只看启动器会做什么,不动应用 |

源码即发行物,没有构建步骤。跑测试用 `bin\test.cmd`(或先 `call bin\_env.cmd`),别直接裸 `node`,否则会踩到 `mimo-node` 壳的环境变量要求。`e2e.mjs` 用一个仿 composer 的无头页面当替身,所以它验证的是「除应用是否开启调试端口之外」的每一环。

### 关于 DLL 注入

最初的想法是写个 DLL 注入进去 hook UI。这条路对 Electron 不通:渲染进程是 Chromium,要拿到 DOM 得从原生侧调 V8/Blink 内部 API,应用一升级就崩;而且「把 DLL 丢进目录里自注入」这个行为模式本身就与恶意软件一致,会被杀软拦。

另外两条更接近的路也实测排除了:

- `NODE_OPTIONS=--require=hook.cjs` —— 虽然该版本的 Electron fuse `EnableNodeOptionsEnvironmentVariable` 是开着的,但 Electron 在正常主进程模式下会把 `--require` 剥掉(同一个变量在 `ELECTRON_RUN_AS_NODE` 模式下却生效),实测主进程里没有执行到。
- 改 `app.asar` 里的 preload —— fuse `EnableEmbeddedAsarIntegrityValidation` 是关的,技术上可行,但会动应用文件、每次升级被覆盖,不划算。

最后选的是外部 CDP 注入:完全不动 MiMo,可随时撤离。

### 开发说明

本项目由 **MiMo Desktop** 开发,使用 **MiMo V2.6 pro** 和 **MiMo V2.6 Flash** 模型。

### License

MIT
