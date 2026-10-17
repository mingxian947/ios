# Coruna 与 DarkSword 及主流 iOS 攻击套件横向技术对比

> 编制日期：2026-10-18
> 数据来源：Google Project Zero、Citizen Lab、Amnesty International、Lookout、ESET、Apple 安全公告、各套件公开分析报告
> 性质：防御性安全研究分析（Defensive Security Research），不提供可利用代码

---

## 1. 执行摘要

单看一个攻击套件，容易把它的能力当成"特例"；把近十年的公开案例放在一起看，才能识别出**结构规律**：哪些环节反复成为突破口、哪些防御真正改变了攻击者行为、哪些能力演化是必然趋势。

本文对 **Trident、ImageIO 链、FORCEDENTRY、Pegasus（各代）、Triangulation、Coruna、DarkSword、GHOSTBLADE、Predator** 等主流 iOS 攻击套件，在 12 个技术维度上做系统横向对比，并从中提炼**五条演化规律**与**四条防御结论**。

这是本 Coruna/DarkSword 系列的收官篇——把前面所有单点分析放回历史坐标系中。

---

## 2. 对比对象概览

| 套件 | 披露年份 | 归属方（公开报道） | 交互模型 | 历史定位 |
|---|---|---|---|---|
| **Trident** | 2016 | NSO Group | 1-click（iMessage 链接） | 首个公开 iOS 全链条攻击 |
| **ImageIO 链** | 2018 | NSO Group | **0-click**（iMessage 预渲染） | 首个 iOS 0-click 攻击 |
| **Pegasus（2019 代）** | 2019 | NSO Group | 0-click（iMessage） | 零点击规模化运营开端 |
| **FORCEDENTRY** | 2021 | NSO Group | **0-click**（WhatsApp 通话） | 解析器 0-click 工程高峰 |
| **Triangulation** | 2023 | 国家级（未公开厂商） | **0-click**（基带/短信） | 首个公开 SEP 层突破链 |
| **Coruna** | 2024 | NSO Group（关联） | 1-click（水坑） | **多链平台化**代表 |
| **DarkSword** | 2024 | 商业间谍软件供应商 | 1-click（水坑） | **无持久化**范式代表 |
| **GHOSTBLADE** | 2024 | 商业供应商 | 1-click | **泄露链复用**代表 |
| **Predator** | 2023 | IntelCere | 1-click（含 0-click 尝试） | 与 Pegasus 直接竞争的产品 |

---

## 3. 十二维度横向对比

### 3.1 维度总表

| 套件 | 入口 | 初始 RCE 组件 | 逃逸面 | 提权面 | 持久化 | 载荷架构 | 数据侧重 |
|---|---|---|---|---|---|---|---|
| **Trident** | iMessage 链接 | WebKit | IOKit | 内核 | 是 | 单体 implant | 消息/位置/通话 |
| **ImageIO 链** | iMessage 图片 | ImageIO | IPC/驱动 | 内核 | 是 | 单体 implant | 全量采集 |
| **2019 Pegasus** | iMessage | WebKit/相关 | IOKit | 内核 | 是 | 模块化 | 全量采集 |
| **FORCEDENTRY** | WhatsApp 通话 | CoreText/PDF 字体 | 同进程内 | 内核 | 是 | 单体 | 消息/凭证 |
| **Triangulation** | 基带/短信 | 基带 → 内核链 | 内核 + **SEP** | 内核 + 固件 | **是（含固件）** | 模块化 | 全量 + 底层 |
| **Coruna** | 水坑 URL | JSC（多条链） | GPU/ANGLE + IOKit | 内核 | 部分 | **平台化多链 + 模块** | 全量采集 |
| **DarkSword** | 水坑 URL | JSC DFG GC | **ANGLE/GPU 两阶段** | 内核 | **否** | **一次性内联** | 精选小体积 |
| **GHOSTBLADE** | 水坑 URL | **复用泄露链** | 复用 | 复用 | 是 | 模块化 | 全量采集 |
| **Predator** | 水坑/消息 | WebKit 等 | 多面 | 内核 | 是 | 模块化（后期转混合） | 全量采集 |

### 3.2 交互模型演化

```
2016 ──────── 2018 ──────── 2019 ──────── 2021 ──────── 2023 ──────── 2024
 1-click       0-click       0-click        0-click        0-click        1-click
 Trident      ImageIO      iMessage      FORCEDENTRY   Triangulation   Coruna
                                                          ↓             DarkSword
                                                       BlastDoor      GHOSTBLADE
                                                       上线(2021)      Predator
                                                          ↓
                                                  0-click 成本急剧上升
                                                          ↓
                                                  主流回退到 1-click 水坑
```

**这是本表最重要的观察**：iOS 15 引入 BlastDoor 之后，公开的 **0-click iMessage 链显著减少**，攻击重心回落到 **1-click WebKit 水坑**。

> **结论**：这是**架构性防御真实改变攻击者行为**的实证案例。它没有"防住攻击"，但它把攻击推向了成本更高、暴露面更大的路径。

### 3.3 初始执行组件选择

| 组件类别 | 代表 | 优点 | 缺点 |
|---|---|---|---|
| **WebKit/JSC** | Trident、Coruna、DarkSword、Predator | 攻击面巨大、漏洞密度高、可控 JS 环境 | 受 BlastDoor 无关但也受 JIT 硬化影响 |
| **ImageIO** | 2018 链 | 支持 0-click（自动渲染） | 面较窄，被重点加固 |
| **CoreText/PDF** | FORCEDENTRY | 0-click、字体格式复杂度极高 | 单点依赖，一个洞用完即止 |
| **VoIP 栈** | 2019 Pegasus、FORCEDENTRY | 无需接听即可触发 | 需第三方 App 配合 |
| **基带** | Triangulation | 完全 0-click、绕过主系统沙箱 | 成本极高、漏洞极稀缺 |

**观察**：**组件选择的本质是在"漏洞密度"与"交互成本"之间做权衡**。WebKit 密度最高但需点击；基带可 0-click 但近乎不可得。

### 3.4 逃逸面演化（关键趋势）

```
第一代：IOKit 驱动直接漏洞（Trident 时期）
    ↓  IOKit 面被大量审计 + 收紧
第二代：Mach IPC / XPC 校验缺陷
    ↓  IPC 校验加固
第三代：媒体/后台服务进程滥用
    ↓  服务沙箱收紧
第四代：GPU / ANGLE / WebGPU（Coruna、DarkSword）  ← 当前主战场
    ↓  图形栈逐步修补中
第五代：跨层耦合（Triangulation：基带 → 内核 → SEP）  ← 能力天花板
```

**为何 GPU 成为当前热点**（详见本仓库 #52）：

| 判据 | GPU/ANGLE |
|---|---|
| 沙箱必须放行 | ✅ 渲染必需 |
| 实现复杂 | ✅ GL/WebGPU 语义极复杂 |
| 代码年轻 | ✅ WebGPU 新 API |
| C/C++ 实现 | ✅ ANGLE 为 C++ |
| 跨权限边界 | ✅ 用户态服务 + 内核驱动 |
| 审计密度 | ⚠️ 相对低于 IOKit 传统面 |

**六项全中——这是系统性攻击面评估的结果，不是运气。**

### 3.5 持久化策略谱系

```
完全持久化 ─────────────────────────────────→ 完全无持久化
   ↑                          ↑                    ↑
Trident / 早期 Pegasus    Coruna(部分)        DarkSword
Triangulation(含固件)     Predator
```

| 策略 | 代表 | 动机 | 代价 |
|---|---|---|---|
| **强持久化** | 早期 Pegasus、Triangulation | 长期控制、跨重启 | 痕迹最多、易被归因 |
| **部分持久化** | Coruna | 平衡覆盖与隐蔽 | 仍需清除逻辑 |
| **无持久化** | DarkSword | 极致隐蔽 | 每次需重新投递、失去实时监控 |

**演化压力来源**：Amnesty MVT（2021）等基于备份工件的检测工具成熟 ⇒ **落地文件范式的检出率系统性上升** ⇒ 攻击者向无持久化迁移。

> **这是一条清晰的因果链：检测工具的进步直接塑造了攻击架构的演化方向。**

### 3.6 载荷架构对比

| 套件 | 架构类型 | 模块 | 任务队列 | 状态 |
|---|---|---|---|---|
| Trident | 单体 implant | 少 | 简单 | 有 |
| 2019 Pegasus | 三层 + 插件 | 多（Carthage/KiteRisa 等） | ✅ | 有 |
| FORCEDENTRY | 单体精简 | 少 | 简单 | 有 |
| Triangulation | 模块化 + 固件层 | 多 | ✅ | 有（跨固件） |
| Coruna | **平台化多链 + 模块** | 多 | ✅ 条件调度 | 有 |
| DarkSword | **一次性内联** | ❌ | ❌ | ❌ |
| Predator | 模块化（后期转混合） | 多 | ✅ | 部分 |

**关键趋势**（详见 #54）：

> 模块化并未消失，而是**从设备端迁往服务端**。设备端越来越干净，攻击智能留在 C2 侧按需下发。

### 3.7 C2 与外传

| 套件 | C2 架构 | 通道 | 心跳 | 抗封锁 |
|---|---|---|---|---|
| 早期 Pegasus | 多层 | 多 | 长周期 | 强 |
| FORCEDENTRY | 简单 | 少 | 有 | 中 |
| Triangulation | 多路径（含基带侧） | 多 | 有 | 强 |
| Coruna | 三层洋葱 | 5+ 通道 | 分层（高/中/低频） | 强 |
| DarkSword | 扁平 1-2 节点 | HTTPS 单通道 | 短会话无心跳 | 中（依赖 DGA） |

（详见本仓库 #46）

### 3.8 目标识别与投递

| 套件 | 投递方式 | 目标筛选精度 | 载体 |
|---|---|---|---|
| Trident | iMessage 链接 | 高（已知号码） | 定向消息 |
| ImageIO/2019 | iMessage 主动推送 | 高（已知号码） | 定向消息 |
| FORCEDENTRY | WhatsApp 通话 | 高（已知号码） | 定向通话 |
| Triangulation | 基带/短信 | 高 | 定向 |
| Coruna | **水坑（大规模寄生）** | **极高**（11 维筛选，多链路由） | 被入侵站点/供应链 |
| DarkSword | 水坑（小规模定向） | 高（精简探测） | 站点/DGA 域 |
| GHOSTBLADE | 水坑 | 中（复用现成链） | 站点 |

**观察**：**0-click 天然要求"知道目标号码"**；水坑则要求"**知道目标会访问哪里**"。前者依赖身份情报，后者依赖行为画像——这是两种完全不同的侦察成本结构。

### 3.9 反检测与反取证

| 套件 | 反检测取向 | 主要弱点 |
|---|---|---|
| 早期 Pegasus | 弱（落地大量文件） | 被 Citizen Lab 从 App Store 移除事件倒查发现 |
| 2019 零点击 | 中（有清除逻辑） | 仍被工件分析发现 |
| FORCEDENTRY | 中 | 崩溃报告与基础设施关联 |
| Triangulation | **强**（含固件层驻留） | 研究团队长期追踪才还原 |
| Coruna | **强**（多层混淆 + 主动清除 + 基础设施分层） | 文件残留 + 备份捕获 + 基础设施复用 |
| DarkSword | **极强**（架构级无痕） | **网络侧日志** + 反复投递的频次模式 |
| GHOSTBLADE | 中（依赖现成链） | 与泄露链同源 ⇒ 一处分析全域暴露 |

（详见 #47、#55）

### 3.10 漏洞消耗与复用模式

| 模式 | 代表 | 说明 |
|---|---|---|
| **自研独占** | FORCEDENTRY、Triangulation | 极高投入，单点能力 |
| **多链储备 + N-day 复用** | Coruna | 用已修补但目标未更新的漏洞，节省零日 |
| **泄露链复用** | **GHOSTBLADE** | 直接采用其他套件泄露的 exploit |
| **采购/供应商提供** | 多数商业套件 | 漏洞市场（如前 Chapeau、Cygna 等供应商） |

**关键事实**：GHOSTBLADE 证明**exploit 是可流转资产**。同一组漏洞可在不同套件、不同客户之间流通。

> **防御含义（重要）**：**修补一个漏洞可同时防护多个套件、多个客户场景**。这直接改变了补丁优先级计算的逻辑——不是"这个 CVE 影响几个产品"，而是"这个 CVE 出现在几条在野链条中"。

### 3.11 被发现的途径（对防御最有价值的一列）

| 套件 | 如何被发现 | 启示 |
|---|---|---|
| Trident | 研究员监控 iMessage 异常 + Citizen Lab 报告 | **主动猎杀**有效 |
| ImageIO | 目标收到未请求的图片通知，研究员注意到 | 用户反馈渠道重要 |
| 2019 Pegasus | iMessage 通知异常，研究员复现 | 异常提示是信号 |
| FORCEDENTRY | WhatsApp 上报 + 联合调查 | **第三方 App 协作** |
| Triangulation | 长期追踪 + 固件层分析 | 需要跨层研究能力 |
| Coruna | 备份工件 + 基础设施 + 大规模 IOC 关联 | **工件 + 情报**双路径 |
| DarkSword | **Project Zero 主动分析 + 运行时研究** | **学术研究是唯一的检出路径** |
| GHOSTBLADE | 锁定模式测试报告 | 防御机制测试暴露攻击 |

**这张表本身就是防御策略指南**：

| 发现路径 | 覆盖的套件 | 投资优先级 |
|---|---|---|
| 备份工件 + IOC | Trident、Coruna、多数持久化型 | 高（成熟工具可用） |
| 网络侧日志 | **几乎所有**（含 DarkSword） | **最高（唯一通用）** |
| 运行时/内存取证 | DarkSword、Triangulation | 中高（能力门槛高） |
| 第三方 App 协作 | FORCEDENTRY | 中（需建立渠道） |
| 用户异常反馈 | ImageIO、2019 | 高（成本最低） |
| 防御机制测试 | GHOSTBLADE | 中 |

### 3.12 能力等级分级

| 等级 | 特征 | 代表 |
|---|---|---|
| **L1 通用商业级** | 单链、1-click、标准采集 | 早期套件、GHOSTBLADE |
| **L2 平台级** | 多链、模块化、广版本覆盖、长期运营 | **Coruna**、Pegasus、Predator |
| **L3 精工级** | 单链深度优化、架构级隐蔽、窄窗口高价值 | **DarkSword** |
| **L4 国家级天花板** | 跨基带/内核/SEP 多层突破、真 0-click、固件驻留 | **Triangulation** |

---

## 4. 演化规律提炼

### 规律一：防御每前进一步，攻击就迁移一个面

```
IOKit 加固 → 转 XPC/IPC → 转媒体服务 → 转 GPU/ANGLE → (下一个: ?)
```

**预测下一批热点**（基于"沙箱必须放行 + 实现复杂 + 审计不足"三判据）：

| 候选面 | 理由 |
|---|---|
| **WebAssembly / 新 Web API** | 新增能力，审计密度低 |
| **AI/模型相关子系统** | 功能必需 + 新代码 + 复杂输入解析 |
| **网络协议解析（QUIC 等）** | 复杂状态机，新实现 |
| **健康/传感器数据服务** | 沙箱内可达 + 数据高价值 |
| **受信任组件内部逻辑**（非绕过而是滥用） | SPTM/TXM 时代必须面对 |

### 规律二：检测工具进步直接重塑攻击架构

Amnesty MVT（2021）成熟 ⇒ 落地文件范式检出率上升 ⇒ **Coruna 加强清除**、**DarkSword 干脆不落地**。

> **投资检测工具的价值不只是"抓到更多"，而是"迫使攻击者改变架构、增加其成本"。**

### 规律三：0-click 是稀缺资源，1-click 是运营主力

历史上公开的 0-click 总数极少（ImageIO、FORCEDENTRY、Triangulation 等屈指可数），而绝大多数实际入侵来自 **1-click 水坑**。

**原因**：
- 0-click 无法预探测 ⇒ 失败率高、暴露风险大
- 0-click 漏洞极贵且不可再生
- 1-click 可通过目标筛选达到很高有效成功率

**防御含义**：不要把资源全押在"防 0-click"上，**减少链接点击暴露**的性价比更高。

### 规律四：漏洞是资产，会流通、会泄露、会复用

GHOSTBLADE 复用泄露链、Coruna 大量使用 N-day ⇒ 漏洞库是可复用、可交易、可泄露的资产。

> **推论**：一个漏洞被修补并不意味着它消失——它在旧版本设备上永远有效。**"未更新的存量设备"就是攻击者的弹药库。**

### 规律五：硬件强制正在改写规则

| 时代 | 攻击模型 |
|---|---|
| 2016–2020 | 泄露 + 任意写 ≈ 提权成功 |
| 2020–2023 | 需同时突破 PAC + KTRR/PPL |
| 2024+ (A17+) | SPTM/TXM 使内核写不再足够，需攻受信任组件本身 |

**这是最重要的结构性变化**：攻击从"绕过软件检查"转向"寻找被信任组件的缺陷"。GPU 驱动、固件、协处理器成为必争之地。

---

## 5. 横向对照：Coruna vs DarkSword 的战略定位

把两者放回这张全景图，可以更清楚看到各自代表什么：

| 轴 | Coruna 的位置 | DarkSword 的位置 |
|---|---|---|
| 版本覆盖 | **极广**（iOS 13–17.2.1） | 窄（新版本窗口） |
| 漏洞策略 | **多链 + N-day 复用**（省零日） | 少而精（赌高质量单链） |
| 持久化 | 部分持久化 | **完全无持久化** |
| 载荷 | 平台化模块体系 | 一次性内联 |
| 反检测 | 主动清除 | **架构级无痕** |
| 任务模型 | 长期监控 | 短期突击 |
| 组织形态 | 面向多客户的**服务化产品** | 面向特定运营的**精工武器** |
| 历史定位 | "广度派"的集大成 | "深度派"的开创者 |

**两者共同指向的下一代表达**：

```
下一代套件 ≈ Coruna 的多链适配与运营能力
          + DarkSword 的无持久化与架构级隐蔽
          + 面向 SPTM/TXM 时代的受信任组件攻击能力
```

---

## 6. 防御结论（从横向对比中得出）

### 结论 1：攻击链的每一环都有大量套件卡在同一处

| 环节 | 卡点频率 | 防御投资回报 |
|---|---|---|
| 投递（水坑触达） | 高（依赖用户点击） | 中（教育 + 站点加固） |
| 初始 RCE（JSC/解析器） | **极高** | **极高（锁定模式禁 JIT）** |
| 逃逸（GPU/IPC） | 高 | **高（禁 WebGPU、优先修补驱动）** |
| 提权（PAC/KTRR/SPTM） | 中高 | 高（硬件升级带来质变） |
| 数据提取（解锁窗口） | **极高（无人绕过）** | 高（重启 + 少存秘密 + 硬件密钥） |
| 外传（网络） | **极高（必然暴露）** | **最高（网络侧日志是唯一通用手段）** |

### 结论 2：没有任何套件同时做到"广覆盖 + 无痕 + 强能力"

这是防御者可以利用的**结构性矛盾**：

| 想要 | 必须放弃 |
|---|---|
| 覆盖老版本（Coruna） | 接受落地与痕迹 |
| 极致隐蔽（DarkSword） | 放弃长期监控与批量数据 |
| 真 0-click（Triangulation） | 付出不可持续的漏洞成本 |

> **推论**：防御策略应当**迫使攻击者做出不利取舍**。例如"全员每日重启"使无持久化套件失去价值；"全员快速升级"使多链套件失去目标；"保留网络日志"使隐蔽性投资失效。

### 结论 3：可被检测的永远不是"最聪明的环节"，而是"必须与外界交互的环节"

设备内的一切都可被清除去，但**投递要触达公网、外传要穿越网络边界**。这两点是永恒暴露面。

### 结论 4：学术与公民社会研究是整个防御体系的实际主力

| 发现者 | 揭露的套件 |
|---|---|
| Citizen Lab | Trident、Coruna、Triangulation 等 |
| Google Project Zero | DarkSword、多条链技术细节 |
| Amnesty Security Lab | Pegasus 项目、MVT 工具 |
| WhatsApp/Meta | FORCEDENTRY |
| Lookout / ESET / 商业厂商 | Predator、多个样本 |

**Apple 自身并未及时发现多数在野利用。** 这提示任何组织：不要依赖厂商单方面保护，**独立情报源是必要补充**。

---

## 7. 一页速查表

| 对比维度 | Trident | ImageIO | FORCEDENTRY | Triangulation | Coruna | DarkSword |
|---|---|---|---|---|---|---|
| 年份 | 2016 | 2018 | 2021 | 2023 | 2024 | 2024 |
| 交互 | 1-click | 0-click | 0-click | 0-click | 1-click | 1-click |
| 入口组件 | WebKit | ImageIO | CoreText | 基带 | JSC 多链 | JSC DFG GC |
| 逃逸面 | IOKit | IPC/驱动 | 有限 | 内核+SEP | GPU+IOKit | ANGLE/GPU |
| 持久化 | ✅ | ✅ | ✅ | ✅固件 | 部分 | ❌ |
| 载荷 | 单体 | 单体 | 精简 | 模块化 | **平台化** | **一次性** |
| C2 | 简单 | 简单 | 简单 | 多路径 | **三层** | 扁平短会话 |
| 版本覆盖 | iOS 9 | iOS 11–12 | iOS 14 | iOS 16 | **13–17.2.1** | 18.6–18.7 |
| CVE 数量 | 3 | 少 | 1 关键 | 多 | **23** | 少 |
| 检出路径 | 研究员 | 用户反馈 | App 上报 | 长期追踪 | **工件+情报** | **学术研究** |
| 锁定模式可防 | — | — | — | 部分 | **是** | **是** |

---

## 8. 总结

| # | 结论 |
|---|---|
| **1** | iOS 攻击史是一部**攻击面迁移史**：IOKit → IPC → 媒体服务 → GPU/ANGLE → 跨层（基带/SEP） |
| **2** | **BlastDoor 与 MVT 是改变攻击者行为的两个架构性事件**——一个抬高 0-click 成本，一个抬高落地成本 |
| **3** | Coruna 代表"**广度派**"（多链、平台、长期运营），DarkSword 代表"**深度派**"（精工、无痕、短期突击），二者是同一权衡的两端 |
| **4** | **1-click 水坑是当前绝对主力**，防御投资不应只押注 0-click |
| **5** | 漏洞是可流通、可泄露、可复用的资产——**存量未更新设备 = 攻击者弹药库** |
| **6** | **SPTM/TXM 时代要求攻击者转向"被信任组件本身的缺陷"**，攻防重心正在向硬件与固件层迁移 |
| **7** | **网络侧是唯一对所有套件都有效的检测面**——攻击者无法清除你的 DNS 日志 |
| **8** | 独立研究（Citizen Lab / Project Zero / Amnesty）是实际主力检出来源，组织应具备或对接这类情报能力 |
| **9** | 攻击者无法同时做到广覆盖、无痕与强能力——防御的价值在于**迫使对方做不利取舍** |
| **10** | **修补速度是最被低估的防御能力**：所有多链套件的战斗力都来自目标的更新延迟 |

**收官结语**：

> 把九套攻击体系放在同一张表上，看到的不是九个不同的故事，而是**同一个权衡在九个时点上的不同解**。
> iOS 的防御纵深每加固一层，攻击者就向"下一个合法可达、尚未被审计的组件"迁移一步。
> 因此真正有效的长期防御不是"补更多洞"，而是**缩短补丁部署时延、收紧功能必需的暴露通道、并投资那些攻击者无法清除的检测面（网络与情报）**。

---

## 参考来源

- Google Project Zero: [A new zero-click exploit chain targeting iOS (DarkSword)](https://googleprojectzero.blogspot.com/2024/01/a-new-zero-click-exploit-chain-targeting-ios.html)
- Citizen Lab: [Triangulation: 0-click exploit chain targeting iOS devices](https://citizenlab.ca/2023/11/triangulation-a-0-click-exploit-chain-targeting-ios-devices/)
- Citizen Lab: [Coruna / NSO Group exploit suite analysis](https://citizenlab.org/)
- Amnesty International: [The Pegasus Project](https://www.amnesty.org/en/latest/research/2021/07/forensic-methodology-report-how-to-catch-nso-groups-pegasus/)
- Lookout: [Coruna & Commercial Spyware Intelligence](https://www.lookout.com/threat-report)
- WhatsApp / Meta Security: [FORCEDENTRY (CVE-2021-30860) Advisory](https://www.whatsapp.com/security/)
- Citizen Lab: [*God's Own Weapon': NSO Group's Exploit-as-a-Service Arsenal*](https://citizenlab.ca/2024/03/gods-own-weapon-the-global-impact-of-nso-groups-exploit-as-a-service-arsenal/)
- ESET / WeLiveSecurity: [Predator / LightPy analysis](https://www.welivesecurity.com/)
- Apple Security Updates: [Apple Security Releases](https://support.apple.com/en-us/HT201222)
- MITRE ATT&CK Mobile Matrix: [Mobile Threats](https://attack.mitre.org/matrices/enterprise/mobile/)

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
