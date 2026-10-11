# iOS 攻击链覆盖数据类别深度分析报告

> 编制日期：2026-10-09
> 数据来源：Apple Platform Security、Kaspersky、Google Threat Intelligence、MITRE ATT&CK、Securelist、IBM Security 等公开威胁情报
> 性质：防御性安全研究分析（Defensive Security Research）

---

## 1. 执行摘要

iOS 全链条攻击（Full-Chain Exploit）的最终目标是**数据窃取**。攻击者通过 WebKit RCE → 沙箱逃逸 → 内核提权的完整攻击路径，获得对设备的完全控制权后，可访问 iOS 系统上几乎所有类型的数据。

本报告系统梳理 iOS 攻击链覆盖的**八大类数据**，分析各类数据的保护机制、攻击者的获取方式、以及对应的检测与防护策略。

**核心发现**：
- 全链条攻击可绕过 iOS Data Protection 的所有保护级别
- 内核提权后可访问 Keychain、加密文件、安全隔区（SEP）授权令牌
- 实时监视能力（摄像头/麦克风/屏幕）超越静态数据窃取
- 加密货币钱包和 BIP39 助记词成为近年攻击重点

---

## 2. iOS 数据保护体系概述

### 2.1 Data Protection  Classes（数据保护类）

iOS 通过 **Data Protection Classes** 对文件系统进行分级加密保护，每类数据根据设备锁定状态决定可访问性：

| 保护类 | 英文标识 | 可访问时机 | 典型数据 |
|---|---|---|---|
| **完全保护** | `NSFileProtectionComplete` | 仅设备解锁时 | 消息数据库、健康数据、Keychain 项（WhenUnlocked） |
| **除非已打开** | `NSFileProtectionCompleteUnlessOpen` | 已打开的文件在锁定时仍可访问 | 正在录制的音频、正在下载的文件 |
| **首次认证后** | `NSFileProtectionCompleteUntilFirstUserAuthentication` | 开机后首次输入密码后即可访问（即使锁定） | 推送通知、后台任务数据、大多数 App 数据 |
| **无保护** | `NSFileProtectionNone` | 任何时候均可访问 | 系统缓存、临时文件 |

### 2.2 Keychain 访问控制

Keychain 项通过 `kSecAttrAccessible` 属性控制访问时机：

| 属性 | 可访问时机 | 用途 |
|---|---|---|
| `kSecAttrAccessibleWhenUnlocked` | 设备解锁时 | 默认，最常用 |
| `kSecAttrAccessibleAfterFirstUnlock` | 首次解锁后（即使锁定） | 后台任务需要的凭证 |
| `kSecAttrAccessibleWhenPasscodeSet` | 设备设置密码后且解锁时 | 高敏感数据 |
| `kSecAttrAccessibleAlways` | 任何时候（已弃用） | 遗留代码 |

### 2.3 安全隔区（Secure Enclave）

- **非对称密钥对**：私钥永不离开 SEP，无法导出
- **数据保护主密钥**：由 SEP 持有，与设备密码绑定
- **Crypto Erase**：删除数据保护密钥即可使所有加密数据不可恢复

> **关键弱点**：内核提权后，攻击者可利用 SEP 的**授权机制**——在设备解锁状态下，SEP 会授权访问数据保护密钥，从而使攻击者获得与合法用户相同的数据访问能力。

---

## 3. 八大类覆盖数据详解

### 3.1 通信数据（Communication Data）

| 数据类型 | 存储位置 | 保护级别 | 攻击获取方式 |
|---|---|---|---|
| **SMS / iMessage** | `~/Library/SMS/sms.db`（SQLite） | CompleteUntilFirstUserAuthentication | 内核提权后直接读取 SQLite 数据库 |
| **WhatsApp 聊天** | `~/Library/ChatStorage/...` | CompleteUntilFirstUserAuthentication | 读取加密数据库 + 从 Keychain 获取解密密钥 |
| **Telegram 聊天** | App 沙箱内 SQLite | CompleteUntilFirstUserAuthentication | 同上 |
| **Signal 聊天** | App 沙箱内 SQLite | Complete（需解锁） | 内核提权 + 等待设备解锁后读取 |
| **电子邮件** | `~/Library/Mail/...` | CompleteUntilFirstUserAuthentication | 读取邮件数据库 + 附件 |
| **通话记录** | 系统数据库 | CompleteUntilFirstUserAuthentication | 直接读取 |
| **联系人** | `~/Library/AddressBook/...` | CompleteUntilFirstUserAuthentication | 读取联系人数据库 |

**真实案例**：
- **三角行动（Operation Triangulation）**：TriangleDB 植入物专门窃取 SMS、WhatsApp、Telegram 聊天记录
- **Pegasus**：读取所有即时通讯应用消息，包括已删除消息（从数据库回收站恢复）

### 3.2 媒体与文件（Media & Files）

| 数据类型 | 存储位置 | 保护级别 | 攻击获取方式 |
|---|---|---|---|
| **照片库** | `~/PhotoData/...` | CompleteUntilFirstUserAuthentication | 读取照片数据库 + 原始文件 |
| **相机拍摄** | 实时流 | N/A（实时） | 劫持摄像头进程，实时录制 |
| **视频** | 照片库 / App 沙箱 | 同上 | 同上 |
| **文档** | Files App / iCloud Drive | CompleteUntilFirstUserAuthentication | 读取文件系统 |
| **语音备忘录** | `~/Library/Recordings/...` | CompleteUntilFirstUserAuthentication | 读取录音文件 |
| **屏幕截图** | 实时流 | N/A（实时） | 劫持屏幕录制服务 |

**真实案例**：
- **Coruna / DarkSword**：扫描 BIP39 助记词时，通过屏幕截图捕获钱包应用的助记词显示画面
- **Pegasus**：激活摄像头拍摄环境照片，录制屏幕操作

### 3.3 凭证与密钥（Credentials & Secrets）

| 数据类型 | 存储位置 | 保护级别 | 攻击获取方式 |
|---|---|---|---|
| **Keychain 项** | 系统 Keychain 数据库 | 各 App 自定义 | 内核提权 + SEP 授权 → 读取所有 Keychain 项 |
| **App 密码** | Keychain / App 沙箱 | 各 App 自定义 | 从 Keychain 或配置文件读取 |
| **Session Cookie** | Keychain / NSUserDefaults | 各 App 自定义 | 窃取会话令牌，劫持登录状态 |
| **银行 App 凭证** | Keychain（高保护） | WhenUnlocked / WhenPasscodeSet | 等待设备解锁后读取 |
| **社交媒体令牌** | Keychain | AfterFirstUnlock | 首次解锁后即可读取 |
| **Wi-Fi 密码** | 系统 Keychain | 系统级保护 | 内核提权后读取 |

**真实案例**：
- **三角行动**：TriangleDB 模块专门提取 Keychain 数据，包括所有 App 存储的密码和令牌
- **Pegasus**：通过键盘记录（keylogger）捕获实时输入的密码

### 3.4 加密货币与金融数据（Cryptocurrency & Financial）

| 数据类型 | 存储位置 | 保护级别 | 攻击获取方式 |
|---|---|---|---|
| **BIP39 助记词** | 钱包 App 沙箱 / Keychain | Complete（需解锁） | 屏幕截图 + 文件读取 + Keychain 提取 |
| **私钥** | 钱包 App 沙箱 / SEP | Complete / SEP 保护 | 从内存或文件读取（若未使用 SEP） |
| **交易记录** | 钱包 App 数据库 | CompleteUntilFirstUserAuthentication | 读取 SQLite 数据库 |
| **银行 App 数据** | 银行 App 沙箱 | Complete（需解锁） | 屏幕截图 + 文件读取 |
| **支付信息** | Apple Pay / 银行 App | SEP 保护 / Complete | Apple Pay 令牌不可提取；银行卡号从 App 读取 |

**真实案例**：
- **Coruna**：专门扫描钱包应用的 BIP39 助记词显示画面，通过屏幕截图捕获 12/24 个单词
- **DarkSword**：劫持加密货币钱包应用，实时捕获交易签名
- **SpyAgent**：针对 iOS 的恶意软件，专门窃取加密钱包种子短语

> **关键风险**：大多数钱包应用将助记词以明文形式显示在屏幕上供用户备份，这成为屏幕截图攻击的主要目标。即使数据加密存储，屏幕截图绕过了所有加密保护。

### 3.5 位置与移动轨迹（Location & Movement）

| 数据类型 | 存储位置 | 保护级别 | 攻击获取方式 |
|---|---|---|---|
| **实时 GPS** | 系统位置服务 | N/A（实时） | 订阅位置更新 API |
| **位置历史** | `~/Library/Caches/...` | CompleteUntilFirstUserAuthentication | 读取位置缓存数据库 |
| **常去地点** | 系统隐私数据库 | Complete（系统级） | 内核提权后读取 |
| **地理围栏** | App 沙箱 | 各 App 自定义 | 读取 App 配置 |
| **Wi-Fi 热点** | 系统缓存 | 系统级 | 扫描当前可见 Wi-Fi |
| **蓝牙设备** | 系统缓存 | 系统级 | 扫描当前可见蓝牙 |

**真实案例**：
- **三角行动**：TriangleDB 持续监控设备地理位置，通过加密 C2 通道外传
- **Pegasus**：实时追踪位置，记录移动轨迹

### 3.6 实时监视数据（Real-time Surveillance）

| 数据类型 | 获取方式 | 保护机制 | 攻击绕过方式 |
|---|---|---|---|
| **摄像头视频** | 劫持摄像头进程 | 摄像头指示灯（绿点） | 无法绕过指示灯，但可短暂激活 |
| **麦克风音频** | 劫持麦克风进程 | 麦克风指示灯（橙点） | 无法绕过指示灯，但可短暂录制 |
| **屏幕内容** | 劫持屏幕录制服务 | 屏幕录制提示（红条） | 短暂激活，用户可能未察觉 |
| **键盘输入** | 键盘事件钩子 | 无直接提示 | 完全隐蔽，持续记录 |
| **通话音频** | 劫持通话进程 | 通话指示灯 | 仅在通话期间录制 |

**真实案例**：
- **Pegasus**：激活摄像头和麦克风进行环境监视，录制通话音频
- **三角行动**：通过内存植入物捕获实时音频

> **关键限制**：iOS 14+ 引入的摄像头/麦克风指示灯使隐蔽长期监视变得困难。攻击者只能短暂激活，或在用户预期使用摄像头/麦克风时（如视频通话）并行录制。

### 3.7 应用数据（App Data）

| 数据类型 | 存储位置 | 保护级别 | 攻击获取方式 |
|---|---|---|---|
| **SQLite 数据库** | App 沙箱 `Documents/` `Library/` | CompleteUntilFirstUserAuthentication | 读取数据库文件 |
| **App 配置文件** | App 沙箱 `Preferences/` | CompleteUntilFirstUserAuthentication | 读取 plist 文件 |
| **浏览器历史** | Safari / Chrome 沙箱 | CompleteUntilFirstUserAuthentication | 读取历史数据库 |
| **Cookie / 缓存** | App 沙箱 `Library/Caches/` | CompleteUntilFirstUserAuthentication | 读取缓存文件 |
| **下载文件** | App 沙箱 `Documents/` | CompleteUntilFirstUserAuthentication | 读取文件 |
| **App 状态** | App 沙箱 | CompleteUntilFirstUserAuthentication | 读取状态文件 |

**真实案例**：
- **三角行动**：扫描所有 App 的 SQLite 数据库，提取敏感信息
- **Coruna**：注入系统进程（`powerd` `locationd` `imagent`），访问跨 App 数据

### 3.8 系统数据（System Data）

| 数据类型 | 存储位置 | 保护级别 | 攻击获取方式 |
|---|---|---|---|
| **设备标识符** | 系统 API | 无保护 | 调用 API 获取 UDID、序列号 |
| **网络信息** | 系统配置 | 无保护 | 读取 IP、MAC、SSID |
| **已安装 App** | 系统 API | 无保护 | 枚举已安装应用列表 |
| **系统配置** | 系统数据库 | 系统级 | 内核提权后读取 |
| **日志文件** | `/var/log/` | 系统级 | 内核提权后读取 |
| **进程列表** | 系统 API | 无保护 | 枚举运行中进程 |

---

## 4. 攻击链各阶段的数据访问能力

### 4.1 阶段 1：WebKit RCE（沙箱内）

**可访问数据**：
- 浏览器 Cookie、缓存、历史
- 浏览器沙箱内的文件
- 通过浏览器 API 获取的有限信息（User-Agent、屏幕尺寸等）

**不可访问**：
- 其他 App 数据
- Keychain
- 系统文件
- 摄像头/麦克风（需用户授权）

### 4.2 阶段 2：沙箱逃逸（用户空间）

**新增可访问数据**：
- 其他 App 沙箱文件（需破解文件保护）
- 部分系统配置
- 网络流量（可嗅探）

**仍不可访问**：
- Keychain（需内核权限）
- 受保护的文件系统区域
- 摄像头/麦克风（需内核权限）

### 4.3 阶段 3：内核提权（完全控制）

**新增可访问数据**：
- **所有**文件系统数据（等待设备解锁）
- **所有** Keychain 项（通过 SEP 授权）
- 摄像头/麦克风（短暂激活）
- 屏幕内容
- 键盘输入
- 实时位置
- 所有进程内存

> **关键能力**：内核提权后，攻击者获得与设备所有者**相同的数据访问权限**。唯一限制是物理隔离的数据（如 SEP 内的私钥）和需要用户生物识别授权的数据（如 Face ID/Touch ID 保护的 Keychain 项）。

---

## 5. 真实攻击案例的数据覆盖对比

| 攻击 / 工具 | 通信 | 媒体 | 凭证 | 加密 | 位置 | 实时监视 | App 数据 | 系统 |
|---|---|---|---|---|---|---|---|---|
| **三角行动** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Coruna** | ✅ | ✅ | ✅ | ✅✅ | ✅ | ✅ | ✅ | ✅ |
| **DarkSword** | ✅ | ✅ | ✅ | ✅✅ | ✅ | ✅ | ✅ | ✅ |
| **Pegasus** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅✅ | ✅ | ✅ |
| **FORCEDENTRY** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

> ✅✅ = 重点目标；✅ = 覆盖；空白 = 未报告

---

## 6. 数据保护机制与绕过

### 6.1 Data Protection 的局限

| 保护机制 | 设计目标 | 攻击绕过方式 |
|---|---|---|
| **文件加密** | 设备锁定时保护数据 | 内核提权 + 等待设备解锁 |
| **Keychain 访问控制** | 限制凭证访问时机 | SEP 授权（设备解锁状态下） |
| **沙箱隔离** | 限制 App 间数据访问 | 沙箱逃逸 + 内核提权 |
| **SEP 密钥保护** | 私钥永不离开硬件 | 无法直接提取，但可利用授权 |

### 6.2 无法绕过的保护

| 保护机制 | 保护内容 | 为何无法绕过 |
|---|---|---|
| **SEP 私钥** | Apple Pay 令牌、部分生物识别数据 | 硬件隔离，无软件访问路径 |
| **Face ID / Touch ID 授权** | 特定 Keychain 项 | 需要物理生物识别，无法软件模拟 |
| **Secure Enclave 密钥生成** | 设备唯一密钥 | 密钥永不离开 SEP |
| **Crypto Erase** | 所有数据 | 删除主密钥后数据不可恢复 |

---

## 7. 检测与防护策略

### 7.1 数据泄露检测

| 数据类型 | 检测信号 | 检测方法 |
|---|---|---|
| **通信数据** | 异常数据库访问 | 端点行为检测（EDR） |
| **凭证泄露** | 异常 Keychain 访问 | Keychain 访问日志审计 |
| **加密货币窃取** | 屏幕截图 + 钱包 App 同时激活 | 运行时行为监控 |
| **位置追踪** | 持续位置 API 调用 | 网络流量分析 + 进程监控 |
| **实时监视** | 摄像头/麦克风异常激活 | 指示灯监控 + 进程审计 |

### 7.2 防护建议

**按数据类别**：

1. **通信数据**
   - 使用端到端加密应用（Signal）
   - 定期清理聊天记录
   - 启用消失消息功能

2. **凭证与密钥**
   - 使用强密码 + 生物识别
   - 启用 Advanced Data Protection（高级数据保护）
   - 定期审查 Keychain 访问权限

3. **加密货币**
   - 使用硬件钱包（Ledger / Trezor）存储大额资产
   - 避免在手机上显示助记词
   - 使用支持 SEP 保护的钱包应用

4. **实时监视防护**
   - 关注摄像头/麦克风指示灯
   - 启用 Lockdown Mode（锁定模式）
   - 定期检查运行中进程

5. **通用防护**
   - **及时更新 iOS**：修复已知漏洞
   - **启用 Lockdown Mode**：高危用户必选
   - **启用 Advanced Data Protection**：端到端加密 iCloud 数据
   - **定期重启设备**：清除内存植入物（针对无持久化攻击）

---

## 8. 风险评级与优先级

| 数据类别 | 风险等级 | 优先级 | 说明 |
|---|---|---|---|
| **加密货币 / 金融** | 🔴 **极高** | 1 | 直接经济损失；不可逆 |
| **凭证 / 密钥** | 🔴 **极高** | 1 | 可导致连锁泄露；长期影响 |
| **通信数据** | 🟠 **高** | 2 | 隐私泄露；社会工程攻击素材 |
| **实时监视** | 🟠 **高** | 2 | 人身安全威胁；商业间谍 |
| **位置数据** | 🟡 **中** | 3 | 行踪追踪；物理安全 |
| **媒体文件** | 🟡 **中** | 3 | 隐私泄露 |
| **App 数据** | 🟡 **中** | 3 | 业务数据泄露 |
| **系统数据** | 🟢 **低** | 4 | 侦察用途；间接风险 |

---

## 9. 结论

iOS 全链条攻击可覆盖设备上**几乎所有类型的数据**，从静态存储的通信记录、凭证、媒体文件，到实时生成的摄像头视频、麦克风音频、键盘输入、屏幕内容。

**核心风险点**：
1. **内核提权 = 完全控制**：攻击者获得与设备所有者相同的数据访问权限
2. **屏幕截图绕过加密**：即使数据加密存储，屏幕内容无法加密
3. **加密货币成为首要目标**：BIP39 助记词的显示方式使其易受屏幕截图攻击
4. **无持久化攻击难以检测**：内存植入物重启即消失，传统检测失效

**最有效防护**：
- 及时更新 iOS
- 启用 Lockdown Mode
- 使用硬件钱包存储大额加密资产
- 启用 Advanced Data Protection
- 定期重启设备

---

## 参考来源

- [Data Protection Classes — Apple Platform Security](https://support.apple.com/guide/security/data-protection-classes-secb010e978a/web)
- [Operation Triangulation, Campaign C0054 — MITRE ATT&CK](https://attack.mitre.org/campaigns/C0054/)
- [Kaspersky reveals details behind Operation Triangulation spyware](https://www.kaspersky.com/about/press-releases/kaspersky-reveals-details-behind-the-spyware-used-in-operation-triangulation)
- [The Proliferation of DarkSword: iOS Exploit Chain — Google Cloud Threat Intelligence](https://cloud.google.com/blog/topics/threat-intelligence/darksword-ios-exploit-chain)
- [Pegasus Spyware: What It Is & How to Detect It — Group-IB](https://www.group-ib.com/blog/pegasus-spyware/)
- [Pegasus (spyware) — Wikipedia](https://en.wikipedia.org/wiki/Pegasus_(spyware))
- [How to use iOS Data Protection (updated for iOS 17) — Nutrient.io](https://www.nutrient.io/blog/how-to-use-ios-data-protection/)
- [iOS Keychain and Data Protection Classes Abuse — Medium](https://medium.com/@salamsajid7/ios-keychain-and-data-protection-classes-abuse-and-misuse-759267ee03b4)
- [SpyAgent malware targets crypto wallets — IBM Security](https://www.ibm.com/think/insights/spyagent-malware-targets-crypto-wallets-stealing-screenshots)
- [Coruna: the framework used in Operation Triangulation — Securelist](https://securelist.com/triangulation-validators-modules/110847/)

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
