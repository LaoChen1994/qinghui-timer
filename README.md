# 青回传世 · 怪物计时器

使用 Tauri 2、React、TypeScript 和 Rust 制作的本地桌面工具，支持 macOS 与 Windows。

## 使用

1. 输入怪物名称，选择 40、60、90 分钟或自定义刷新周期，点击「添加并开始计时」。
2. 多只怪物分别计时，按预计刷新时间排序。
3. 击杀怪物后，点击卡片右侧的「重置」小按钮，从此刻开始下一轮。
4. 剩余 3 分钟和到点时分别弹框提醒。开启系统通知后，切到游戏也能接收系统提醒。
5. 点击右上角「精简模式」，切换为约 320×600 的竖向信息条；拖动系统标题栏将它放到侧边。每条约 60px 高，只显示怪物名称、倒计时、细进度条及「重置」小按钮，多条记录可滚动查看。
6. 图钉按钮可开启／取消窗口置顶；展开按钮返回原来的完整窗口尺寸。精简模式的提醒显示为窗内小提示条，确认前仍可重置计时器；完整模式继续使用弹框。

自定义周期为 1～1440 整数分钟。周期不超过 3 分钟时，开始计时后立即预提醒。到点后保留「已刷新」状态，等待手动重置；不会自动开始下一轮。相同名称的计时器也互不影响，可以在名称中写上线路或地图以便区分。

请保持应用运行。最小化不会停止 Rust 后台计时；退出应用、电脑关机或休眠期间无法发送提醒。重新打开或唤醒后按照实际刷新时间恢复，已过期的怪物直接提醒「已刷新」。已确认的提醒不会重复出现。系统通知还受系统权限和勿扰设置影响。

主界面怪物卡片约 80px 高，只显示名称、倒计时、进度条与两个独立的「重置」「删除」小按钮。没有大块添加占位，长名称截断显示，鼠标悬停可查看全名。

两种界面共享同一批计时记录，切换不会重置计时，也会保留尚未提交的怪物名称。精简模式下添加、删除记录需要展开完整界面。窗口置顶适合窗口化或无边框游戏；独占全屏是否能同时显示该窗口取决于游戏和系统。

## 导入与导出分享

在完整界面的「我的怪物」右侧点击「导出」，选择保存位置，将 JSON 文件发给其他用户。对方点击「导入」选取文件，在紧凑列表里用单选按钮选择每条记录的本地或导入刷新时间，再确认：

- 不同名称：默认选择导入时间新增，可选择跳过。
- 只有一条同名本地记录：在两个时间之间单选；选本地保留，选导入覆盖。默认选择导入。
- 本地有多条同名记录：默认保留全部本地记录；先在额外显示的目标选择框中指定需要覆盖哪一条，再使用导入时间。
- 多条导入记录不能同时覆盖同一条本地记录，需先调整选择。

时间按本机时区显示；当刷新时刻不在今天时，显示完整日期，避免跨天混淆。

覆盖会更新周期、上次重置时间和预计刷新时间，清除旧一轮的待确认提醒。内容完全相同则保持原提醒状态，避免重复提醒。文件有错误或本地保存失败时，原记录保持不变；点击「取消导入」也不会修改记录。

分享文件保存 Unix 毫秒时间戳，包含 `format: "qinghui-timer"`、`version: 1`、`exportedAt`，以及每条记录的 `name`、`minutes`、`startedAt`、`deadline`。刷新时间满足 `deadline = startedAt + minutes × 60000`。文件不包含本地记录编号与提醒确认状态。

导入保留原始刷新时刻，不从导入时重新开始计时。已过期的记录直接显示「已刷新」，不补发历史提醒；之后手动重置可正常开启新一轮提醒。不同机器按各自本地时区显示日期和时间，倒计时取决于本机系统时钟。文件分享后若队友再次重置，需要重新导出新文件分享。

文件选择与保存使用 [Tauri 原生文件对话框](https://v2.tauri.app/plugin/dialog/)。导入／导出操作需要展开完整界面。

## 安装包

本次构建产物放在 `releases/`：

- [macOS 通用版 0.2.2](releases/青回传世怪物计时器_0.2.2_macOS_通用版.dmg)：打开 DMG，将应用拖入「应用程序」。包含 Apple Silicon 与 Intel 两种架构，最低系统版本为 macOS 11。
- [Windows x64 中文安装版 0.2.2](releases/青回传世怪物计时器_0.2.2_Windows_x64_安装版.exe)：运行安装程序，完成后从开始菜单启动。面向 Windows 10/11 x64；安装程序会检查 WebView2，缺少运行库时下载并安装。

当前是未使用开发者证书签名的本地版本，尚未完成 macOS 公证。macOS 0.2.2 已在 Apple Silicon 本机验证窗口与按钮操作。Windows 尚未实机验证。详细范围见 [验证报告](docs/verification.md)。系统若阻止启动，请通过系统提示或「隐私与安全性」查看该应用的打开选项。

## 本地开发

需要 Node.js 22、pnpm 10、Rust 1.90 或更高版本。macOS 需要可用的 Xcode Command Line Tools；Windows 需要 Microsoft C++ Build Tools 与 WebView2。

```sh
pnpm install --frozen-lockfile
pnpm tauri dev
```

`pnpm dev` 只提供浏览器中的界面设计预览，不会启动实际计时。Tauri 开发窗口连接本机 1437 端口。

当前机器原有 Rust/Xcode 配置不能直接完成构建。本次使用的独立 Rust 工具链位于 `/Users/pidan/.local/share/qinghui-build/`，且只在构建命令中指定 `DEVELOPER_DIR=/Library/Developer/CommandLineTools`，没有切换系统的 `xcode-select` 配置。

## 验证

```sh
pnpm build
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
```

界面测试使用本机 Chrome 与固定的原生命令响应，验证交互及 IPC 参数；计时算法和实际文件保存由 Rust 测试覆盖。桌面实测覆盖真实 Tauri IPC、计时推进、两阶段弹框、最小化计时、重置、删除及重启恢复。

## 构建

在 macOS 构建通用版：

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
pnpm tauri build --target universal-apple-darwin --bundles app,dmg -- --locked
```

在 Windows 构建中文安装程序：

```sh
pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis -- --locked
```

`.github/workflows/build.yml` 提供可手动运行的 Windows/macOS 原生构建流程，执行 Rust 测试后上传安装包。尚未连接远端仓库，也没有运行远端流程。

如使用终端访问依赖仓库或其他外部接口，并且设置了代理变量，请遵守本项目的直连要求：

```sh
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy pnpm install --frozen-lockfile
```

## 数据与结构

计时记录和已处理提醒状态以 JSON 原子写入应用数据目录：

- macOS：`~/Library/Application Support/com.qinghui.timer/timers.json`
- Windows：`%APPDATA%\com.qinghui.timer\timers.json`

`src/App.tsx` 为界面与原生命令交互；`src-tauri/src/timer.rs` 为计时状态与提醒规则；`src-tauri/src/sharing.rs` 负责分享文件校验及逐条合并；`src-tauri/src/lib.rs` 负责持久化、后台调度、系统通知、原生文件对话框和 Tauri 命令。无需服务器、账号或联网计时。
