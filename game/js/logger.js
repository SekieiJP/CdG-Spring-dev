/**
 * Logger - ゲーム進行ログの管理
 */
export class Logger {
    constructor() {
        this.logs = [];
        this.logElement = null;
    }

    /**
     * ログ表示エリアの初期化
     */
    init() {
        this.logElement = document.getElementById('log-messages');

        // ログトグル機能
        const logToggle = document.getElementById('log-toggle');
        const logArea = document.querySelector('.log-area');

        logToggle?.addEventListener('click', () => {
            logArea?.classList.toggle('collapsed');
        });
    }

    /**
     * ログメッセージを追加
     * @param {string} message - ログメッセージ
     * @param {string} type - ログタイプ (info, action, status, error)
     */
    log(message, type = 'info') {
        const entry = {
            timestamp: Date.now(),
            message,
            type
        };

        this.logs.push(entry);
        console.log(`[${type}] ${message}`);

        this.updateUI(entry);
    }

    /**
     * ログUIを更新
     */
    updateUI(entry) {
        if (!this.logElement) return;

        const logDiv = document.createElement('div');
        logDiv.className = `log-message log-${entry.type}`;

        const time = new Date(entry.timestamp);
        const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}:${time.getSeconds().toString().padStart(2, '0')}`;

        logDiv.textContent = `[${timeStr}] ${entry.message}`;

        this.logElement.appendChild(logDiv);

        // 自動スクロール
        this.logElement.scrollTop = this.logElement.scrollHeight;
    }

    /**
     * ログをクリア
     */
    clear() {
        this.logs = [];
        if (this.logElement) {
            this.logElement.innerHTML = '';
        }
    }

    /**
     * 全ログを取得
     */
    getAllLogs() {
        return [...this.logs];
    }
}
