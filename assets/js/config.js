/* =====================================================================
   PATS — 部署設定
   =====================================================================
   這是整個前端唯一需要你手動修改的檔案。
   兩個值都填好之後，前端就能連上你自己的 Apps Script 後端。

   聊天室資料庫備註（詳見 PATS-聊天室資料庫.txt）：
   - 試算表：https://docs.google.com/spreadsheets/d/1yuhSJSPUcOJOs_L7oyDf4Q9z73eR3C9XF5jClle9WX0/edit
   - Script：https://script.google.com/u/0/home/projects/1mgXQCyQntaj6phZ53a28zQsfLU0HPouHc-zlrtBCIFPUI_U8l4rgJx3u/edit
   ===================================================================== */

var PATS_CONFIG = {

  /**
   * Apps Script 網頁應用程式的 /exec 網址。
   * 取得方式：Apps Script 編輯器 →「部署」→「新增部署作業」→「網頁應用程式」，
   * 執行身分選「我」、存取權限選「任何人」，複製產生的網址貼在這裡。
   *
   * 範例：'https://script.google.com/macros/s/AKfycb.../exec'
   */
  apiUrl: 'https://script.google.com/macros/s/AKfycbzNkhCXzywXo6dxazgRCmB2JnEkLqV2XMVAlP0umwQpLZ6WrD6RcIYCqAjrj9sxFCW33Q/exec',

  /**
   * Google 用戶端 ID（選填）。
   * 留空時「使用 Google 登入」會停用，帳密登入仍可正常使用。
   *
   * 取得方式：Google Cloud Console →「憑證」→ 建立 OAuth 用戶端 ID →
   * 類型選「網頁應用程式」，並在「已授權的 JavaScript 來源」加入你的
   * GitHub Pages 網域（例如 https://your-name.github.io）。
   *
   * 範例：'1234567890-abcdefg.apps.googleusercontent.com'
   */
  googleClientId: '354935544437-1vrje0je178afce6nturpghuu5r16qp6.apps.googleusercontent.com',

  /**
   * 語音通話信令（Node + Socket.io，不是 Apps Script）。
   *
   * GitHub Pages（HTTPS）必須用 https 信令，否則會被 mixed content 擋住。
   *
   * 【正式／推薦】Render 免費 HTTPS（見 voip/Render部署說明.txt）：
   *   1. Dashboard 部署 voip/ 為 Web Service
   *   2. 服務變成 Live 後，複製上方網址（長得像 https://＜服務名＞.onrender.com）
   *   3. 把下面 signalingUrl 改成該真實網址（不要自己發明假的 .onrender.com）
   *   4. 可選：用 cron 每 10～14 分鐘 ping …/health，避免 Free 休眠
   *
   * 其他選項：
   *   - 本機／同 Wi‑Fi：'http://192.168.x.x:3001'
   *   - 臨時隧道：voip/一鍵啟動.bat（localtunnel）
   *   - Oracle + Caddy：voip/oracle-free/部署說明.txt
   *
   * 也可在 App「通話設定」覆寫，不必改此檔。
   *
   * Render 正式信令（Free；閒置會休眠，可 ping /health 保活）。
   */
  signalingUrl: 'https://pats-communication-front-end.onrender.com',

  /**
   * STUN／TURN。
   * 優先順序（call.js）：
   *   1) 下方 iceServers 若含 turn:／turns: → 使用（目前為 Metered pats-call）
   *   2) meteredTurnApiUrl
   *   3) 公共 Metered Open Relay
   *
   * 自架 Coturn 時改成 turn:公網IP:3478（見 voip/coturn/部署說明.txt）。
   */
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.relay.metered.ca:80' },
    {
      urls: 'turn:global.relay.metered.ca:80',
      username: 'e797c160e865ea1242543c83',
      credential: 'anSzhDYopXZ5XQ6z'
    },
    {
      urls: 'turn:global.relay.metered.ca:80?transport=tcp',
      username: 'e797c160e865ea1242543c83',
      credential: 'anSzhDYopXZ5XQ6z'
    },
    {
      urls: 'turn:global.relay.metered.ca:443',
      username: 'e797c160e865ea1242543c83',
      credential: 'anSzhDYopXZ5XQ6z'
    },
    {
      urls: 'turns:global.relay.metered.ca:443?transport=tcp',
      username: 'e797c160e865ea1242543c83',
      credential: 'anSzhDYopXZ5XQ6z'
    }
  ],

  /**
   * （選填）Metered TURN 憑證 API。下方已有 turn: 時會被略過。
   * 例：'https://pats-call.metered.live/api/v1/turn/credentials?apiKey=…'
   */
  meteredTurnApiUrl: ''
};
