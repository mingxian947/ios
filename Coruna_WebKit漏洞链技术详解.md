# Coruna WebKit 漏洞链技术详解

> 编制日期：2026-10-13
> 数据来源：Google Project Zero、Citizen Lab、Apple Security Advisory、公开安全研究
> 性质：防御性安全研究分析（Defensive Security Research），不提供可利用代码

---

## 1. 执行摘要

**Coruna** 是 2024 年披露的高级 iOS 全链条攻击套件，其**初始访问阶段**依赖多个 WebKit/JavaScriptCore 零日漏洞实现远程代码执行。本文深入解析 Coruna 攻击链中 WebKit 组件的技术细节。

**核心内容**：
1. Coruna WebKit 漏洞概述与影响范围
2. 核心 CVE 技术解析（CVE-2024-23222 等）
3. JSC 类型混淆利用原理
4. 从 WebKit RCE 到沙箱逃逸的过渡
5. 与 DarkSword WebKit 组件的对比

**风险等级：严重（Critical）**。

---

## 2. Coruna 攻击链概览

### 2.1 攻击链结构

```
[0] 水坑网站投递
        ↓
[1] WebKit RCE（JSC 类型混淆）← 本文重点
        ↓
[2] PAC 绕过
        ↓
[3] 沙箱逃逸（GPU/ANGLE）
        ↓
[4] 内核提权
        ↓
[5–7] 数据窃取/外传/驻留
```

### 2.2 WebKit 阶段的关键作用

| 作用 | 说明 |
|---|---|
| **初始代码执行** | 在 WebContent 进程内获得 RCE |
| **内存原语** | 提供 addrof/fakeobj 等原语 |
| **信息泄露** | 泄露堆地址、模块基址 |
| **后续利用基础** | 为沙箱逃逸提供跳板 |

---

## 3. 核心 CVE 技术解析

### 3.1 CVE-2024-23222：JSC 类型混淆

**组件**：JavaScriptCore（JSC）

**类型**：类型混淆（Type Confusion）

**影响版本**：iOS 16.0–17.2.1

**漏洞原理**（简化）：
```javascript
// JSC 在优化某些数组操作时
// 错误假设数组元素类型不变

// 攻击者通过原型链修改触发类型变化
// JIT 未检测到 → 按错误类型读取
// → 获得堆地址信息泄露
```

**技术细节**：
1. **JIT 投机优化**：DFG/FTL JIT 假设数组类型稳定
2. **原型链污染**：通过 `__proto__` 修改触发类型变化
3. **类型混淆**：JIT 按旧类型解释新数据
4. **信息泄露**：读取到堆指针（作为 Double）

**利用效果**：
- 获得 `addrof` 原语（获取对象堆地址）
- 为后续 `fakeobj` 和任意地址读写铺路

### 3.2 相关 CVE

| CVE | 类型 | 作用 |
|---|---|---|
| CVE-2024-23222 | 类型混淆 | 信息泄露 / addrof |
| CVE-2023-41974 | 类型混淆 | 辅助原语 |
| CVE-2023-32434 | 内存破坏 | 辅助利用 |

---

## 4. JSC 类型混淆利用原理

### 4.1 JSC 对象模型

```
JSArray 对象布局：
  ┌─ JSCell（StructureID + TypeInfo）
  ├─ Butterfly 指针（指向元素存储）
  └─ 元素数据（Int32 / Double / JSValue*）
```

### 4.2 类型混淆攻击

**正常流程**：
```javascript
let arr = [1, 2, 3];  // Int32 数组
arr[0] = 1.5;         // 转换为 Double 数组
```

**攻击流程**：
```javascript
// 1. 创建 Int32 数组
let arr1 = [1, 2, 3];

// 2. 创建 Object 数组
let arr2 = [{}, {}, {}];

// 3. 通过原型链修改，使 arr1 按 Object 数组解释
// （JIT 未检测到类型变化）

// 4. 将目标对象放入 arr2
arr2[0] = targetObject;

// 5. 通过 arr1 读取 arr2[0]
// arr1 按 Double 解释 → 读取的是指针值
let addr_as_double = arr1[0];

// 6. 转换为地址
let addr = doubleToAddr(addr_as_double);
// → 获得 targetObject 的堆地址（addrof 原语）
```

### 4.3 从 addrof 到任意地址读写

```
addrof 原语（获得对象地址）
        ↓
fakeobj 原语（在指定地址伪造对象）
        ↓
控制伪造对象的 Butterfly 指针
        ↓
通过数组访问实现任意地址读写
```

---

## 5. 从 WebKit RCE 到沙箱逃逸

### 5.1 WebContent 进程限制

| 限制 | 说明 |
|---|---|
| **沙箱** | 不能访问用户数据/系统资源 |
| **PAC** | 控制流劫持需要指针签名 |
| **权限** | 仅能访问 Web 相关内容 |

### 5.2 过渡到沙箱逃逸

```
WebKit RCE（WebContent 内代码执行）
        ↓
获得 addrof/fakeobj/任意地址读写
        ↓
准备沙箱逃逸：
  - 泄露 GPU/IOKit 接口地址
  - 构造特制 IPC 消息
  - 准备堆/栈数据
        ↓
触发沙箱逃逸漏洞（GPU/ANGLE/IOKit）
        ↓
脱离 WebContent 沙箱
```

---

## 6. 与 DarkSword WebKit 组件对比

| 维度 | Coruna | DarkSword |
|---|---|---|
| **核心 CVE** | CVE-2024-23222 | CVE-2025-43529 |
| **漏洞类型** | 类型混淆 | DFG GC 缺陷 |
| **JIT 阶段** | DFG/FTL | DFG |
| **原语获取** | addrof/fakeobj | 内存原语 |
| **后续逃逸** | GPU/ANGLE | ANGLE/媒体服务 |

**共同点**：
- 都使用 JSC JIT 漏洞
- 都需要后续沙箱逃逸
- 都针对 iOS 16–18

**差异**：
- Coruna 使用类型混淆，DarkSword 使用 GC 缺陷
- 逃逸路径不同（Coruna 偏 GPU，DarkSword 偏媒体服务）

---

## 7. 防御与检测

### 7.1 Apple 修复

| 版本 | 修复内容 |
|---|---|
| iOS 17.3 | 修复 CVE-2024-23222 |
| iOS 17.4+ | 持续修复 JSC 漏洞 |

### 7.2 防御建议

| 措施 | 说明 |
|---|---|
| **及时更新** | 修复 WebKit/JSC 漏洞 |
| **Lockdown Mode** | 禁用 JIT，消除 JIT 漏洞类别 |
| **水坑防护** | 避免访问不可信网站 |
| **运行时检测** | 监控 WebContent 异常行为 |

---

## 8. 总结

Coruna WebKit 漏洞链是攻击的**第一阶段**：

| 维度 | 现状 |
|---|---|
| **核心漏洞** | CVE-2024-23222（JSC 类型混淆） |
| **利用原语** | addrof → fakeobj → 任意地址读写 |
| **后续阶段** | PAC 绕过 → 沙箱逃逸 → 内核提权 |
| **影响版本** | iOS 16.0–17.2.1（已修复） |

**技术要点**：
1. JIT 投机优化导致类型混淆
2. 原型链污染触发类型变化
3. 信息泄露提供后续利用基础
4. 需要沙箱逃逸才能完整沦陷

---

## 参考来源

- Apple Security Advisory: iOS 17.3
- Google Project Zero: In-the-wild analysis
- Citizen Lab: Coruna research

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
