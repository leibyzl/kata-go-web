// ==========================================
// API 配置
// ==========================================
// 如果您将后端部署在公网 IP，请在此修改地址。
// 例如: const API_BASE_URL = "http://您的云服务器IP:5000";
const API_BASE_URL = "http://10.10.11.30:5678";

document.addEventListener("DOMContentLoaded", () => {
    // 状态元素
    const statusEl = document.getElementById("status");
    const currentTurnEl = document.getElementById("current-turn");
    const lastMoveEl = document.getElementById("last-move");

    // 初始化 WGo.js 棋盘
    const board = new WGo.Board(document.getElementById("board"), {
        width: Math.min(600, window.innerWidth - 60),
        section: { top: -0.5, left: -0.5, right: -0.5, bottom: -0.5 },
        background: "#dcba7e" // 漂亮的木色
    });

    // 棋局状态 (使用 WGo 的 Game 对象来追踪提子等逻辑)
    const game = new WGo.Game(19, "KO");
    let currentTurn = WGo.B; // 黑棋先手

    // 初始化时同步面板
    updateBoard();

    // 工具函数：坐标转换
    const xToLetter = (x) => {
        // WGo 的 X 是 0-18, GTP 的是 A-T (跳过 I)
        const charCode = x >= 8 ? x + 66 : x + 65;
        return String.fromCharCode(charCode);
    };

    const letterToX = (letter) => {
        letter = letter.toUpperCase();
        const charCode = letter.charCodeAt(0);
        return charCode > 73 ? charCode - 66 : charCode - 65;
    };

    const gtpToCoords = (gtpMove) => {
        if (!gtpMove || gtpMove.toLowerCase() === "pass" || gtpMove.toLowerCase() === "resign") {
            return null;
        }
        const x = letterToX(gtpMove.charAt(0));
        const y = 19 - parseInt(gtpMove.substring(1)); // GTP 的 Y 是从下到上 1-19
        return { x: x, y: y };
    };

    const coordsToGtp = (x, y) => {
        return xToLetter(x) + (19 - y).toString();
    };

    // 提子逻辑更新 UI
    function updateBoard() {
        // 清除所有棋子再重新绘制
        board.removeAllObjects();
        for (let i = 0; i < 19; i++) {
            for (let j = 0; j < 19; j++) {
                let color = game.position.get(i, j);
                if (color === WGo.B) {
                    board.addObject({ x: i, y: j, c: WGo.B });
                } else if (color === WGo.W) {
                    board.addObject({ x: i, y: j, c: WGo.W });
                }
            }
        }

        currentTurnEl.textContent = currentTurn === WGo.B ? "黑棋" : "白棋";
    }

    // 检查引擎状态
    function checkEngine() {
        fetch(`${API_BASE_URL}/api/status`)
            .then(res => res.json())
            .then(data => {
                if (data.status === "running") {
                    statusEl.textContent = "AI 准备就绪";
                    statusEl.classList.add("ready");
                }
            })
            .catch(e => {
                statusEl.textContent = "未连接后端";
                statusEl.classList.remove("ready");
            });
    }

    checkEngine();
    setInterval(checkEngine, 5000);

    // 玩家落子事件
    board.addEventListener("click", (x, y) => {
        if (!statusEl.classList.contains("ready")) {
            alert("后端未连接或等待 AI...");
            return;
        }

        // 验证落子合法性
        const res = game.play(x, y, currentTurn);
        if (typeof res === "number") {
            console.log("Invalid move code:", res);
            return;
        }

        const gtpMove = coordsToGtp(x, y);
        const colorStr = currentTurn === WGo.B ? "b" : "w";

        lastMoveEl.textContent = `${colorStr.toUpperCase()} ${gtpMove}`;

        statusEl.textContent = "思考中...";
        statusEl.classList.remove("ready");

        // UI 渲染 (Game 对象已经在 play 中改变了 position)
        updateBoard();
        currentTurn = currentTurn === WGo.B ? WGo.W : WGo.B;
        currentTurnEl.textContent = currentTurn === WGo.B ? "黑棋" : "白棋";

        // 通知后端
        fetch(`${API_BASE_URL}/api/play`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ color: colorStr, vertex: gtpMove })
        })
            .then(res => res.json())
            .then(data => {
                statusEl.textContent = "AI 准备就绪";
                statusEl.classList.add("ready");
                if (data.success === false) {
                    console.error("Engine rejected move!");
                }
            });
    });

    // 按钮事件
    document.getElementById("btn-reset").addEventListener("click", () => {
        if (confirm("确定清空棋盘重新开始吗？")) {
            fetch(`${API_BASE_URL}/api/reset`, { method: "POST" });
            board.removeAllObjects();
            while (game.stack.length > 1) {
                game.pop(); // 回退到初始状态
            }
            game.position.clear();
            currentTurn = WGo.B;
            updateBoard();
            lastMoveEl.textContent = "-";
        }
    });

    document.getElementById("btn-undo").addEventListener("click", () => {
        fetch(`${API_BASE_URL}/api/undo`, { method: "POST" });
        if (game.stack.length > 1) {
            game.pop();
            currentTurn = currentTurn === WGo.B ? WGo.W : WGo.B;
            updateBoard();
        }
    });

    const triggerGenMove = (colorId, colorStr) => {
        if (currentTurn !== colorId) {
            alert("需要等待对手落子，或先下当前颜色的棋。");
            return;
        }

        statusEl.textContent = "AI 思考中...";
        statusEl.classList.remove("ready");

        fetch(`${API_BASE_URL}/api/genmove`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ color: colorStr })
        })
            .then(res => res.json())
            .then(data => {
                statusEl.textContent = "AI 准备就绪";
                statusEl.classList.add("ready");

                if (data.result) {
                    const move = data.result.trim();
                    lastMoveEl.textContent = `AI(${colorStr}) ${move}`;

                    if (move.toLowerCase() !== "pass" && move.toLowerCase() !== "resign") {
                        const coords = gtpToCoords(move);
                        game.play(coords.x, coords.y, currentTurn);
                        updateBoard();
                    } else if (move.toLowerCase() === "resign") {
                        alert("AI 认输了！");
                    }

                    currentTurn = currentTurn === WGo.B ? WGo.W : WGo.B;
                    currentTurnEl.textContent = currentTurn === WGo.B ? "黑棋" : "白棋";
                }
            });
    };

    document.getElementById("btn-genmove-b").addEventListener("click", () => triggerGenMove(WGo.B, "b"));
    document.getElementById("btn-genmove-w").addEventListener("click", () => triggerGenMove(WGo.W, "w"));
});
