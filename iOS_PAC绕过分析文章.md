# iOS PAC 绕过（Pointer Authentication Code Bypass）· 分析文章

> 编制日期：2026-10-02
> 数据来源：Google Project Zero、USENIX Security、Apple Developer 文档、Jamf、公开研究（含 DarkSword 链条 PAC 绕过分析）
> 性质：防御性安全研究分析（Defensive Security Research），不提供可利用代码

---

## 1. PAC 是什么，为什么它是 iOS 防御的基石

**PAC（Pointer Authentication Code，指针认证码）** 是 ARMv8.3+ 引入、Apple 在 A12 及以后芯片全面启用的硬件安全特性：

- 对**代码指针 / 返回地址 / 函数指针**附加一段加密签名（PAC），签名与指针值、上下文（如栈地址、密钥）绑定。
- 使用指针前通过 `AUT` 指令校验签名；签名不匹配则指针被"毒化"，后续访问触发崩溃。
- 目的：**即使攻击者能任意写内存，也难以伪造一个"合法签名"的控制流指针**来劫持程序跳转。

PAC 与 **KASLR、PPL、KTRR、代码签名** 共同构成 iOS 内核/用户态的纵深防御。对攻击者而言，**绕过 PAC 是控制流劫持类利用（ROP/JOP）能否成立的前提**。

---

## 2. 攻击者为什么必须绕过 PAC

在内存破坏漏洞（UAF / 越界写）之后，经典利用手法是**覆写返回地址或函数指针**跳转到攻击者代码。PAC 使这种"直接覆写指针"失效——伪造的指针签名校验失败即崩溃。

因此，现代 iOS 利用链中，攻击者要么：
- **绕过 PAC** 以完成控制流劫持，或
- **改用不依赖伪造指针的手法**（data-only、复用已签名指针、oracle 等）。

PAC 绕过通常是**沙箱逃逸 / 内核提权环节的关键子步骤**。公开分析显示，**DarkSword 全链条中包含专门的 PAC 绕过组件**，用于支撑后续控制流劫持。

---

## 3. PAC 绕过的概念性思路（防御视角分类）

> 以下为公开研究归纳的**思路分类**，用于威胁建模与检测，不含具体利用代码。

| 类别 | 思路 | 说明 |
|---|---|---|
| **复用已签名指针（Pointer Reuse）** | 不伪造新指针，而是把内存中**已合法签名**的指针搬到目标位置 | 签名对"值+上下文"有效，若上下文不变可被重用 |
| **PAC Oracle / 签名泄露** | 利用某处可被诱导执行 `AUT`/签名校验并回传结果的缺陷，把"校验能力"当 oracle 用 | 通过反复试探恢复合法签名或确认指针 |
| **Data-Only 攻击** | 完全不动控制流指针，只篡改**数据**（标志、长度、对象字段）达成目标 | 规避 PAC（PAC 只保护指针，不保护普通数据） |
| **绕过校验点 / 禁用 PAC** | 在内核/高权限处修改 PAC 密钥、关闭校验、或劫持到不校验的路径 | 需先有较高权限，常用于提权后期 |
| **JIT / 代码复用** | 复用已签名的 JIT 代码块或 gadget，而非注入新指针 | 结合 JIT 加固绕过难度高 |
| **信息泄露配合** | 先泄露密钥/已签名指针/内核地址，降低伪造或复用难度 | 常与内存泄露漏洞组合 |

**关键洞察**：PAC 保护的是"指针完整性"，**不保护数据完整性**。因此 **data-only 攻击与指针复用**是最常见的"绕开"而非"破解"PAC 的方式；真正"破解"PAC 签名本身在工程上极难。

---

## 4. 相关研究与代表案例

| 来源 / 案例 | 要点 |
|---|---|
| Project Zero《Examining Pointer Authentication on the iPhone XS》(2019) | 早期系统剖析 PAC 在 iOS 的实现与限制 |
| USENIX Security'23《Demystifying Pointer Authentication on Apple M1》 | 对 M1 上 PAC 的深入逆向与安全性评估 |
| Jamf《TFP0 PoC on PAC-Enabled iOS <= 12.4.2》 | 展示在 PAC 设备上达成内核读写（tfp0）的思路 |
| DarkSword 链条 PAC 绕过分析（NashTech, 2026） | 指出 DarkSword 全链条含专门 PAC 绕过组件，支撑控制流劫持 |
| Apple Developer 文档《Preparing your app to work with pointer authentication》 | 官方对 PAC 语义与开发者适配的说明 |

**在链条中的位置**：
```
内存破坏 (获得任意写)  →  [PAC 绕过 / 指针复用 / data-only]  →  控制流劫持或数据篡改
        →  沙箱逃逸  →  内核提权 (root)
```

---

## 5. Apple 的配套缓解与攻防趋势

- **PAC + 上下文绑定**：签名与栈地址/密钥绑定，抬高跨上下文复用难度。
- **PPL / KTRR**：限制内核关键内存与页表，即使绕过 PAC 仍难改内核。
- **JIT 加固 / W^X**：限制复用 JIT 代码页。
- **数据完整性补充**：Apple 逐步在关键结构加入额外校验，压缩 data-only 空间。

**趋势**：单一"覆写返回地址"已死；攻击转向**指针复用、data-only、oracle、多原语组合**，并与零日打包。PAC 并未被"破解"，而是被"绕开"——这推动防御方同时关注**数据完整性**与**异常控制流/校验行为**。

---

## 6. 检测与防护建议

### 个人 / 高危用户
1. **保持系统最新**：PAC 相关绕过依赖的底层漏洞修复靠系统更新。
2. **高危时启用 Lockdown Mode**：收紧攻击面，使含 PAC 绕过的全链条前置环节失效。

### 企业 / 组织
3. 补丁管理覆盖全部 Apple 设备与 BYOD。
4. 移动端 EDR/MTD 关注：异常崩溃模式（PAC 校验失败的毒化指针崩溃）、异常控制流、内核级校验异常。
5. 对高价值人群分层防护（Lockdown Mode + 专用网络 + 行为监控）。

### 研究 / 防御团队
6. 威胁建模同时覆盖**指针完整性（PAC）与数据完整性（data-only）**两条线。
7. 关注 PAC oracle / 指针复用类研究，回归测试相关 CVE 补丁。

---

## 7. 结论

PAC 是 iOS 抵御控制流劫持的硬件基石，使"直接伪造指针"失效。但攻击者通过**指针复用、data-only、PAC oracle、绕过校验点、信息泄露组合**等方式"绕开"而非"破解"PAC；DarkSword 等现代全链条已内置专门 PAC 绕过组件。PAC 保护指针却不保护数据，决定了 **data-only 与复用**是最现实的 bypass 路径。**防御要点：及时补丁 + Lockdown Mode + 同时监控指针完整性与数据完整性异常。**

---

## 参考来源
- [Examining Pointer Authentication on the iPhone XS — Google Project Zero](https://projectzero.google/2019/02/examining-pointer-authentication-on.html)
- [Demystifying Pointer Authentication on Apple M1 — USENIX Security'23](https://www.usenix.org/system/files/usenixsecurity23-cai-zechao.pdf)
- [TFP0 POC on PAC-Enabled iOS Devices <= 12.4.2 — Jamf](https://www.jamf.com/blog/tfp0-poc-on-pac-enabled-ios-devices-12-4-2/)
- [Vulnerability Analysis: The PAC bypass behind the DarkSword exploit chain — NashTech](https://blog.nashtechglobal.com/vulnerability-analysis-taking-a-look-at-the-pac-bypass-behind-the-darksword-exploit-chain-part-1/)
- [Preparing your app to work with pointer authentication — Apple Developer](https://developer.apple.com/documentation/security/preparing-your-app-to-work-with-pointer-authentication)
- [ARM Pointer Authentication Bypass — MottaSec White-Papers](https://github.com/MottaSec/White-Papers/blob/main/ARM%20Pointer%20Authentication%20Bypass/arm_pac_bypass.md)

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
