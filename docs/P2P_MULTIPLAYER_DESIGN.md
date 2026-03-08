# BulongBulong MVP - P2P 联机游玩架构改造方案

## 1. 核心需求分析

当前游戏逻辑（`GameEngine`）完全在单机前端（React state）维护，是一个典型的“单机桌游模拟器”。
为了实现联机功能，并满足以下需求：
1. 最好不造轮子，多使用成熟的开源库以节省工作量。
2. 采用**主机开服（Host），其他人加入（Client）**的 P2P（Peer-to-Peer）直连架构，从而降低服务器带宽与部署成本。

## 2. 技术选型：P2P 联机框架

在 Web 环境下，实现点对点通信的核心技术是 **WebRTC**。但是原生 WebRTC API 极其复杂，需要自行处理信令服务器（Signaling Server）、NAT 穿透（STUN/TURN 服务器）和断线重连等问题。

因此，强烈推荐使用基于 WebRTC 封装的成熟开源库，最主流的解决方案为：**PeerJS**。

### 推荐方案：PeerJS (https://peerjs.com/)

- **优势**：
  - 极简的 API，封装了 WebRTC 复杂的连接逻辑。
  - **免费的官方信令服务器**：PeerJS 提供了一个开箱即用的公共云端信令服务器（也可以非常简单地在自己的 Node.js/Express 上私有化部署 `peerjs-server`）。
  - 支持 DataChannel：完美支持 JSON 格式的游戏状态（GameState）与操作（Actions）传输。
- **依赖安装**：
  ```bash
  npm install peerjs
  ```
  如果需要部署私有信令服务器（可选，增强连通性和稳定性）：
  ```bash
  npm install peer
  ```

---

## 3. 架构设计：Host-Client 模式

我们不改变当前 `GameEngine` 的核心逻辑（状态机驱动），而是将其作为“权威服务器”运行在“房主（Host）”的浏览器中。

### 3.1 角色划分

| 角色 | 职责 | 通信方式 |
|---|---|---|
| **Host (房主)** | 1. 运行并维护全局权威 `GameEngine`<br>2. 监听所有 Client 传来的操作（Action）指令<br>3. 每次状态更新时，将最新的 `GameState` 广播给所有 Client<br>4. 本地也可作为一个普通玩家参与游戏 | 与所有 Client 保持双向 DataChannel 连接 |
| **Client (普通玩家)** | 1. 不运行核心逻辑引擎<br>2. 仅渲染从 Host 接收到的最新 `GameState`<br>3. 玩家的任何操作（如：传递卡牌、接收/拒绝）不直接修改本地状态，而是打包成指令（JSON）发送给 Host | 仅与 Host 保持一条双向 DataChannel 连接 |

### 3.2 联机流程图

1. **创建房间 (Host)**:
   - 房主打开页面，选择“创建房间”。
   - 初始化 PeerJS 实例，获取到一个全局唯一的 `peerId`（或指定一个短码房间号）。
   - 将 `peerId` 分享给其他玩家。
2. **加入房间 (Client)**:
   - 玩家打开页面，选择“加入房间”，输入房主的 `peerId`。
   - 通过 PeerJS 连接到房主。
3. **数据同步 (游戏进行中)**:
   - **Client -> Host**：Client 触发事件（例如点击发牌、传递）。Client 不调用本地 `engine`，而是通过 PeerJS 连接发送 `{ type: 'INITIATE_PASS', payload: { cardId: '...', method: 'SECRET' } }`。
   - **Host 处理**：Host 收到指令后，调用本地权威 `GameEngine` 相应方法更新状态。
   - **Host -> Client**：`GameEngine` 状态发生变化（触发 `onStateChange`），Host 将完整的全新 `GameState` 通过 WebRTC 广播给所有连入的 Client。
   - **Client 渲染**：Client 收到新的 `GameState` 后，直接 `setGameState(newState)` 触发 React 重新渲染。

---

## 4. 改造步骤与实施建议

为减少代码重构与侵入性，建议对 `src/App.tsx` 和逻辑引擎做以下剥离：

### 步骤一：封装 `MultiplayerManager`
创建一个专门管理 PeerJS 连接的类或 Hook：
- 对 Host：管理连入的连接列表（`connections[]`），暴露 `broadcastState(state)` 方法。
- 对 Client：管理与 Host 的单线连接，暴露 `sendAction(action)` 方法，监听 `onStateReceived` 事件。

### 步骤二：改造前端交互（`App.tsx`）
当前 `App.tsx` 中的按钮点击会直接调用 `engine.xxx()`。
需要将所有的 `engine` 调用抽象为一个 `dispatchAction(type, payload)` 函数：
```typescript
const dispatchAction = (action) => {
  if (isHost) {
    // 房主直接执行引擎逻辑，并在回调中广播状态
    executeActionOnEngine(engine, action);
  } else {
    // 客户端将动作发给房主，等待状态同步
    peerConnection.send(action);
  }
}
```

例如：
- 以前：`<button onClick={() => engine.acceptPass(player.id)}>接收</button>`
- 现在：`<button onClick={() => dispatchAction({ type: 'ACCEPT_PASS', playerId: player.id })}>接收</button>`

### 步骤三：玩家身份与视角绑定
当前 UI 是上帝视角或固定在 `players[currentPlayerIndex]`。
- 引入 `localPlayerId` 状态（代表当前浏览器前的真实玩家）。
- 加入房间时，Host 分配或玩家自选一个 `Player` 身份（即分配一个 `localPlayerId`）。
- UI 渲染时，确保敏感信息（如他人的底牌）严格按照 `localPlayerId` 过滤（这部分由于是桌游，可以直接在前端通过判断 `player.id === localPlayerId` 来决定是否隐藏，但为了防作弊，最标准的做法是 Host 在广播 `GameState` 给特定 Client 时，把别人的手牌内容剔除。考虑到是熟人开黑 MVP，初期可以直接下发全量状态依靠前端遮挡防作弊）。

---

## 5. 补充方案：服务端权威（备选）

由于已经在 `package.json` 中配置了 Node.js（Express + better-sqlite3），若 P2P NAT 穿透在不同网络环境下（如复杂的企业网）表现不佳：
- **方案 B：Socket.io**
  可以非常低成本地将 Host 模式的逻辑移动到 Node.js。
  前后端引入 `socket.io`。Node.js 充当绝对的权威 Host，所有玩家都是平等的 Client。
  - **开发量**：与 P2P 模式接近，只是连接方式从 PeerJS WebRTC 变成了基于 WebSocket 的长连接。如果追求最极致的网络稳定性，更推荐使用 Socket.io + Node.js 服务端方案。

## 6. 总结

1. 最省力的纯前端 P2P 方案：引入 **PeerJS**，不需要搭建业务服务器。
2. 核心架构：**Host-Client (主客机模式)**，由房主的浏览器运行游戏核心逻辑。
3. 代码改动主要集中在**将直接的引擎调用替换为网络指令分发机制（RPC 思想）**，原有的 `GameEngine` 几乎无需修改。