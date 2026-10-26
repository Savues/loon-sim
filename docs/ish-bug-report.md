# iSH Bug Report: grep -c 在特定条件下永久挂死 (anon_inode EPIPE 缺失)

## 环境
- iSH App, 内核: Linux version 4.20.69-ish SUPER AWESOME Sep 27 2026 13:10:49 aarch64
- Alpine 3.21, busybox grep
- iOS 26 (iPad mini A17 Pro / iPhone 18,3 双设备)

## 症状
`grep -cF <pattern> <file>` 在 **pattern 不匹配** 时永久挂死（CPU 0%，永不退出）。
同文件同 pattern：`grep -qF` 与 `grep -F`（无 -c）正常返回 exit 1。

## 稳定复现（需满足前置状态，见下）
```sh
grep -cF "y" /etc/hostname     # y 不在文件中 → 挂死（永不返回）
grep -qF "y" /etc/hostname     # 同 pattern → exit 1 正常
grep -F  "y" /etc/hostname     # 同 pattern → exit 1 正常
```

## 挂死时进程状态（/proc 实测）
```
/proc/<pid>/fd:
  0 -> /dev/null
  1 -> anon_inode:[unknown]     ← stdout 指向 iSH 内部匿名管道
  2 -> anon_inode:[unknown]
状态: 孤儿进程 (PPid=1), CPU 0%, 永久阻塞
```

## 触发条件（实证规律）
挂死**不单发复现**，需要满足以下任一前置状态后 100% 复现：
1. 此前执行过 `timeout <n> sh -c '<含循环 grep 的脚本>'` 且 timeout 到期杀掉进程树
   → 循环内 grep 被孤儿化，其中部分僵尸永久留存
2. 环境中已存在上述僵死 grep 进程（自我增殖：每挂死一次多一个）

无此前置状态时（干净环境单发）同命令可能正常返回 → 复现率随残留进程数上升，
表现为「卡点漂移」，实际是 anon_inode 管道资源/状态被僵尸污染。

## 因果链（/proc 诊断实证）
1. `timeout` 杀进程树 → 循环体内的 grep 孤儿化 (PPid=1)
2. 孤儿 grep 的 stdout (fd1) = iSH anon_inode 管道对象
3. 对端 shell 已销毁，但 iSH 的 anon_inode 实现**不向写入方返回 EPIPE**
4. grep 退出前刷新 stdout → 写入永久阻塞 → 进程永存
5. 僵尸累积 → 后续任何「stdout 接 anon_inode 的 grep -c 不匹配」场景高概率挂死

## 关联
- ish-app/ish#1890 ('cargo build' stuck in real_poll_wait) — 同族症状，同为管道等待不返回

## 期望行为
对端关闭的 anon_inode 管道，写入应返回 EPIPE/SIGPIPE（POSIX 语义）。

## 影响与规避
- 任何「timeout 包装 shell 循环 grep」的脚本都会逐步污染环境直至常态挂死
- 规避: 脚本逻辑改走 python3 单进程（subprocess 由 python 收尸，不经 anon_inode 刷新路径）；
  应急清理: kill -9 全部孤儿 grep/sort（环境立即恢复）
- 复现脚本与诊断数据可应要求提供
