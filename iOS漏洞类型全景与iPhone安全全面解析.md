# iOS 漏洞类型全景与 iPhone 安全全面解析

> 编制日期：2026-10-02
> 数据来源：Apple Security Guide、Google Project Zero / Threat Intelligence、Kaspersky、CSA、公开 CVE 情报
> 性质：防御性安全研究分析（Defensive Security Research），不提供可利用代码
> 定位：本仓库 iOS 安全系列的**总纲**，串联 WebKit / PAC / 沙箱逃逸 / 内核提权 / 无文件 / EK / 案例各专题

---

## 1. 执行摘要

iPhone 的安全体系是**多层纵深防御**：硬件（SEP/PAC/PPL/KTRR）→ 内核（XNU）→ 沙箱 → 代码签名（AMCI/AMFI）→ 数据保护 → 应用隔离。攻击者要达成"完整设备沦陷"，必须**逐层击穿**；相应地，iOS 漏洞也按"被击穿的层"分类。

本报告给出 **iOS 漏洞类型全景**（从 Web 到硬件/数据），并以**全链条攻击模型**串联：

```
[Web/WebKit 零日] → [PAC 绕过] → [沙箱逃逸] → [内核提权] → [数据窃取/无持久化]
```

代表案例：**Coruna、DarkSword、GHOSTBLADE、Operation Triangulation**。结论：**没有单层是绝对的**；防御必须是"补丁 + Lockdown Mode + 分层检测"的体系。

---

## 2. iOS 安全架构总览（防御的"层"）

| 层 | 组件/机制 | 防护目标 |
|---|---|---|
| 硬件 | **Secure Enclave (SEP)**、**PAC**、**PPL/KTRR/SPTM**、安全启动 | 密钥隔离、控制流完整性、内核完整性 |
| 内核 | XNU、KASLR、W^X、代码签名内核 | 内存/进程/权限管理 |
| 沙箱 | Seatbelt profile、进程隔离 | 限制不可信进程（WebContent 等）权限 |
| 代码签名 | AMFI、签名校验 | 仅允许签名代码执行 |
| 数据保护 | Data Protection 类、钥匙串、SEP 托管密钥 | 静态/凭据数据加密 |
| 应用隔离 | 沙箱化 App、权限模型、ATS | 应用间隔离与网络安全 |
| Web 隔离 | WebKit 进程隔离、JIT 加固 | 不可信网页内容执行边界 |

**攻击 = 逐层击穿；漏洞 = 某一层的缺陷。**

---

## 3. iOS 漏洞类型全景（按层分类）

### 3.1 Web / 浏览器层（初始访问）
组件：**WebKit（渲染）+ JavaScriptCore（JSC）**
| 类型 | 说明 | 代表 CVE |
|---|---|---|
| 类型混淆 | JSC/JIT 错误假设对象类型 | CVE-2024-23222 |
| 释放后使用 (UAF) | 对象释放后仍被操作 | 多条在野链条 |
| 越界读写 (OOB) | 边界检查缺失/被优化掉 | CVE-2025-24201 |
| JIT 编译缺陷 | 优化 pass 生成错误机器码 | CVE-2025-31277 |
| 逻辑/绑定缺陷 | bindings/沙箱逻辑错误 | CVE-2025-14174 |

> 作用：获得 **WebContent 进程内 RCE**（仍受沙箱限制）。详见《WebKit RCE》专题。

### 3.2 控制流完整性层（PAC）
| 类型 | 说明 |
|---|---|
| PAC 绕过 | 指针复用 / PAC oracle / data-only / 绕过校验点 / 信息泄露组合 |
> 作用：使控制流劫持成立。PAC 保护指针但**不保护数据**，故 data-only 与复用是主要 bypass。详见《PAC 绕过》专题。

### 3.3 沙箱逃逸层
| 攻击面 | 说明 | 代表 |
|---|---|---|
| WebKit IPC / 绑定 | 调用高权限服务的 IPC 校验缺陷 | Synacktiv 研究 |
| GPU / ANGLE / WebGPU | 渲染栈/驱动缺陷，导入后台媒体服务 | DarkSword（CVE-2025-43529 链条） |
| Mach / IPC | Mach 端口、voucher 处理缺陷 | 历史链条 |
| IOKit 驱动 | 用户态可达驱动内存缺陷 | 经典逃逸面 |
> 作用：从 WebContent 突破到更高权限进程。详见《沙箱逃逸》专题。

### 3.4 内核提权层
| 类型 | 说明 | 代表 CVE |
|---|---|---|
| 内核/驱动内存破坏 | UAF/OOB/类型混淆于 XNU/IOKit | CVE-2023-32434、CVE-2025-43510/43520 |
| 硬件/MMIO 绕过 | 绕过 GPU/硬件映射保护 | CVE-2023-38606 |
| 加载器/签名缺陷 | dyld 禁用签名校验/页所有权 | CVE-2026-20700 |
| 内存管理缺陷 | 页/对象缓存缺陷提权 | CVE-2025-43510/43520 |
| Mach 陷阱缺陷 | 内核 IPC 接口处理错误 | 历史链条 |
> 作用：获得 root / 内核读写。详见《内核提权》专题。

### 3.5 硬件 / 固件层
| 类型 | 说明 | 案例 |
|---|---|---|
| 未公开硬件调试特性 | 芯片"测试/调试"功能被武器化，绕过内存保护 | Operation Triangulation |
| SEP 侧信道/实现缺陷 | 针对安全隔区的攻击（极难） | 研究级 |
| BootROM/sepROM 缺陷 | 启动链根信任缺陷（极难、影响深远） | 历史研究 |
> 特点：**软件缓解可被硬件特性架空**；修复难（硬件不可补丁或需换芯片）。

### 3.6 数据 / 凭据层
| 类型 | 说明 |
|---|---|
| 钥匙串窃取 | 高权限滥用 securityd/备份/越狱取证/运行时内存读取 |
| 数据保护类误用 | 应用错误配置保护类导致静态数据可提取 |
| 备份/配对提取 | 受信任配对或备份机制被滥用 |
> SEP 托管密钥**不可导出**，是最后防线；非 SEP 项与运行时内存是失窃面。详见《三角行动/SEP/钥匙串》专题。

### 3.7 网络 / 协议 / 基带层
| 类型 | 说明 |
|---|---|
| 基带/无线栈缺陷 | Wi-Fi/蓝牙/基带远程攻击面（零点击潜力） |
| iMessage 零点击 | 消息服务解析缺陷（三角行动投递向量） |
> 特点：可**零点击**远程触发，无需用户交互。

### 3.8 社会工程 / 配置层
| 类型 | 说明 |
|---|---|
| 恶意配置描述文件 / MDM 滥用 | 诱导安装描述文件获取控制 |
| 钓鱼/伪造门户 | 水坑配套，窃凭据或诱导访问 |
> 不依赖内存破坏，靠"人"与"配置信任"。

---

## 4. 全链条攻击模型（把各层串起来）

```
[3.1 Web 零日]  WebKit/JSC RCE (WebContent)
      → [3.2 PAC 绕过]  控制流劫持 / data-only
      → [3.3 沙箱逃逸]  GPU/IPC/IOKit → 更高权限进程
      → [3.4 内核提权]  root / 内核读写
      → [3.5 硬件绕过]  (可选) 调试特性绕内存保护
      → [3.6 数据窃取]  钥匙串/文件/密钥；或 [无持久化] 短时清除
```

**案例映射**
| 案例 | Web | PAC | 逃逸 | 内核 | 硬件 | 数据/驻留 |
|---|---|---|---|---|---|---|
| Coruna | ✓(7 CVE) | ✓ | ✓ | ✓ | – | 嵌入特权进程 |
| DarkSword | ✓(6 CVE) | ✓ | ✓(GPU) | ✓(dyld) | – | **无持久化** |
| GHOSTBLADE | 复用 DarkSword | ✓ | ✓ | ✓ | – | 无持久化 |
| 三角行动 | iMessage 零点击 | ✓ | ✓ | ✓ | **✓(调试特性)** | 内存驻留(重启消失) |

---

## 5. Apple 缓解 × 绕过 对照表

| 缓解 | 防什么 | 被绕过方式 |
|---|---|---|
| 沙箱 | 不可信进程权限 | IPC/GPU/IOKit 逃逸 |
| PAC | 控制流劫持 | 指针复用/data-only/oracle |
| PPL/KTRR | 内核完整性 | 内核零日 + 硬件绕过 |
| 代码签名/AMFI | 任意代码执行 | dyld/签名校验缺陷 |
| SEP | 密钥导出 | 不防运行时读取/合法调用 |
| KASLR | 地址猜测 | 信息泄露 |
| Lockdown Mode | 整体攻击面 | 非绝对；攻击者主动回避或找非 Web 向量 |
| JIT 加固 | JIT 注入 | 逻辑缺陷/data-only |

---

## 6. 分层防御建议

1. **补丁（所有层的基础）**：Web/内核/驱动零日修复靠系统更新（iOS 18.7.x / 26.3+）。
2. **Lockdown Mode（高危）**：收紧 Web/消息/连接攻击面，使全链条前置失效。
3. **运行时/行为检测**：WebContent 崩溃→异常内存/子进程、GPU/IPC 异常、securityd/钥匙串异常、DGA 外传（移动端 EDR/MTD）。
4. **内存取证能力**：无持久化/内存驻留植入需"重启前捕获内存"（Volatility/MemInspect）。
5. **数据层加固**：关键密钥 SEP 托管 + This Device Only；最小化钥匙串明文项。
6. **配置/人**：警惕描述文件、钓鱼、伪造门户；企业侧 MDM 与白名单治理。
7. **资产可视化**：清点受影响版本设备，优先升级高危人群。

---

## 7. 结论

iOS 漏洞按"被击穿的层"可分为八大类：**Web/WebKit、PAC、沙箱逃逸、内核提权、硬件/固件、数据/凭据、网络/基带、社会工程/配置**。全链条攻击把它们串成"Web 零日 → PAC → 逃逸 → 内核 → 数据"的流水线，Coruna/DarkSword/GHOSTBLADE/三角行动 是各阶段的现实注脚。Apple 的多层缓解（沙箱/PAC/PPL/SEP/签名/Lockdown）持续抬高门槛，但**没有单层是绝对的**：硬件调试特性可架空软件缓解，SEP 不防运行时读取，Lockdown 非绝对免疫。**因此 iPhone 安全的正解是体系化纵深防御：及时补丁 + Lockdown Mode + 分层运行时检测 + 数据层加固 + 资产与人的治理。**

---

## 参考来源
- [Apple Security Guide (Secure Enclave / 平台安全)](https://support.apple.com/en-ie/guide/security/sec59b0b31ff/web)
- [A very deep dive into iOS Exploit chains found in the wild — Google Project Zero](https://projectzero.google/2019/08/a-very-deep-dive-into-ios-exploit.html)
- [Coruna: The Mysterious Journey of a Powerful iOS Exploit Kit — Google Cloud TI](https://cloud.google.com/blog/topics/threat-intelligence/coruna-powerful-ios-exploit-kit)
- [The Proliferation of DarkSword: iOS Exploit Chain — Google Cloud TI](https://cloud.google.com/blog/topics/threat-intelligence/darksword-ios-exploit-chain)
- [Kaspersky reveals details behind the spyware used in Operation Triangulation](https://www.kaspersky.com/about/press-releases/kaspersky-reveals-details-behind-the-spyware-used-in-operation-triangulation)
- [Kaspersky discloses iPhone hardware feature vital in Operation Triangulation](https://www.kaspersky.com/about/press-releases/kaspersky-discloses-iphone-hardware-feature-vital-in-operation-triangulation-case)
- [About Lockdown Mode — Apple Support](https://support.apple.com/en-us/105120)

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
