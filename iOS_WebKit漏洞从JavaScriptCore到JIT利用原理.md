# iOS WebKit 漏洞：从 JavaScriptCore 到 JIT 利用原理

> 编制日期：2026-10-13
> 数据来源：Apple 安全公告、Google Project Zero、WebKit 开源代码、公开 CVE 情报、安全研究论文
> 性质：防御性安全研究分析（Defensive Security Research），不提供可利用代码

---

## 1. 执行摘要

**JavaScriptCore（JSC）** 是 WebKit 的 JavaScript 引擎，也是 iOS 上所有网页 JavaScript 执行的唯一入口。JSC 内部采用**多层 JIT（Just-In-Time）编译管线**将 JavaScript 动态编译为机器码——这一设计在追求极致性能的同时，也引入了 iOS 攻击面中**最关键、最高频**的漏洞类别。

本文从 JSC 内部架构出发，逐层解析：

1. **JSC 执行管线**：Interpreter → Baseline JIT → DFG JIT → FTL JIT
2. **JIT 编译器的安全假设与违反**：类型推断、边界检查消除、 speculation
3. **核心漏洞类型**：类型混淆（Type Confusion）、越界读写（OOB）、释放后使用（UAF）
4. **从漏洞到原语**：addrof / fakeobj / 任意地址读写
5. **从原语到 RCE**：伪造 JS 对象、劫持控制流、突破 WebContent 沙箱
6. **真实 CVE 案例映射**

**核心结论**：JSC JIT 漏洞是 iOS 远程攻击的**最高频初始入口**。防御关键在于：Lockdown Mode（禁用 JIT）、JIT 硬化（W^X、Caging）、类型系统加固、运行时行为检测。

**风险等级：严重（Critical）**。

---

## 2. JavaScriptCore 架构总览

### 2.1 JSC 在 WebKit 中的位置

```
Safari / WKWebView
        │
        ↓
WebKit 框架
        │
  ┌─────┴─────┐
  │           │
WebCore    JavaScriptCore (JSC)
(DOM/CSS)  (JavaScript 引擎)
                │
          ┌─────┴─────┐
          │           │
       解析器      JIT 编译器
     (Parser)   (LLInt/DFG/FTL)
          │           │
          └─────┬─────┘
                ↓
          字节码 / 机器码
                ↓
           CPU 执行
```

### 2.2 JSC 核心组件

| 组件 | 职责 |
|---|---|
| **Lexer / Parser** | 将 JavaScript 源码解析为 AST |
| **Bytecode Generator** | 将 AST 编译为 JSC 字节码 |
| **LLInt（Low Level Interpreter）** | 字节码解释器，首次执行 |
| **Baseline JIT** | 简单编译，快速生成机器码 |
| **DFG JIT** | 数据流图优化，类型推断 + speculation |
| **FTL JIT** | 高级优化，内联、逃逸分析、寄存器分配 |
| **GC（垃圾回收器）** | MarkedSpace + CopiedSpace + 大对象堆 |
| **Heap** | 管理所有 JS 对象的内存分配 |

### 2.3 JS 对象内部表示

JSC 使用 **Nan-boxing**（Not-a-Number 装箱）在 64 位中表示所有 JS 值：

```
64 位值布局：
┌──────────────────────────────────────────────────┐
│  类型标签（高 16 位）  │  值/指针（低 48 位）       │
└──────────────────────────────────────────────────┘

类型标签示例：
  0x0001  →  整数（Int32）
  0x0002  →  双精度浮点（Double）
  0x0003  →  布尔值
  0x0004  →  空值（Null/Undefined）
  0xFFxx  →  对象指针（JSCell*）
```

**JSCell**（JS 单元）是所有堆对象的基类：

```
JSCell 结构（简化）：
  ┌─ StructureID    (4 bytes)  → 指向结构体描述（隐藏类）
  ├─ IndexingType   (1 byte)   → 数组类型（连续/非连续/字典）
  ├─ TypeInfo flags (2 bytes)  → 类型信息（对象/数组/函数等）
  ├─ GC 标记位      (1 byte)
  └─ 对象特定数据...           → 属性存储、函数代码等
```

**Structure（隐藏类）** 是 JSC 类型系统的核心：
- 描述对象的"形状"：有哪些属性、属性偏移、类型
- 对象通过 StructureID 关联其 Structure
- 属性值存储在对象内联属性或属性存储（PropertyStorage）中

---

## 3. JIT 编译管线详解

### 3.1 执行管线升级

JSC 采用**投机优化（Speculative Optimization）**策略：

```
JavaScript 源码
      │
      ↓  解析
  字节码（Bytecode）
      │
      ↓  [首次执行] LLInt 解释器
      │   慢但安全，收集类型反馈
      │
      ↓  [执行次数 > 阈值] Baseline JIT
      │   快速编译，无优化
      │
      ↓  [执行次数 > 阈值] DFG JIT
      │   基于类型反馈做投机优化
      │   假设类型不变，消除检查
      │
      ↓  [执行次数 > 阈值] FTL JIT
      │   高级优化：内联、逃逸分析、寄存器分配
      │   最强优化，最高风险
      │
      ↓  [投机失败] 去优化（Deoptimization）
          回退到低层级重新执行
```

### 3.2 DFG JIT：投机优化的核心

DFG（Data Flow Graph）JIT 是漏洞最高发的组件：

**核心思想**：
1. **类型推断**：根据历史执行数据推断变量类型
2. **投机假设**：假设未来执行类型不变
3. **消除检查**：删除类型检查/边界检查以提升性能
4. **去优化**：假设失败时回退到解释器

**示例**：
```javascript
function add(a, b) {
    return a + b;  // DFG 推断 a, b 始终是 Int32
}

// 前 100 次调用：add(1, 2) → Int32 加法（优化后）
// 第 101 次调用：add("hello", "world") → 类型不匹配
//                → 触发去优化 → 回退到 LLInt
```

**安全检查消除**：
```javascript
function getElem(arr, i) {
    return arr[i];  // DFG 推断 arr 是 Int32 数组，i 在范围内
}

// 优化后（伪代码）：
//   省略类型检查（假设 arr 是 Int32Array）
//   省略边界检查（假设 i < arr.length）
//   直接读取 arr[i]

// 如果 arr 实际是对象数组，或 i 越界 → 内存破坏
```

### 3.3 FTL JIT：高级优化的风险

FTL（Faster Than Light）JIT 在 DFG 基础上进一步：

| 优化 | 说明 | 风险 |
|---|---|---|
| **函数内联** | 将小函数体嵌入调用点 | 类型推断错误被放大 |
| **逃逸分析** | 判断对象是否"逃逸"出作用域 | 错误判断导致提前释放 |
| **寄存器分配** | 将变量映射到 CPU 寄存器 | 寄存器溢出导致内存覆盖 |
| **循环优化** | 循环展开、向量化 | 边界检查消除风险 |

---

## 4. 核心漏洞类型

### 4.1 类型混淆（Type Confusion）

**最高频的 JSC 漏洞类型**。

**原理**：JIT 编译器错误假设对象类型，导致按错误类型解释内存：

```
JIT 假设：变量 x 始终是 JSArray（Int32 类型）
实际执行：x 被赋值为 JSObject

后续操作：按 JSArray 布局读取 x 的内存
          → 读取的"元素"实际是 JSObject 的属性指针
          → 类型混淆 → 信息泄露 / 任意地址读写
```

**典型场景**：
```javascript
function confuse(arr) {
    // JIT 推断 arr 是 Int32 数组
    let val = arr[0];  // 按 Int32 读取
    return val;
}

// 通过原型污染或 __proto__ 修改，使 arr 的实际类型改变
// JIT 未检测到类型变化 → 按错误类型读取 → 类型混淆
```

**代表 CVE**：
| CVE | 类型 | 说明 |
|---|---|---|
| CVE-2024-23222 | 类型混淆 | 在野利用，Coruna 组件 |
| CVE-2023-41974 | 类型混淆 | 在野利用 |
| CVE-2023-32434 | 类型混淆 | 在野利用，多条链条组件 |
| CVE-2021-30860 | 类型混淆 | FORCEDENTRY 组件 |

### 4.2 越界读写（Out-of-Bounds Read/Write）

**原理**：数组/缓冲区边界检查被 JIT 错误消除：

```
JIT 推断：i 始终 < arr.length
消除边界检查：直接 arr[i]

实际执行：i >= arr.length
          → 越界读取 → 信息泄露
          → 越界写入 → 内存破坏
```

**典型场景**：
```javascript
function oob(arr, i) {
    // JIT 优化消除边界检查
    return arr[i];  // 可能越界
}

// 通过长度修改或类型转换触发越界
```

**代表 CVE**：
| CVE | 类型 | 说明 |
|---|---|---|
| CVE-2025-24201 | 越界写 | WebKit 沙箱逃逸组件 |
| CVE-2022-22640 | 越界读 | 在野利用 |

### 4.3 释放后使用（Use-After-Free）

**原理**：对象被 GC 回收后仍被引用，访问已释放内存：

```
let obj = createObject();
let ref = obj;

// GC 回收 obj（如果 ref 未被正确跟踪）
// ref 仍指向已释放内存

// 后续访问 ref → UAF → 可能读取已重用内存中的新对象
```

**典型场景**：
- GC 竞态条件
- WeakRef 处理缺陷
- 原型链修改导致引用跟踪错误

### 4.4 JIT 编译器逻辑缺陷

**原理**：JIT 编译器的优化 pass 存在逻辑错误：

| 缺陷类型 | 说明 |
|---|---|
| **类型推断错误** | 错误推断变量类型范围 |
| **Phi 节点错误** | SSA 形式中 Phi 节点处理错误 |
| **去优化遗漏** | 应触发去优化但未触发 |
| **内联错误** | 函数内联时语义改变 |

---

## 5. 从漏洞到原语（Primitives）

### 5.1 关键原语

从 JSC 漏洞到完整 RCE，需要构建以下原语：

| 原语 | 说明 | 用途 |
|---|---|---|
| **addrof(obj)** | 获取对象的堆地址 | 信息泄露 |
| **fakeobj(addr)** | 在指定地址伪造对象 | 控制流劫持 |
| **任意地址读** | 读取任意内存地址 | 信息泄露 / 指针追踪 |
| **任意地址写** | 写入任意内存地址 | 代码执行 / 数据篡改 |

### 5.2 addrof 原语构建

**目标**：获取 JS 对象的堆地址（JSCell 指针）。

**原理**（类型混淆示例）：
```javascript
// 1. 创建两个数组
let arr1 = [1.1, 2.2, 3.3];  // Double 数组
let arr2 = [{}, {}, {}];      // Object 数组

// 2. 通过类型混淆使 arr1 按 Object 数组解释
//    （或通过原型链修改）

// 3. 将目标对象放入 arr2
arr2[0] = targetObject;

// 4. 通过 arr1 读取 arr2[0]
//    arr1 按 Double 解释 → 读取的是指针值（作为 Double）
let addr_as_double = arr1[0];

// 5. 将 Double 转换回地址
let addr = doubleToAddr(addr_as_double);
// → 获得 targetObject 的堆地址
```

### 5.3 fakeobj 原语构建

**目标**：让 JSC 认为指定地址处有一个 JS 对象。

**原理**（与 addrof 对称）：
```javascript
// 1. 创建两个数组（同上）
let arr1 = [1.1, 2.2, 3.3];  // Double 数组
let arr2 = [{}, {}, {}];      // Object 数组

// 2. 通过类型混淆使 arr2 按 Double 数组解释

// 3. 将目标地址（作为 Double）写入 arr1
arr1[0] = addrToDouble(targetAddr);

// 4. 通过 arr2 读取 arr1[0]
//    arr2 按 Object 解释 → 将地址值视为对象指针
let fakeObj = arr2[0];
// → fakeObj 是指向 targetAddr 的"对象"
```

### 5.4 任意地址读写构建

**组合 addrof + fakeobj**：
```javascript
// 1. 伪造一个 JSArray 对象（fakeobj）
//    控制其 butterfly 指针指向目标地址

// 2. 通过该数组的元素访问实现任意地址读写
//    fakeArr[0] → 读取目标地址处的值
//    fakeArr[0] = val → 写入目标地址

// 关键：需要控制伪造数组的：
//   - StructureID（匹配数组类型）
//   - IndexingType（元素类型）
//   - Butterfly 指针（指向目标地址）
```

---

## 6. 从原语到 RCE

### 6.1 控制流劫持

获得任意地址读写后，攻击者需要**劫持控制流**：

**方法一：覆写函数指针**
```
1. 找到 JS 函数的 JIT 代码指针
   （JSCell → JSFunction → Executable → JITCode）
2. 覆写 JIT 代码指针 → 指向攻击者控制的内存
3. 调用该函数 → 执行攻击者代码
```

**方法二：覆写虚表指针（vtable）**
```
1. 找到对象的 vtable 指针
   （JSCell → Structure → 某些对象有 vtable）
2. 覆写 vtable 指针 → 指向伪造 vtable
3. 触发虚函数调用 → 执行攻击者代码
```

**方法三：覆写 GOT/PLT（如适用）**
```
在 WebContent 进程中：
1. 找到动态链接的全偏移表（GOT）
2. 覆写 GOT 条目 → 指向攻击者代码
3. 调用对应函数 → 执行攻击者代码
```

### 6.2 WebContent 进程内 RCE

```
JSC 漏洞 → 类型混淆/OOB
        ↓
addrof / fakeobj 原语
        ↓
任意地址读写
        ↓
覆写函数指针 / vtable
        ↓
在 WebContent 进程内执行任意代码
        ↓
仍受沙箱限制 → 需要沙箱逃逸（下一环节）
```

### 6.3 JIT 代码页利用

**JIT 代码页**是 JSC 分配的**可执行内存**（W^X 例外）：

```
JIT 代码页布局：
  ┌─────────────────────────┐
  │  JIT 编译的机器码        │  ← 可执行
  │  （JavaScript 函数）     │
  ├─────────────────────────┤
  │  数据区（常量池等）      │  ← 可读写
  └─────────────────────────┘
```

**攻击**：
- 将 shellcode 写入 JIT 数据区
- 覆写函数指针指向数据区
- 执行 shellcode（因为 JIT 页可执行）

**防御**：
- **W^X（Write XOR Execute）**：JIT 页不能同时可写和可执行
- **Caging**：JIT 页限制在特定地址范围内
- **PAC**：JIT 代码指针需签名

---

## 7. JIT 硬化与绕过

### 7.1 Apple 的 JIT 硬化措施

| 措施 | 说明 | 引入版本 |
|---|---|---|
| **W^X** | JIT 页不能同时可写和可执行 | iOS 13+ |
| **JIT Caging** | JIT 代码限制在特定地址范围 | iOS 14+ |
| **PAC for JIT** | JIT 代码指针使用 PAC 签名 | A12+ |
| **Type 硬化** | 加强类型检查，减少 speculation | 持续更新 |
| **GC 硬化** | 加强 GC 引用跟踪 | 持续更新 |
| **Lockdown Mode** | 禁用 JIT（仅使用解释器） | iOS 16+ |

### 7.2 W^X 绕过

**问题**：W^X 阻止 JIT 页同时可写和可执行。

**绕过思路**：
1. **利用非 JIT 可执行内存**：找到其他可执行区域（如 dyld、系统库）
2. **ROP（Return-Oriented Programming）**：不注入代码，复用现有代码片段
3. **JIT 页切换**：在写入和执行之间切换页权限（需找到权限切换缺陷）

### 7.3 PAC 绕过

**问题**：JIT 代码指针有 PAC 签名，无法直接覆写。

**绕过思路**：
1. **签名泄露**：泄露 PAC 签名密钥/上下文
2. **签名绕过**：找到不检查 PAC 的代码路径
3. **PAC 预言**：通过侧信道预测有效签名
4. **XPAC 攻击**：利用 PAC 高位未签名的特性（指针异或攻击）

### 7.4 Lockdown Mode 影响

**Lockdown Mode** 禁用 JIT，仅使用 LLInt 解释器：

| 影响 | 说明 |
|---|---|
| **JIT 漏洞失效** | 无 JIT → 无 JIT 类型推断缺陷 |
| **性能下降** | 解释器比 JIT 慢 10–100 倍 |
| **仍需解释器漏洞** | LLInt 也可能有漏洞（但攻击面小得多） |

**结论**：Lockdown Mode 大幅降低 JSC JIT 攻击面。

---

## 8. 真实 CVE 案例深度解析

### 8.1 CVE-2024-23222（Coruna 组件）

**类型**：类型混淆（Type Confusion）

**原理**（简化）：
```javascript
// JSC 在优化某些数组操作时
// 错误假设数组元素类型不变

// 攻击者通过原型链修改触发类型变化
// JIT 未检测到 → 按错误类型读取
// → 获得堆地址信息泄露（addrof 原语）
// → 构建 fakeobj → 任意地址读写
// → 覆写函数指针 → RCE
```

**影响**：iOS 16.0–17.2.1（Coruna 利用链初始访问组件）

### 8.2 CVE-2025-43529（DarkSword 组件）

**类型**：DFG JIT GC 缺陷

**原理**（简化）：
```javascript
// DFG JIT 在优化 GC 相关操作时
// 错误处理某些对象的引用跟踪

// 导致对象被提前回收（UAF）
// 或 GC 标记位错误 → 类型混淆
// → 提供 WebContent 内 RCE 与内存原语
```

**影响**：iOS 18.6–18.7（DarkSword 链条基础）

### 8.3 CVE-2021-30860（FORCEDENTRY）

**类型**：类型混淆

**原理**：
- NSO Group Pegasus 利用
- 通过恶意 PDF 触发 CoreText 漏洞
- 但初始 JavaScript 执行可能涉及 JSC 类型混淆
- 提供初始代码执行原语

**影响**：iOS 12–14.x（Pegasus FORCEDENTRY 链）

---

## 9. 防御体系

### 9.1 架构层防御

| 防御 | 说明 |
|---|---|
| **W^X** | JIT 页不可同时可写可执行 |
| **JIT Caging** | JIT 代码限制在特定范围 |
| **PAC** | JIT 指针签名 |
| **SPTM/TXM** | 硬件级页表监控（A17+） |

### 9.2 引擎层防御

| 防御 | 说明 |
|---|---|
| **类型硬化** | 减少 speculation，增加运行时检查 |
| **GC 硬化** | 加强引用跟踪，减少 UAF |
| **边界检查** | 保留关键边界检查，不盲目消除 |
| **模糊测试** | 持续 fuzzing JSC 发现漏洞 |

### 9.3 运行时防御

| 防御 | 说明 |
|---|---|
| **Lockdown Mode** | 禁用 JIT，仅用解释器 |
| **行为检测** | 监控异常 JS 执行模式 |
| **内存监控** | 检测异常内存访问模式 |

### 9.4 防御建议

**对个人用户**：
1. **及时更新 iOS**：获取 JSC 安全补丁
2. **高危用户启用 Lockdown Mode**：禁用 JIT
3. **避免访问不可信网站**：减少攻击面

**对企业/组织**：
1. **MDM 管控**：强制启用 Lockdown Mode（高风险岗位）
2. **网络过滤**：阻止已知恶意网站
3. **运行时检测**：监控 WebContent 异常行为

**对安全研究者**：
1. **JSC 模糊测试**：持续 fuzzing 发现新漏洞
2. **JIT 优化审计**：审查 DFG/FTL 优化 pass
3. **硬化绕过研究**：评估 W^X/PAC 绕过可能性

---

## 10. 总结

JSC JIT 漏洞是 iOS 远程攻击的**最高频初始入口**：

| 环节 | 关键点 |
|---|---|
| **JIT 管线** | LLInt → Baseline → DFG → FTL，投机优化引入风险 |
| **核心漏洞** | 类型混淆（最高频）、OOB、UAF、JIT 逻辑缺陷 |
| **原语构建** | addrof → fakeobj → 任意地址读写 |
| **控制流劫持** | 覆写函数指针/vtable/GOT |
| **JIT 硬化** | W^X、Caging、PAC、Lockdown Mode |
| **防御核心** | 及时补丁 + Lockdown Mode + 运行时检测 |

**对攻击链的意义**：
- JSC JIT 漏洞是"访问网页 → 代码执行"的关键
- 需要**第二个漏洞**（沙箱逃逸）才能完整沦陷
- Lockdown Mode 大幅降低攻击面

**未来展望**：
- JIT 优化越来越激进，攻击面持续存在
- PAC/W^X 提高攻击成本，但非绝对
- 需要持续 fuzzing + 硬化 + 运行时检测

---

## 参考来源

- WebKit Open Source: https://webkit.org/
- JavaScriptCore Internals (Apple WWDC sessions)
- Google Project Zero: JSC exploit analysis
- Synacktiv: JSC exploitation techniques
- Apple Security Updates: WebKit CVE details
- Academic papers on JIT security

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
