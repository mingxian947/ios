# Coruna 与 DarkSword Secure Enclave 与钥匙串密钥提取路径

> 编制日期：2026-10-18
> 数据来源：Apple 安全架构文档、Google Project Zero、Triangulation 分析报告、Amnesty International、XNU 开源源码、公开 CVE 情报
> 性质：防御性安全研究分析（Defensive Security Research），不提供可利用代码

---

## 1. 执行摘要

攻击链的前六个环节（投递、执行、逃逸、提权）解决的都是"**如何进入设备**"；只有到**数据保护体系被突破**的那一刻，攻击才真正产生价值。

iOS 的数据保护由三层协同构成：**Secure Enclave（SEP）** 提供硬件密钥根、**Data Protection** 提供文件级加密与访问类、**Keychain** 提供凭证保管与访问控制。Coruna 与 DarkSword 在这一层的选择不相同，直接决定了它们能拿走什么数据、留下什么痕迹。

本文解析：

1. 三层保护体系的实际结构与依赖关系
2. **解锁状态窗口（Unlock Window）** 为何是整个体系的最大弱点
3. 密钥包（Keybag）与 `Data Protection classes` 的攻防意义
4. Coruna 的 Keychain 批量提取路径
5. DarkSword 的内存态短时提取路径
6. SEP 攻击（Triangulation 类）为何是极少数能力，以及对 Coruna/DarkSword 的启示
7. 防御与检测要点

---

## 2. 数据保护三层结构

### 2.1 层次模型

```
┌────────────────────────────────────────────────────┐
│ ③ Keychain（凭证层）                                │
│    服务名/账户/属性/访问组；条目本身受 Data Protection 加密 │
├────────────────────────────────────────────────────┤
│ ② Data Protection（文件层）                         │
│    每个文件有 Class（保护等级）+ per-file key          │
│    key 被 class key 包裹；class key 由 Keybag 提供     │
├────────────────────────────────────────────────────┤
│ ① Secure Enclave（硬件信任根）                      │
│    设备唯一 UID 密钥（不出芯片）                      │
│    负责 Keybag 的解封与密钥派生                        │
└────────────────────────────────────────────────────┘
         ↑ 依赖
   用户锁屏密码（passcode）+ 硬件 UID
```

### 2.2 密钥派生链

```
硬件 UID key (SEP 内部，不可导出)
        ↓
SEP 包裹密钥 (device-specific)
        ↓  + 用户 passcode 参与
Keybag（含各类 class key）
        ↓ 解封
Class keys（每个保护等级一个）
        ↓ 包裹
Per-file keys（每个文件一个）
        ↓
实际数据 AES 密文
```

**关键结论**：
- **攻击者若只有磁盘镜像而没有解锁设备/密钥包，理论上无法解密**
- **攻击者若已取得内核读写且设备处于解锁态，class key 已在内存中可用** → 这是绝大多数现实路径

### 2.3 SEP 的角色与限制

| 属性 | 说明 |
|---|---|
| 独立处理器 | 与主 CPU 物理分离，独立内存与总线 |
| 独立启动链与固件 | 有自己签名验证的安全启动 |
| 密钥存储 | 设备唯一密钥、anti-replay 存储、安全存储区 |
| 隔离执行 | 应用通过 `TrustCache`/安全服务请求 SEP 操作（如签名、密钥生成） |
| 攻击者难以直接读取 | 主系统被完全攻破时，SEP 内部密钥仍不出芯片 |

> **这正是 iOS 数据保护的最后一道防线**：主处理器沦陷 ≠ 所有数据沦陷。

---

## 3. 核心弱点：解锁状态窗口

### 3.1 Data Protection 类与解锁状态的关系

iOS 定义了多个保护等级，其"何时可解密"不同：

| 保护类（概念） | 可解密时机 | 攻击价值 |
|---|---|---|
| **Complete** | **仅解锁状态下**；锁屏后密钥被从内存清除 | 最低（锁屏后数据不可得） |
| **CompleteUntilFirstUserAuthentication** | 首次解锁后**直到重启**均可解密 | 高（最常见的默认等级） |
| **NoLock**（设备密钥类） | 无需用户认证即可解密 | 用于系统数据、后台功能 |
| **KDB / 密钥包本身** | 依赖 passcode + SEP | 由 SEP 保护 |

**工程事实**：大量 App 数据实际落在 `CompleteUntilFirstUserAuthentication`（历史上因后台推送、后台处理需求而默认如此）。这意味着：

> **只要设备当天被解锁过一次且未重启，攻击者取得内核读写后即可解密相当多的数据。**

### 3.2 攻击窗口时间线

```
[用户解锁设备] ──────────────────── [锁屏] ───────── [重启]
      │                                │                │
      ├─ class key 进入内存              ├─ Complete 类密钥被清除   ├─ 所有密钥消失
      ├─ Keychain 可被访问               ├─ CUntilFirst 仍可用      └─ 需 passcode 重新解封
      └─ 攻击链可执行采集                 └─ 攻击仍可读取多数数据
```

**防御含义**：**重启是真正重置安全状态的动作**，锁屏不是。这也与前面无持久化文章的结论一致：定期重启同时对"清除攻击者驻留"和"关闭密钥窗口"有效。

---

## 4. Keychain 的攻击路径

### 4.1 Keychain 的保护机制

| 机制 | 说明 |
|---|---|
| **访问组（Access Group）** | 条目限定到具有相同 entitlement + 组标识的 App 集合 |
| **entitlement 校验** | 由 code signing + AMFI 保证 |
| **`kSecAttrAccessible` 等级** | 决定何时可解密（对应 Data Protection 类） |
| **生物识别 / 密码二次确认** | 部分条目要求 `kSecAccessControl*` 级别的用户存在性验证 |
| **keychain 存储本身加密** | 底层由 Data Protection 保护 |

### 4.2 内核提权后的三种提取路径

#### 路径 A：调用 keychain API（借合法服务）

```
内核读写 → 注入 keychaind / securityd 相关进程
        → 在特权进程上下文中调用 Keychain API
        → 绕过 access group 校验（因为攻击代码运行在授权进程内）
```

| 优点 | 缺点 |
|---|---|
| 不破坏加密结构，取到明文值 | 需要影响安全守护进程（行为可检测） |
| 可复用 SEP 提供的解密服务 | 部分条目要求用户在场验证，无法批量取 |

#### 路径 B：直接读取 keychain 存储文件 + class key

```
内核读写 → 定位 class key（内存中）
        → 读取 keychain 数据库文件
        → 在攻击者代码中解密全部条目
```

| 优点 | 缺点 |
|---|---|
| 批量、一次性、不需反复触发服务 | 需要在内核态操作（易 panic） |
| 不产生逐条 API 审计线索 | 需要正确的密钥与格式知识 |

#### 路径 C：备份/同步侧提取

```
不直接攻击 keychain，而是：
 - 触发一次加密备份（凭证由用户提供）
 - 利用 iCloud Keychain 同步链（需账户控制）
 - 读取已在 App 内存中的凭证（App 层，门槛低）
```

**路径 C 常被忽视但性价比最高**：许多 App 把 token、密码缓存在自己的容器或内存中，绕过了 Keychain 的所有保护。

### 4.3 SEP 相关凭证

| 目标 | 说明 | 可行性 |
|---|---|---|
| Apple Pay / 卡密钥 | 由 SEP 保管，永不导出 | ❌ 主系统沦陷也拿不到 |
| Secure Enclave 密钥（如生物识别模板） | SEP 内处理，不出芯片 | ❌ |
| **SEP 密封数据（sealed key）** | 依赖 passcode + UID 解封 | ⚠️ 需 passcode 或已解锁态 |
| Face ID 数据 | 存于 SEP，仅 SEP 可解释 | ❌ |
| **加密备份的密码** | 用户掌握，不在 SEP | ✅ 若在内存/剪贴板中可得 |
| 2FA TOTP 种子 | 通常存于 App 容器/Keychain | ⚠️ 取决于保护等级 |

---

## 5. Coruna 的密钥提取策略

### 5.1 采集架构定位

Coruna 采用**模块化持久化采集**（详见本仓库 #42），其密钥提取环节具备以下特征：

| 特征 | 说明 |
|---|---|
| **提权后长期驻留** | 可持续等待数据可得窗口（如用户解锁期间分多次采集） |
| **Keychain 批量导出** | 优先在解锁态执行完整凭证提取 |
| **App 数据直接读取** | 利用内核权限跨越沙箱读取各 App 容器 |
| **消息库直接读取** | 短信/iMessage 数据库文件（配合 class key 解密） |
| **重复采集与增量同步** | 可长期监控新增凭证、新消息 |

### 5.2 与外传通道配合

Coruna 的密钥/数据提取与多通道外传（#46）耦合：

```
[解锁窗口] → Keychain 批量导出 → 内存中加密打包
                                    ↓
                            HTTPS 主通道外传
                            （分块，避免单次异常大流量）
```

### 5.3 Coruna 的痕迹代价

因落地与持久化，其数据提取环节也会留下痕迹：

| 痕迹 | 说明 |
|---|---|
| Keychain 访问日志/审计异常 | 服务侧调用可被观测 |
| App 容器 atime 变化 | 文件被读取的证据（受文件系统特性限制） |
| 采集数据临时缓冲 | 大数据打包时可能短驻内存/存储 |
| 落地模块本身 | 采集模块代码在文件系统上 |

---

## 6. DarkSword 的密钥提取策略

### 6.1 短时窗口内完成

DarkSword 无持久化，因此必须在**单次会话（分钟级）**内完成所有提取：

| 约束 | 工程响应 |
|---|---|
| 无法等待未来的解锁窗口 | **会话开始时即判定解锁状态**，不满足则降级任务或中止 |
| 不能反复调用特权服务 | 优先一次性批量读取，减少 API 往返 |
| 不能落地采集模块 | 提取逻辑在内存中构建，执行后立即清除 |
| 会话时长有限 | 只采集**高价值小体量数据**（密钥、token、凭证），不做大文件批量 |

### 6.2 采集侧重差异

| 数据类型 | Coruna | DarkSword |
|---|---|---|
| Keychain 凭证全量 | ✅ | ⚠️ 选择性（高价值项） |
| 消息历史全量 | ✅ | ⚠️ 有限（近期/关键会话） |
| 照片库批量 | ✅ | ❌（体积大、耗时长） |
| 实时监听（麦克风/位置） | ✅（长期驻留可做到） | ❌（架构不支持） |
| 加密资产（钱包种子） | ✅ | ✅（小体积高价值，最适合） |
| 认证器 TOTP 种子 | ✅ | ✅ |

> **关键推论**：无持久化架构天然偏好"**体积小、价值高**"的目标——加密钱包种子、会话 token、2FA 种子正是最典型的 DarkSword 式目标。

### 6.3 无痕优势

| 方面 | DarkSword |
|---|---|
| 文件落地痕迹 | 无 |
| 备份可捕获 | 内存内容不进备份 |
| 重启后取证 | 全部消失 |
| 唯一暴露面 | 网络侧 DNS/流量元数据 |

---

## 7. 对比：两套体系的数据保护对抗

| 维度 | Coruna | DarkSword |
|---|---|---|
| 是否依赖解锁窗口 | 强依赖，但可等待 | 强依赖，且不可等待 |
| 提取范围 | 全量、可重复 | 精选、一次性 |
| 主要路径 | 内核权限 + 模块持久驻留采集 | 内核权限 + 内存态短时读取 |
| 是否影响守护进程 | 较少（直接文件/keybag 路径） | 视实现，可能注入媒体服务 |
| 对 SEP 的态度 | **绕过而非攻破**（利用解锁态内存密钥） | **绕过而非攻破**（同） |
| 实时数据（麦克风/位置） | ✅ 支持 | ❌ 不支持 |
| 痕迹量 | 中（可清除） | 极低 |
| 事后取证可行性 | ✅ 备份扫描可发现 | ⚠️ 几乎只剩网络侧 |

**共同点（最重要的洞察）**：

> **两者都没有、也不需要攻破 Secure Enclave。**
> 它们都利用"**已解锁设备内存中已存在 class key**"这一结构性事实。
> SEP 提供了极强的静态保护（断电、锁屏后），但对"运行时"数据的保护必然依赖密钥在内存中的存在——这是所有加密体系的固有局限。

---

## 8. 反面参照：为什么 Triangulation 类 SEP 攻击如此罕见

理解"绕过 SEP"的普遍性，也要理解"直接攻击 SEP"的极端稀缺性。

### 8.1 Triangulation 案例（对比参照）

Triangulation（2023 年披露）展示了攻击者如何攻破 SEP 边界：

| 要素 | 说明 |
|---|---|
| 攻击面 | 基带处理器（Samsung Shannon）作为进入点 |
| 提权路径 | 基带 → 主系统内核 → **通过 SEP 固件签名校验缺陷加载恶意 SEP 侧代码** |
| 0-click | 是（通过基带/短信路径，无需点击） |
| 独特之处 | **同时需要基带 0-day + 内核链 + SEP 侧漏洞**——三层独立漏洞 |
| 成本与稀缺性 | 极高，仅极少数组织具备 |

### 8.2 为什么 Coruna/DarkSword 选择绕过而非攻破 SEP

| 判据 | 说明 |
|---|---|
| **成本效益** | 绕过（等解锁窗口）几乎零成本；攻破 SEP 需要多个极稀缺 0-day |
| **可获得数据已足够** | 解锁态下 class key 可用，能拿到绝大多数有价值的数据 |
| **Apple Pay 等 SEP 内密钥价值有限** | 无法导出，攻击者拿不到可复制的资产 |
| **暴露风险** | SEP 侧攻击需要触发固件路径，异常行为更易被发现 |

**结论**：SEP 攻破是"能力展示"级别的攻击；**绕过 SEP 才是"运营"级别的攻击**。防御体系设计必须认识到：SEP 强不等于数据强，**运行时密钥暴露是主要风险源**。

---

## 9. 防御建议

### 9.1 用户层面

| 措施 | 效果 |
|---|---|
| **强 passcode（6 位以上，避免 4 位）** | 提高 Keybag 派生强度；防离线暴力破解 |
| **每日重启设备** | 关闭 `CompleteUntilFirst` 密钥窗口 + 清除内存驻留攻击 |
| **不用 Touch/Face ID 绕过 passcode 场景谨慎** | 保证锁屏后密钥真正清除 |
| **升级 iOS** | 链条在提权阶段就断，根本到不了数据层 |
| **启用锁定模式（T0）** | 阻断入口链条 |
| **iCloud 高级数据保护（ADP）** | 端到端加密覆盖大部分云数据，降低备份侧提取价值 |
| **加密本地备份** | 保护 Keychain 在备份中的可提取性 |
| **对高价值秘密使用硬件** | 硬件安全密钥（FIDO2）不可被设备侧提取，是唯一真解 |

### 9.2 敏感数据存放策略

| 场景 | 建议 | 理由 |
|---|---|---|
| 加密钱包种子 | **优先冷存储/硬件钱包** | 手机热钱包在解锁设备上本质可提取 |
| 2FA 种子 | 硬件密钥替代 TOTP，或独立设备 | TOTP 种子在手机内 = 可被取 |
| 密码 | Keychain + 高敏感项用 `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` | 该等级锁屏后不可解 |
| 业务凭证/token | 短期过期 + 设备绑定 | 降低提取后的可用窗口 |
| App 内缓存 | **禁止把凭证写入容器明文/UserDefaults** | 路径 C 的最常见失陷点 |

### 9.3 检测视角

| 信号 | 含义 |
|---|---|
| keychaind/securityd 异常调用速率 | 批量凭证读取行为 |
| 非 App 上下文的 Keychain 访问 | 提权后滥用 |
| 大量 `kSecClass` 条目被枚举 | 导出行为特征 |
| 上行流量突增 + 时间点与解锁重合 | 密钥窗口内批量外传 |
| sysdiagnose 中出现异常类密钥内存引用 | 内核侧提取痕迹 |
| App 容器 atime 异常变化 | 跨沙箱读取痕迹 |

### 9.4 组织层面

| 措施 | 说明 |
|---|---|
| **敏感凭证不落地到移动设备** | 从架构上消除提取价值 |
| **短期 token + 硬件绑定** | 让被提取的凭证快速失效 |
| **异常凭证使用告警** | 服务端检测同凭证多设备/异常地点使用 |
| **凭证轮换机制** | 发现风险后可快速失效 |
| **对 T0 人群要求硬件密钥** | 消除设备侧提取路径 |

---

## 10. 总结

| 结论 | 内容 |
|---|---|
| **1. iOS 数据保护是三层结构，但存在运行时缝隙** | SEP 保护密钥根，Data Protection 保护文件，Keychain 保护凭证；但解锁后 class key 必然在内存中 |
| **2. 解锁窗口是最大的可利用面** | `CompleteUntilFirstUserAuthentication` 使"当天解锁过 = 当天可读"，这是绝大多数提取路径的前提 |
| **3. Coruna 与 DarkSword 都绕过 SEP，不攻破 SEP** | 这反映成本理性——绕过几乎免费，攻破需要极稀缺漏洞组合 |
| **4. 无持久化架构偏好"小而贵"的数据** | DarkSword 更适合窃取钱包种子/token，而非批量照片；架构决定目标选择 |
| **5. 重启是唯一重置密钥状态的动作** | 锁屏不足以清除所有密钥；每日重启兼具"清驻留"与"关窗口"双重收益 |
| **6. Triangulation 提醒我们 SEP 并非不可破，但极罕见** | 基带 + 内核 + SEP 三层组合攻击只对最高能力者可用 |
| **7. 真正防提取的是不存放 + 硬件绑定** | 设备侧任何加密都可被"运行时"绕过；降低提取价值比增强设备保护更有效 |

**一句话总结**：

> iOS 的加密体系防住了"拿走设备的人"，但没有防住"控制已解锁设备的人"。
> Coruna 与 DarkSword 的全部数据窃取能力，都建立在这一个缝隙之上。

---

## 参考来源

- Apple: [iOS Security Guide — Data Protection & Keychain](https://www.apple.com/business/docs/resources/iOS_Security_Guide.pdf)
- Apple: [Platform Security](https://www.apple.com/business/ios-security/)
- Google Project Zero / Citizen Lab: [Triangulation: 0-click exploit chain targeting iOS](https://citizenlab.ca/2023/11/triangulation-a-0-click-exploit-chain-targeting-ios-devices/)
- Amnesty International: [The Pegasus Project — Forensic Methodology](https://www.amnesty.org/en/latest/research/2021/07/forensic-methodology-report-how-to-catch-nso-groups-pegasus/)
- Citizen Lab: [Coruna 数据采集与凭证提取分析](https://citizenlab.org/)
- XNU Open Source: [Apple Open Source — xnu (bsd/sec, keybag)](https://opensource.apple.com/source/xnu/)
- Google Project Zero: [DarkSword 分析](https://googleprojectzero.blogspot.com/)
- OWASP MASVS: [Mobile Application Security Verification Standard — Storage](https://mas.owasp.org/MASVS/)

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
