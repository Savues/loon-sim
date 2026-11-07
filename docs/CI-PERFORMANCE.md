# loon-sim CI 性能分析报告

> 日期：2026-11-06（已多轮复核修正）
> 环境：iSH (Alpine 3.21.8, aarch64) / Node v22.23.2 / 仓库 `Savues/loon-plugin-patches`
> 实测：`sh tools/loon-sim/ci.sh` 一轮 **195s（3min15s）**，rc=0 全绿

---

## 一、结论（TL;DR）

**慢的原因不是分析慢，是「进程启动次数」多——但可优化的上限很有限。**

```
一轮 CI ≈ 225 次串行 node 冷启动 × 260ms ≈ 大半时间在启动 node
实际插件分析只占每次 ~100ms
```

- Node 冷启动在 iSH 上 **260ms**（`node -e ""`）
- 每段对**每个文件**单独 spawn 一个新 node → 段数 × 插件数的乘积效应
- 实测全轮 **195s**，其中 `| tail -1 | grep` 等 shell 管道子 shell 也占一部分

> ⚠️ **关键修正**：我最初估算「合批可 3min→1min (5x)」是**错的**。
> 经逐段核算，单测+selftest 占 **55%** 且不值得合批，
> 合批 check/parity/dead-fn 的真实上限只有 **1.37x（195s→143s）**。
> 3min 是 iSH 上 node 冷启动 260ms 的**平台固有代价**。

---

## 二、实测各段计时

裸循环实测（`date +%s` 包裹，连续运行），CI 全轮另含 shell 管道开销：

| 段 | 内容 | 进程数 | 耗时 | 占比 |
|---|---|---:|---:|---:|
| ⑥ | 插件单测 `*/*.test.mjs` | 40 | **67s** | 34% |
| ⑤ | dead-fn `*/src/*.js` | 68 | **43s** | 22% |
| ① | selftest | ~24 | 36s | 18% |
| ③ | 全量 check `*/*.lpx` | 45 | 17s | 9% |
| ④ | parity `*/*.lpx` | 45 | 17s | 9% |
| ② | regression-history | 3 | 2s | 1% |
| | **裸循环合计** | **~225** | **182s** | |
| | **CI 全轮实测（含管道）** | | **195s** | |

## 三、单次开销拆解

| 测量 | 耗时 |
|---|---|
| `node -e ""` 纯冷启动 | **260ms** |
| `cli.js check` 实际单次 | 359ms（= 260 启动 + ~100 分析） |
| `dead-fn.js` 最大文件(653KB) | 356ms（= 260 启动 + ~96 分析） |

→ **分析只占单次的 ~28%，其余 ~72% 是 node 启动 + V8 初始化 + 模块加载。**

## 四、进程数怎么来的

```
③ check    : plugins/*/*.lpx            → 45 × node
④ parity   : plugins/*/*.lpx            → 45 × node
⑤ dead-fn  : plugins/*/src/*.js         → 68 × node
⑥ 单测     : plugins/*/test/*.test.mjs  → 40 × node
① selftest: 内部 execSync('node cli.js'/'dead-fn.js') × ~24
                                          ────
                                          ~225 次串行 node 启动
```

已核对：`cli.js check` 只吃单个 lpx（`process.argv[3]`），`dead-fn.js` 只吃单个文件
（`process.argv[2]`），所以 ci.sh 只能 `for ...; do node xxx "$f"; done` 逐个 fork。

---

## 五、为什么「分析」不慢

最重的单文件也只有几百 ms：

```
653KB  YouTube_Subtitles_Translate_response.js  → dead-fn 356ms
374KB  loon-itunes.js                           → 同量级
```

fixture 最大 81KB（YouTube-Dedup）。Allinone `vip.test.mjs` 66 case 仅 **457ms**。

**没有单次操作是重的，慢在「重复启动 225 次」。**

---

## 六、优化方向（诚实核算）

### 6.1 可合批的三段：check / parity / dead-fn

这三段的入口都是**单文件、无跨调用状态**，合批安全（已核实代码）：

- `cmdCheck()` 的 `errs/warns/definedKeys/usedInRules` 全是**函数内局部变量**，从 `lpx` 现场解析
- `dead-fn.js` 是 `fs.readFileSync` 单文件、**stateless**

| 段 | 现状 | 合批后 | 可省 |
|---|---:|---:|---:|
| check(45) | 17s | ~5s | 12s |
| parity(45) | 17s | ~5s | 12s |
| dead-fn(68) | 43s | ~7s | 36s |
| 小计（裸循环） | | | **~60s** |
| + 消掉的 `|tail|grep` 管道子 shell | | | **~12s** |
| **合计可省** | | | **~52s** |

**195s → ~143s（2min25s），加速比 1.37x。**

### 6.2 碰不到的硬地板：单测(67s) + selftest(~40s) = ~107s

这两块占**优化后总时间的 75%**，合批**不划算**（注意：不是「技术上不可能」）：

**单测 —— 阻碍是代码结构，不是内存：**
每个 `*.test.mjs` 都长这样（实测确认）：
```js
console.log("=== 场景 ===");      // 顶层立即执行（import 时就跑）
assert.ok(...);
const done = await r.wait();      // 顶层 await
process.exit(fail ? 1 : 0);       // 结尾杀进程
```
要合批就得把 **40 个文件逐个**改成 `export function run()`、去掉 `process.exit`、
改成返回状态。这是横跨 40 文件的重构 —— 代价 > 收益。

**selftest —— 阻碍是被测对象本身：**
它测的就是「loon-sim 这个 CLI 的行为」，每个 case 必须重新 spawn 模拟器才能验证
真实 CLI 契约。改成进程内直调函数会把「黑盒 CLI 测试」降级成「白盒函数测试」，
损失测试保真度 —— 不值得。

> 💡 **辨析**：我早先把「400MB 内存」当论据说单测不能合批，那是**错用** ——
> 内存问题只属于**并行（4 个 node = ~400MB）**，不属于**合批（1 个 node = ~100MB）**。
> 合批恰恰没有内存问题。单测的真正阻碍是上面的**结构重构成本**。

### 6.3 并行（xargs -P4）—— 不推荐

- 单 node 60–120MB，4 并行 ~400MB，iOS 后台易被系统 jettison
- iSH 已知 fork 僵死问题，**并行会放大**触发概率
- 收益不确定（iOS 热节流 + iSH 调度）
- **风险 > 收益，别做**

---

## 七、最终建议

CI 是**偶尔跑的开发工具，不是热路径**。195s（3min15s）的绝对耗时可以接受。

| 选项 | 收益 | 风险 | 建议 |
|---|---|---|---|
| 合批 check + parity + dead-fn | 省 ~52s（**1.37x**） | 低（stateless 已核实） | 可做，但**非必需** |
| 合批/重构 单测 + selftest | 碰不到（占 75%） | 中（40 文件重构 / 降保真度） | **不划算，别做** |
| 并行 xargs -P4 | 不确定 | 高（iSH 僵死 + 内存） | **别做** |

**结论**：优化**现实可行但收益有限**——真实上限 **1.37x**，远小于我最初声称的 5x。
除非 CI 频繁到碍事，否则**不值得投入**。
根子是 iSH 上 node 冷启动 260ms 的**平台成本**，不是代码问题。

如果哪天确实想省这点时间，**只做 6.1 的三段合批**即可（低风险、stateless），
不要去动单测/selftest。

---

## 八、不构成问题的部分

- 单插件分析逻辑本身很快，**不需要**优化解析/正则
- fixture 体积合理（最大 81KB），不是瓶颈
- ② regression(2s)、③④ check/parity(各17s) 已经很轻，肥肉在 ⑤⑥①

---

## 附：复现测量命令

```sh
cd /var/minis/shared/loon-plugin-patches
# 全轮真实耗时
t0=$(date +%s); sh tools/loon-sim/ci.sh >/tmp/ci.txt 2>&1; echo "$(( $(date +%s)-t0 ))s"
# 单次冷启动
python3 -c "import subprocess,time;t=time.time();subprocess.run(['node','-e','']);print((time.time()-t)*1000)"
# 各段裸循环计时
t0=$(date +%s); for f in plugins/*/src/*.js; do node tools/loon-sim/dead-fn.js "$f" >/dev/null 2>&1; done; echo "dead-fn: $(( $(date +%s)-t0 ))s"
# 进程数
printf 'lpx:%s src:%s test:%s\n' "$(ls plugins/*/*.lpx|wc -l)" "$(ls plugins/*/src/*.js|wc -l)" "$(ls plugins/*/test/*.test.mjs|wc -l)"
```
