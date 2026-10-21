# iOS 安全研究文章库

面向防御的 iOS 安全研究（Defensive Security Research）合集。围绕 **iOS 全链条攻击链** 展开：从远程投递、初始代码执行，到 PAC 绕过、沙箱逃逸、内核提权，最终完成数据窃取与痕迹清除。

> 声明：本仓库所有文章均用于**防御性安全研究与教育目的**，帮助读者理解攻击原理、提升检测与加固能力，不提供任何可直接使用的攻击代码或武器化工具。

---

## 攻击链全景

```
[0] 侦察/投递 → [1] 初始访问(WebKit/JSC) → [2] PAC 绕过 → [3] 沙箱逃逸
      → [4] 内核提权 → [5] 数据窃取(SEP/钥匙串) → [6] 外传 → [7] 驻留/无持久化
```

---

## 文章索引

### 一、综述与全景
| # | 文章 | 主题 |
|---|---|---|
| 1 | [iOS 核心漏洞与攻击链分析报告](iOS核心漏洞与攻击链分析报告.md) | 以攻击链为主轴，串联各环节核心漏洞、CVE、缓解与绕过 |
| 2 | [iOS 漏洞类型全景与 iPhone 安全全面解析](iOS漏洞类型全景与iPhone安全全面解析.md) | 8 大漏洞类别 + 全链条模型 + 案例映射 + 缓解×绕过 |
| 22 | [iOS 系统漏洞概述分析报告](iOS系统漏洞概述分析报告.md) | 10+ 子系统漏洞编目、历史统计、演进趋势与防御纵深全景 |
| 32 | [iOS Exploit Chain 完整攻击链分析](iOS_Exploit_Chain完整攻击链分析.md) | 七阶段全链条解析：投递→初始访问→PAC绕过→沙箱逃逸→内核提权→数据窃取→外传→驻留/清除 |

### 二、攻击链各阶段
| # | 文章 | 对应阶段 |
|---|---|---|
| 3 | [WebKit 远程代码执行分析文章](WebKit_远程代码执行分析文章.md) | 阶段 1 · 初始访问 |
| 21 | [iOS Safari 浏览器引擎安全分析报告](iOS_Safari浏览器引擎安全分析报告.md) | 阶段 1 · WebKit 架构、JSC 引擎、沙箱模型与攻击面深度分析 |
| 30 | [iOS WebKit 漏洞：从 JavaScriptCore 到 JIT 利用原理](iOS_WebKit漏洞从JavaScriptCore到JIT利用原理.md) | 阶段 1 · JSC 执行管线、JIT 投机优化、类型混淆/OOB/UAF、addrof/fakeobj 原语与 JIT 硬化 |
| 4 | [iOS PAC 绕过分析文章](iOS_PAC绕过分析文章.md) | 阶段 2 · 指针认证绕过 |
| 5 | [iOS 沙箱逃逸分析文章](iOS_沙箱逃逸分析文章.md) | 阶段 3 · 沙箱逃逸 |
| 29 | [iOS Sandbox Escape 技术详解](iOS_Sandbox_Escape技术详解.md) | 阶段 3 · 六大逃逸路径深度解析：Mach IPC、XPC、IOKit、GPU/ANGLE、媒体服务、WebKit IPC |
| 6 | [iOS 内核提权分析文章](iOS_内核提权分析文章.md) | 阶段 4 · 内核提权 |
| 7 | [iPhone 本地提权漏洞分析报告](iPhone本地提权漏洞分析报告.md) | 阶段 4 · 本地提权（LPE） |
| 33 | [iOS Kernel Exploitation 与 KTRR/PPL 绕过技术详解](iOS_Kernel_Exploitation与KTRR_PPL绕过技术详解.md) | 阶段 4 · XNU 内核攻击面、KTRR/PPL/SPTM/TXM 机制与绕过、内核利用原语 |
| 8 | [内存无文件攻击分析文章](内存无文件攻击分析文章.md) | 阶段 7 · 无持久化 / 反取证 |
| 26 | [iOS 基带与无线通信安全分析报告](iOS基带与无线通信安全分析报告.md) | 无线攻击面 · 基带处理器、Wi-Fi/蓝牙/NFC、IMSI Catcher、GPS 欺骗与防御 |

### 三、数据保护与密钥
| # | 文章 | 主题 |
|---|---|---|
| 9 | [三角行动 · Secure Enclave · 钥匙串窃取分析报告](三角行动_SecureEnclave_钥匙串窃取分析报告.md) | SEP、Data Protection、Keychain 访问控制及其滥用 |
| 20 | [iOS 覆盖数据类别分析报告](iOS覆盖数据类别分析报告.md) | 8 大数据类别、Data Protection _classes、Keychain 访问属性与真实案例映射 |
| 23 | [iOS 数据采集能力分析报告](iOS数据采集能力分析报告.md) | 采集架构、静态/实时/加密资产提取、外传通道、反检测与案例对比 |

### 四、真实案例与漏洞利用套件
| # | 文章 | 主题 |
|---|---|---|
| 10 | [iOS Coruna 与 DarkSword 系统分析报告](iOS_Coruna_DarkSword_安全分析报告.md) | 两代全链条利用套件对比与系统分析 |
| 11 | [DarkSword 深度分析报告](DarkSword_深度分析报告.md) | DarkSword 无持久化全链条深度剖析 |
| 12 | [漏洞利用套件 Exploit Kit 分析报告](漏洞利用套件ExploitKit分析报告.md) | Exploit Kit 生态、投递与演化 |
| 13 | [GHOSTBLADE 与锁定模式分析报告](GHOSTBLADE与锁定模式分析报告.md) | GHOSTBLADE 复用泄露链 + Lockdown Mode 防护 |
| 14 | [iOS 水坑攻击与网页零日漏洞分析报告](iOS_水坑攻击与网页零日漏洞分析报告.md) | 水坑投递 + 网页零日 |
| 15 | [Coruna 漏洞影响版本分析报告](Coruna漏洞影响版本分析报告.md) | Coruna 五条利用链 × 23 个漏洞 × iOS 13–17.2.1 版本覆盖深度分析 |
| 24 | [iOS 著名漏洞案例系统网络安全文档](iOS著名漏洞案例系统网络安全文档.md) | Pegasus/FORCEDENTRY/Triangulation/checkm8/Coruna/DarkSword 等案例档案、横向对比、TTP 模式提炼 |
| 25 | [Pegasus 商业间谍软件利用 iOS 漏洞全过程分析报告](Pegasus商业间谍软件利用iOS漏洞全过程分析报告.md) | Pegasus 四代利用链技术演进（2016 Trident → 2018 ImageIO → 2019 零点击 → 2021 FORCEDENTRY → 2022+ M.O.）、持久化演化、目标分析与检测取证 |
| 35 | [Pegasus 攻击链总体结构](Pegasus攻击链总体结构.md) | 7 层功能栈架构、各代攻击链结构对比、核心模块解析、反检测体系、C2 基础设施与模块化设计 |
| 36 | [iOS Trident 漏洞链技术详解](iOS_Trident漏洞链技术详解.md) | 首个公开 iOS 全链条攻击：CVE-2016-4655/4656/4657 三漏洞串联、KASLR 绕过、内核提权与历史意义 |
| 37 | [iOS ImageIO 0-click 漏洞链技术详解](iOS_ImageIO_0-click漏洞链技术详解.md) | 首个 iOS 0-click 攻击：iMessage 预渲染攻击面、ImageIO 解析漏洞、CVE-2018-4328/4331/4335 链式利用 |
| 38 | [iOS FORCEDENTRY 0-click 漏洞链技术详解](iOS_FORCEDENTRY_0-click漏洞链技术详解.md) | WhatsApp 0-click 攻击：VoIP 呼叫无需接听、CoreText 字体解析漏洞 CVE-2021-30860、全球影响与 Apple 响应 |
| 39 | [Coruna WebKit 漏洞链技术详解](Coruna_WebKit漏洞链技术详解.md) | Coruna 初始访问阶段：CVE-2024-23222 JSC 类型混淆、addrof/fakeobj 原语、与 DarkSword 对比 |
| 40 | [Coruna 沙箱逃逸技术详解](Coruna_沙箱逃逸技术详解.md) | Coruna 沙箱逃逸：GPU/ANGLE 攻击面、IOGPUDevice 内核驱动漏洞、与 DarkSword 逃逸路径对比 |
| 41 | [Coruna 内核提权与 PAC 绕过技术](Coruna_内核提权与PAC绕过技术.md) | Coruna 内核提权：PAC 机制与绕过、KTRR/PPL 影响、SPTM/TXM 硬件保护、与 DarkSword 对比 |
| 42 | [Coruna 数据采集模块架构分析](Coruna_数据采集模块架构分析.md) | 模块化采集架构、静态/实时监控、加密资产窃取、数据外传机制、与 DarkSword 对比 |
| 43 | [DarkSword ANGLE/WebGPU 逃逸技术详解](DarkSword_ANGLE_WebGPU逃逸技术详解.md) | DarkSword 两阶段逃逸：ANGLE 层利用、WebGPU 攻击面、CVE-2025-43529、媒体服务注入、与 Coruna 对比 |
| 44 | [DarkSword 媒体服务注入技术详解](DarkSword_媒体服务注入技术详解.md) | mediaserverd 架构与权限、音频/视频注入向量、解析漏洞利用、从用户态到系统级权限 |
| 45 | [DarkSword 无持久化内存驻留技术](DarkSword_无持久化内存驻留技术.md) | Fileless 驻留策略、内存注入与执行、反取证机制、与 Coruna 持久化对比、检测与防御 |
| 46 | [Coruna 与 DarkSword C2 通信协议分析](Coruna与DarkSword_C2通信协议分析.md) | C2 多层架构对比、通信协议与加密、心跳与任务下发、数据回传通道、反检测策略与网络检测 |
| 47 | [Coruna 与 DarkSword 反检测机制对比](Coruna与DarkSword_反检测机制对比.md) | 六维工件面对比、主动清除型 vs 天然无痕型、MVT 与网络检测有效性、攻防权衡与检测分层策略 |
| 48 | [Coruna 与 DarkSword 防御与检测指南](Coruna与DarkSword_防御与检测指南.md) | 威胁建模分层、加固清单、MVT/网络/内存四条检测流程、应急响应时序、SIEM 规则速查与常见误区 |
| 49 | [Coruna 与 DarkSword 漏洞武器化工程与利用链编排架构](Coruna与DarkSword_漏洞武器化工程与利用链编排架构.md) | L0-L6 武器化层次、多链编排 vs 单链精工、目标探测与原语升阶梯、可靠性工程、可观测攻击状态 |
| 50 | [Coruna 与 DarkSword 水坑投递基础设施与目标识别机制](Coruna与DarkSword_水坑投递基础设施与目标识别机制.md) | 四类站点获取路径、三层基础设施、11 维目标识别筛选链、条件化内容分发、站点加固与画像复现取证 |
| 51 | [Coruna 与 DarkSword KASLR 绕过与内核信息泄露技术](Coruna与DarkSword_KASLR绕过与内核信息泄露技术.md) | 三层随机化模型、五类内核泄露来源、kslide 推导路径、SPTM/TXM 影响、由 CVE 类型反推链条阶段 |
| 52 | [Coruna 与 DarkSword BlastDoor 与沙箱模型对抗分析](Coruna与DarkSword_BlastDoor与沙箱模型对抗分析.md) | Seatbelt 沙箱结构、BlastDoor 设计与 0-click 经济学、功能必需通道为何无法闭合、GPU 栈逃逸与锁定模式效果 |
| 53 | [Coruna 与 DarkSword SEP 与钥匙串密钥提取路径](Coruna与DarkSword_SEP与钥匙串密钥提取路径.md) | 数据保护三层结构、解锁状态窗口、Keybag 与保护等级、三条 Keychain 提取路径、绕过而非攻破 SEP 的原因 |
| 54 | [Coruna 与 DarkSword 模块化载荷编排与插件体系](Coruna与DarkSword_模块化载荷编排与插件体系.md) | 五层载荷模型、模块清单/任务队列/条件调度、一次性内联执行、模块迁移趋势与架构反推任务意图 |
| 55 | [Coruna 与 DarkSword 反取证与痕迹清除体系](Coruna与DarkSword_反取证与痕迹清除体系.md) | iOS 工件全景图、时间篡改/日志清除/崩溃规避、清除型 vs 零生成型、检测延迟与取证采集顺序铁律 |
| 56 | [Coruna 与 DarkSword 及主流 iOS 攻击套件横向技术对比](Coruna与DarkSword_与主流攻击套件横向技术对比.md) | Trident/FORCEDENTRY/Triangulation/Coruna/DarkSword 等九套体系十二维度对比、五条演化规律与一页速查表 |
| 57 | [iOS WebKit JIT 硬化与 Coruna/DarkSword 利用对抗演进](Coruna与DarkSword_WebKit_JIT硬化与利用对抗演进.md) | JSC 四级管线与投机优化缺陷、Gigacage/指针膨胀/CoW 页保护、锁定模式禁用 JIT 的移除型防御 |
| 58 | [iOS 图形栈攻击面全景：ANGLE、WebGPU、Metal 与 IOGPU](Coruna与DarkSword_图形栈攻击面全景与逃逸主战场.md) | 六层图形栈结构与跨层信任假设、沙箱不可关闭的原因、驱动 CVE 价值分级、GPU 利用检测信号与 AI 计算预警 |
| 59 | [Coruna 与 DarkSword 的 MITRE ATT&CK 战术映射与检测覆盖缺口](Coruna与DarkSword_ATT&CK战术映射与检测覆盖.md) | ID 可信度三档、逐战术映射与两套体系实现差异、数据源约束下的覆盖度核算、矩阵空洞与自定义 ID |
| 60 | [iOS 0-click 利用技术演化史：从短信解析链到 Coruna 与 DarkSword](Coruna与DarkSword_0click利用技术演化史.md) | 无交互/无渲染/无解锁三层分级、解析器为何是唯一天然入口、十年入口下沉规律、0-click 与 1-click 经济学、检测受限项与现实抓手 |
| 61 | [Apple 安全事件响应与补丁工程机制：从漏洞报告到 SWU 的时间账](Apple安全事件响应与补丁工程机制.md) | 四条漏洞接收通道、三段延迟模型、RSR 与静默修补、补丁暴露天数 PED 度量、披露机制张力与自查指标 |
| 62 | [iOS 取证的证据链与法律效力：从设备提取到可采性认定](iOS取证证据链与法律效力分析.md) | 四类可采性要件、提取层级与 BFU/AFU 分水岭、工件证明力矩阵、哈希链与保管链、"未发现≠未感染"表述纪律 |
| 31 | [iOS 威胁情报与全球 APT 组织图谱分析报告](iOS威胁情报与全球APT组织图谱分析报告.md) | 国家级 APT、商业间谍公司、攻击能力分级、目标分析、MVT 检测与行业协作 |

### 五、越狱专题
| # | 文章 | 主题 |
|---|---|---|
| 16 | [iOS 越狱漏洞分析报告](iOS越狱漏洞分析报告.md) | 越狱类型、漏洞原语与 checkm8 等 |

### 六、载荷与组件
| # | 文章 | 主题 |
|---|---|---|
| 17 | [iOS 恶意载荷与组件分析报告](iOS恶意载荷与组件分析报告.md) | 分层载荷、注入/持久化/C2/窃取/反分析组件与 AI 定制 |

### 七、凭证窃取与擦除
| # | 文章 | 主题 |
|---|---|---|
| 18 | [iOS 凭证窃取与擦除分析报告](iOS凭证窃取与擦除分析报告.md) | Keychain/Data Protection/SEP 保护体系、凭证窃取手法、反取证与破坏性擦除 |

### 八、硬件与系统防御
| # | 文章 | 主题 |
|---|---|---|
| 19 | [iOS 硬件与系统防御分析报告](iOS硬件与系统防御分析报告.md) | 安全启动链、Secure Enclave、PAC/PPL/KTRR、AMFI、Data Protection、沙箱与 Lockdown Mode |
| 34 | [iOS Lockdown Mode 安全机制与绕过分析](iOS_Lockdown_Mode安全机制与绕过分析.md) | 锁定模式设计原理、各子系统限制详解、对攻击链影响、绕过技术与局限、启用建议 |
| 27 | [苹果 SPTM、TXM 与 Exclaves 安全架构解析](苹果SPTM_TXM_Exclaves安全架构解析.md) | A17+ 芯片级硬件信任根：SPTM 页表监控、TXM EL3 信任根、Exclaves 协处理器隔离 |

### 九、供应链安全
| # | 文章 | 主题 |
|---|---|---|
| 28 | [iOS 供应链攻击分析报告](iOS供应链攻击分析报告.md) | XcodeGhost、依赖投毒、企业证书滥用、App Store 审核绕过、运行时注入与防御体系 |

---

## 核心防护要点（TL;DR）

1. **升级系统**：iOS/iPadOS 升级至 **18.7.3+**（iOS 26 用户升级至 **26.3+**），其余 Apple OS 同步更新至最新。
2. **启用锁定模式（Lockdown Mode）**：高危人群强烈建议开启——多数高级链检测到锁定模式会主动中止。
3. **运行时行为检测**：从依赖持久化特征转向进程注入、WebGPU 异常、钥匙串异常访问等运行时信号。
4. **网络遥测**：监控 DGA 域名与异常加密外传，封禁已知恶意/伪造门户。
5. **资产可视化**：清点受影响 Apple 设备，建立版本基线与升级跟踪。

---

## 目录说明

- 每篇文章均为独立 Markdown，结尾附**参考来源**链接。
- 涉及的具体 CVE 与阶段对应关系来自公开情报汇总，**以 Apple 官方安全公告为权威口径**，建议交叉核对。

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
