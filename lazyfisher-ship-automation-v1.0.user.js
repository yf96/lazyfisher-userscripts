// ==UserScript==
// @name         LazyFisher 鑷湁鑸逛竴閿搷浣?// @namespace    https://lazyfisher.toogle.club
// @version      1.0.0
// @description  鑷湁鑸逛竴閿噯澶囧嚭娴?/ 鍑鸿埅 / 杩旇埅 / 鍙栨秷鍑嗗
// @author       Claude
// @match        https://lazyfisher.toogle.club/*
// @icon         https://lazyfisher.toogle.club/pwa/fish.svg
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // ==================== 閰嶇疆 ====================
  const STORAGE_KEY = 'lazyfisher_panel_state';

  // 浠?localStorage 璇诲彇淇濆瓨鐨勭姸鎬?  function loadPanelState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return {};
  }

  function savePanelState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* ignore */ }
  }

  const saved = loadPanelState();

  const CONFIG = {
    panelTitle: '馃殺 鑷湁鑸规搷浣滃彴',
    // 鎿嶄綔闂撮殧(ms)锛岀粰 UI 鍝嶅簲鏃堕棿
    actionDelay: 800,
    // 闀挎搷浣滅瓑寰?ms)锛屽鍑鸿埅鍚庨〉闈㈣烦杞?    longDelay: 2500,
    // 闈㈡澘榛樿浣嶇疆锛堜粠 localStorage 鎭㈠鎴栦娇鐢ㄩ粯璁ゅ€硷級
    panelTop: saved.top ?? 120,
    panelRight: saved.right ?? 16,
    // 鎶樺彔鐘舵€侊紙榛樿鎶樺彔锛?    collapsed: saved.collapsed ?? true,
    // 鐩爣楸煎垪琛紙閫楀彿鍒嗛殧鐨勫瓧绗︿覆锛?    targetFishStr: saved.targetFishStr ?? '',
    // 鏈€澶у惊鐜鏁?    maxCycles: saved.maxCycles ?? 10,
  };

  /** 瑙ｆ瀽鐩爣楸煎悕绉板垪琛?*/
  function getTargetFish() {
    return CONFIG.targetFishStr
      .split(/[,锛屻€乗s]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .slice(0, 5);
  }

  // ==================== 宸ュ叿鍑芥暟 ====================

  /** 绛夊緟鎸囧畾姣 */
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ==================== 涓鎺у埗 ====================
  let abortFlag = false;

  /** 鍙腑姝㈢殑绛夊緟锛岃繑鍥?true 琛ㄧず琚腑姝?*/
  async function abortableSleep(ms, checkInterval = 200) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (abortFlag) return true;
      await sleep(Math.min(checkInterval, ms - (Date.now() - start)));
    }
    return false;
  }

  /** 妫€鏌ユ槸鍚﹁涓锛屾槸鍒欐姏鍑哄紓甯镐腑鏂綋鍓嶆搷浣?*/
  function checkAbort() {
    if (abortFlag) throw new Error('鐢ㄦ埛涓');
  }

  /**
   * 鍦ㄩ〉闈腑鏌ユ壘鍖呭惈鎸囧畾鏂囨湰鐨勫彲鐐瑰嚮鍏冪礌
   * 浼樺厛绾э細button > a > span > div
   */
  function findButtonByText(texts, root = document) {
    const list = Array.isArray(texts) ? texts : [texts];
    const candidates = [];

    for (const selector of ['button', 'a', '[role="button"]', 'span', 'div']) {
      const els = root.querySelectorAll(selector);
      for (const el of els) {
        // 璺宠繃闅愯棌鍏冪礌
        if (el.offsetParent === null && el.tagName !== 'BUTTON') continue;
        if (el.disabled) continue;

        const txt = el.textContent?.trim() || '';
        for (const t of list) {
          if (txt === t || txt.includes(t)) {
            // 浼樺厛绮剧‘鍖归厤
            if (txt === t) return el;
            candidates.push(el);
          }
        }
      }
      // 濡傛灉鍦?button/a 涓壘鍒颁簡鍊欓€夛紝鐩存帴杩斿洖绗竴涓?      if (candidates.length > 0) return candidates[0];
    }

    return candidates[0] || null;
  }

  /** 鏌ユ壘鎵€鏈夊尮閰嶆枃鏈殑鍏冪礌 */
  function findAllByText(text, root = document) {
    const results = [];
    const all = root.querySelectorAll('button, a, [role="button"], span, div, li, td, p, h1, h2, h3, h4, h5, h6');
    for (const el of all) {
      if (el.offsetParent === null) continue;
      if ((el.textContent?.trim() || '') === text) {
        results.push(el);
      }
    }
    return results;
  }

  /** 瀹夊叏鐐瑰嚮 */
  function safeClick(el) {
    if (!el) return false;
    try {
      el.click();
      return true;
    } catch (e) {
      // 灏濊瘯瑙﹀彂鍘熺敓鐐瑰嚮
      try {
        const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        el.dispatchEvent(evt);
        return true;
      } catch (e2) {
        log('鐐瑰嚮澶辫触: ' + e2.message, 'error');
        return false;
      }
    }
  }

  // ==================== 鏃ュ織 ====================
  function log(msg, type = 'info') {
    const colors = { info: '#1d9a8c', success: '#22c55e', error: '#ef4444', warn: '#f59e0b' };
    console.log(`%c[LazyFisher] %c${msg}`, 'font-weight:bold', `color:${colors[type] || '#fff'}`);
    // 鍚屾椂鏄剧ず鍦ㄩ潰鏉跨姸鎬佹爮
    const statusEl = document.getElementById('lf-status-text');
    if (statusEl) {
      statusEl.textContent = msg;
      statusEl.style.color = colors[type];
    }
  }

  // ==================== 鏍稿績鎿嶄綔 ====================

  /** 鐐瑰嚮"寮€濮嬪噯澶?鎸夐挳 */
  function clickPrepare() {
    log('鏌ユ壘"寮€濮嬪噯澶?鎸夐挳...');
    const btn = findButtonByText(['寮€濮嬪噯澶?, '鍑嗗鍑烘捣']);
    if (btn) {
      safeClick(btn);
      log('鉁?宸茬偣鍑?寮€濮嬪噯澶?', 'success');
      return true;
    }
    log('鉂?鏈壘鍒?寮€濮嬪噯澶?鎸夐挳锛岃纭宸插湪 /region 椤甸潰涓斿凡閫夋嫨娴烽潰鍜岃埅鏃?, 'error');
    return false;
  }

  /** 鐐瑰嚮"鍑鸿埅"鎸夐挳 */
  function clickDepart() {
    log('鏌ユ壘"鍑鸿埅"鎸夐挳...');
    // "鍑鸿埅"鍙兘鏄剧ず涓?鍑鸿埅"鎴?鐩存帴鍑鸿埅"
    const btn = findButtonByText(['鍑鸿埅', '鐩存帴鍑鸿埅']);
    if (btn) {
      safeClick(btn);
      log('鉁?宸茬偣鍑?鍑鸿埅"', 'success');
      return true;
    }
    log('鉂?鏈壘鍒?鍑鸿埅"鎸夐挳', 'error');
    return false;
  }

  /** 鐐瑰嚮"杩旇埅"鎸夐挳 */
  function clickReturn() {
    log('鏌ユ壘"杩旇埅"鎸夐挳...');
    const btn = findButtonByText(['杩旇埅', '涓诲姩杩旇埅']);
    if (btn) {
      safeClick(btn);
      log('鉁?宸茬偣鍑?杩旇埅"', 'success');
      return true;
    }
    log('鉂?鏈壘鍒?杩旇埅"鎸夐挳锛岃纭鑸瑰凡鍦ㄦ捣涓?, 'error');
    return false;
  }

  /** 鐐瑰嚮"鍙栨秷鍑嗗"鎸夐挳 */
  function clickCancelPrepare() {
    log('鏌ユ壘"鍙栨秷鍑嗗"鎸夐挳...');
    const btn = findButtonByText(['鍙栨秷鍑嗗']);
    if (btn) {
      safeClick(btn);
      log('鉁?宸茬偣鍑?鍙栨秷鍑嗗"', 'success');
      return true;
    }
    log('鉂?鏈壘鍒?鍙栨秷鍑嗗"鎸夐挳锛屽彲鑳戒笉鍦ㄥ噯澶囨€?, 'error');
    return false;
  }

  /** 鐐瑰嚮纭寮圭獥涓殑"纭"鎸夐挳 */
  function clickConfirm() {
    // 鍦?modal/dialog 涓煡鎵剧‘璁ゆ寜閽?    const modals = document.querySelectorAll(
      '[role="dialog"], .modal, .ant-modal, .MuiDialog-root, .el-dialog, [class*="modal"], [class*="dialog"], [class*="Modal"], [class*="Dialog"], [class*="confirm"], [class*="Confirm"]'
    );
    const searchRoot = modals.length > 0 ? modals[modals.length - 1] : document;

    const btn = findButtonByText(['纭', '纭畾', '鏄?, '濂界殑', '鎴戠煡閬撲簡', 'OK'], searchRoot);
    if (btn) {
      safeClick(btn);
      log('鉁?宸茬‘璁?, 'success');
      return true;
    }
    return false;
  }

  // 璺ㄩ〉闈㈡帴鍔涳細淇濆瓨寰呮墽琛岀殑鎿嶄綔
  const RESUME_KEY = 'lazyfisher_resume_action';

  function saveResumeAction(action, arg) {
    const data = JSON.stringify({ action, arg, ts: Date.now() });
    try {
      sessionStorage.setItem(RESUME_KEY, data);
    } catch (e) { /* ignore */ }
    // 鍙屼繚闄╋細鍚屾椂鍐欏叆 window.name锛堣法椤甸潰鎸佷箙鍖栵級
    try {
      window.name = 'lf_' + data;
    } catch (e) { /* ignore */ }
  }

  function loadResumeAction() {
    // 鍏堟煡 sessionStorage
    try {
      const raw = sessionStorage.getItem(RESUME_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (Date.now() - data.ts < 300000) return data;
        sessionStorage.removeItem(RESUME_KEY);
      }
    } catch (e) { /* ignore */ }

    // 鍚庡锛氭煡 window.name
    try {
      if (window.name && window.name.startsWith('lf_')) {
        const raw = window.name.slice(3);
        const data = JSON.parse(raw);
        if (Date.now() - data.ts < 300000) return data;
        window.name = '';
      }
    } catch (e) { /* ignore */ }

    return null;
  }

  function clearResumeAction() {
    try { sessionStorage.removeItem(RESUME_KEY); } catch (e) { /* ignore */ }
    try { window.name = ''; } catch (e) { /* ignore */ }
  }

  /** 灏濊瘯鐐瑰嚮瀵艰埅鍏冪礌鍒囨崲鍒扮洰鏍囬〉闈紝杩斿洖鏄惁鎴愬姛璺宠浆 */
  function tryNavigate(path) {
    if (window.location.pathname === path || window.location.pathname.startsWith(path)) {
      return true; // 宸插湪鐩爣椤甸潰
    }

    log(`浠?${window.location.pathname} 瀵艰埅鍒?${path}...`);

    const pathMap = {
      '/region': ['閽撳満', '鍖哄煙'],
      '/equipment': ['瑁呭', '鏁村'],
      '/fishing': ['閽撻奔'],
      '/keep': ['鍏婚奔', '楸间粨'],
    };
    const keywords = pathMap[path] || [];

    const clickables = document.querySelectorAll('a, button, [role="tab"], [role="link"], span, div');
    for (const el of clickables) {
      if (el.offsetParent === null && el.tagName !== 'A') continue;
      const txt = (el.textContent || '').replace(/\s+/g, '').trim();
      for (const kw of keywords) {
        if (txt === kw) {
          safeClick(el);
          log(`鉁?宸茬偣鍑?${kw}"锛岀瓑寰?SPA 瀵艰埅...`, 'success');
          return false; // 鐐逛簡瀵艰埅锛屼絾 URL 杩樻病鍙?        }
      }
    }

    return false; // 娌℃壘鍒板鑸厓绱?  }

  /** 纭繚鍦ㄦ寚瀹氶〉闈細鍏堢偣瀵艰埅 鈫?绛夊緟 鈫?鑻ュけ璐ュ垯寮哄埗璺宠浆+鎺ュ姏 */
  async function ensurePage(path, resumeAction, resumeArg) {
    if (window.location.pathname === path || window.location.pathname.startsWith(path)) {
      return true;
    }

    const clicked = tryNavigate(path);

    // 绛夊緟 SPA 璺敱鍒囨崲
    await sleep(CONFIG.longDelay);

    if (window.location.pathname === path || window.location.pathname.startsWith(path)) {
      log(`鉁?宸插埌杈?${path}`, 'success');
      return true;
    }

    // SPA 瀵艰埅澶辫触 鈫?寮哄埗璺宠浆+鎺ュ姏
    if (resumeAction) {
      saveResumeAction(resumeAction, resumeArg);
      log(`馃捑 宸蹭繚瀛樻帴鍔涳紝寮哄埗璺宠浆...`, 'info');
    }
    window.location.replace(path);
    return false;
  }

  // ==================== 缁勫悎鎿嶄綔 ====================

  /** 涓€閿細寮€濮嬪噯澶?鈫?鍑鸿埅 */
  async function oneClickPrepareAndDepart() {
    log('鈻?涓€閿噯澶?鍑鸿埅 寮€濮?..', 'info');

    if (!(await ensurePage('/region'))) return;
    checkAbort();

    // Step 1: 鐐瑰嚮鍑嗗
    if (!clickPrepare()) return;
    if (await abortableSleep(CONFIG.actionDelay)) return;

    // Step 2: 纭寮圭獥锛堝鏋滄湁锛?    clickConfirm();
    if (await abortableSleep(CONFIG.longDelay)) return;

    // Step 3: 鐐瑰嚮鍑鸿埅
    checkAbort();
    if (!clickDepart()) return;
    if (await abortableSleep(CONFIG.actionDelay)) return;

    // Step 4: 鍐嶆纭锛堝彲鑳芥湁浜屾纭锛?    clickConfirm();
    if (await abortableSleep(CONFIG.longDelay)) return;

    log('馃帀 涓€閿噯澶?鍑鸿埅 瀹屾垚锛?, 'success');
  }

  /** 涓€閿細鍙栨秷鍑嗗锛堝唴閮ㄤ娇鐢紝闈欓粯鎵ц锛?*/
  async function cancelPrepareIfNeeded() {
    if (!(await ensurePage('/region'))) return false;

    const btn = findButtonByText(['鍙栨秷鍑嗗']);
    if (btn) {
      log('妫€娴嬪埌鍑嗗鎬侊紝鍏堝彇娑堝噯澶?..', 'warn');
      safeClick(btn);
      if (await abortableSleep(CONFIG.actionDelay)) return false;
      clickConfirm();
      if (await abortableSleep(CONFIG.longDelay)) return false;
      log('鉁?宸插彇娑堝噯澶?, 'success');
      return true;
    }
    return false; // 涓嶅湪鍑嗗鎬侊紝鏃犻渶鍙栨秷
  }

  /** 涓€閿細杩旇埅锛堝惈鍙栨秷鍑嗗锛?*/
  async function oneClickReturn() {
    log('鈻?涓€閿繑鑸?寮€濮?..', 'info');

    await cancelPrepareIfNeeded();
    checkAbort();

    // Step 1: 鐐瑰嚮杩旇埅
    if (!clickReturn()) {
      await ensurePage('/region');
      clickReturn();
    }
    if (await abortableSleep(CONFIG.actionDelay)) return;

    // Step 2: 纭杩旇埅
    clickConfirm();
    if (await abortableSleep(CONFIG.longDelay)) return;

    // 鍙兘鏈変簩娆＄‘璁?    clickConfirm();
    if (await abortableSleep(CONFIG.actionDelay)) return;

    // Step 3: 杩旇埅鍚庡啀鍙栨秷鍑嗗锛堝鏋滄湁娈嬬暀鍑嗗鎬侊級
    await cancelPrepareIfNeeded();

    log('馃帀 涓€閿繑鑸?瀹屾垚锛?, 'success');
  }

  // ==================== 鐩爣楸兼壂鎻?====================

  /** 鎵弿椤甸潰涓殑"鎺㈡煡鍒扮殑楸肩兢"锛屾彁鍙栨墍鏈夐奔鍚?*/
  function scanFishNames() {
    // 1. 鎵惧寘鍚?鎺㈡煡"鏂囧瓧鐨勫鍣?    const allEls = document.querySelectorAll('div, section, ul, ol, [class*="card"], [class*="fish"], [class*="list"], [class*="grid"], [class*="container"]');
    let container = null;
    for (const el of allEls) {
      if (el.offsetParent === null) continue;
      const txt = el.textContent || '';
      if (txt.includes('鎺㈡煡') && txt.includes('楸肩兢')) {
        // 鎵炬渶鍐呭眰涓旇冻澶熷ぇ鐨勫鍣紙>=200px 楂樺害锛?        if (!container || (el.offsetHeight >= 200 && el.offsetHeight < container.offsetHeight)) {
          container = el;
        }
      }
    }
    // 鍏滃簳锛氱洿鎺ユ悳"鎺㈡煡鍒扮殑楸肩兢"
    if (!container) {
      for (const el of allEls) {
        if ((el.textContent || '').includes('鎺㈡煡鍒扮殑楸肩兢')) {
          container = el;
          break;
        }
      }
    }
    if (!container) {
      log('鏈壘鍒?鎺㈡煡鍒扮殑楸肩兢"鍖哄煙', 'warn');
      return [];
    }

    // 2. 鑷姩婊氬姩纭繚鎵€鏈夊崱鐗囧彲瑙?    const origScroll = container.scrollTop;
    const step = 150;
    for (let s = 0; s < container.scrollHeight; s += step) {
      container.scrollTop = s;
    }
    container.scrollTop = origScroll; // 鎭㈠

    // 3. 鎻愬彇楸煎悕锛氭壘瀹瑰櫒鍐呮墍鏈夋枃鏈煭涓旈潪UI鍏冪礌鐨勮妭鐐?    const fishNames = new Set();
    // 绛栫暐锛氭壘鍗＄墖鍨嬪瓙鍏冪礌锛屽彇鍏剁涓€涓暱鏂囨湰
    const cards = container.querySelectorAll('[class*="card"], [class*="item"], [class*="fish"], li, .cell, [class*="Cell"], [class*="grid"] > *');
    const candidates = cards.length > 0 ? cards : container.children;

    for (const card of candidates) {
      const txt = (card.textContent || '').trim();
      // 楸煎悕閫氬父 1-6 涓腑鏂囧瓧绗?      if (txt.length >= 1 && txt.length <= 20 && !txt.includes('鎺㈡煡') && !txt.includes('楸肩兢')) {
        // 鎺掗櫎绾暟瀛楀拰绾嫳鏂嘦I鏂囨湰
        if (!/^[\d\s.]+$/.test(txt) && !/^(No|HP|Lv|LV|EXP|exp|脳|\d+\/\d+)$/.test(txt)) {
          fishNames.add(txt);
        }
      }
    }

    // 濡傛灉鍗＄墖绛栫暐鎷垮埌澶皯锛屽皾璇曠洿鎺ュ彇鎵€鏈夊彾瀛愭枃鏈?    if (fishNames.size < 3) {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const txt = walker.currentNode.textContent.trim();
        if (txt.length >= 1 && txt.length <= 15 && /[涓€-榭縘/.test(txt)) {
          fishNames.add(txt);
        }
      }
    }

    log(`鎵弿鍒?${fishNames.size} 绉嶉奔: ${[...fishNames].slice(0, 10).join(', ')}${fishNames.size > 10 ? '...' : ''}`, 'info');
    return [...fishNames];
  }

  /** 妫€鏌ョ洰鏍囬奔鏄惁鍏ㄩ儴鎵惧埌 */
  function checkTargetFish() {
    const targets = getTargetFish();
    if (targets.length === 0) return { allFound: false, found: [], missing: [], allFish: [] };

    const allFish = scanFishNames();
    const found = [];
    const missing = [];

    for (const t of targets) {
      const match = allFish.find(f => f.includes(t) || t.includes(f));
      if (match) {
        found.push(t);
      } else {
        missing.push(t);
      }
    }

    log(`馃幆 鐩爣: ${targets.join(', ')} | 鉁呮壘鍒? ${found.join(', ') || '鏃?} | 鉂岀己灏? ${missing.join(', ') || '鏃?}`, found.length === targets.length ? 'success' : 'warn');
    return { allFound: missing.length === 0, found, missing, allFish };
  }

  // ==================== 缁勫悎鎿嶄綔 ====================

  /** 瀹屾暣寰幆锛氳繘鍏ユ垜鐨勮埞 鈫?鍙栨秷鍑嗗 鈫?鍑嗗+鍑鸿埅 鈫?鎵弿楸肩兢 鈫?鍏ㄦ壘鍒板仠姝?/ 鏈壘鍏ㄨ繑鑸噸鏉?*/
  async function fullCycle() {
    const targets = getTargetFish();
    const maxCycles = CONFIG.maxCycles;

    if (targets.length === 0) {
      log('鉂?璇峰厛鍦ㄦ搷浣滃彴杈撳叆鐩爣楸煎悕绉?, 'error');
      return;
    }

    log(`鈻?鐩爣楸煎惊鐜紑濮?| 鐩爣: ${targets.join(', ')} | 鏈€澶?${maxCycles} 杞甡, 'info');

    for (let cycle = 1; cycle <= maxCycles; cycle++) {
      checkAbort();
      log(`馃攧 绗?${cycle}/${maxCycles} 杞甡, 'info');

      // Step 1: 纭繚鍦?/region 骞惰繘鍏ユ垜鐨勮埞
      if (!(await ensurePage('/region', 'fullcycle'))) return;
      const tab = findButtonByText(['鎴戠殑鑸?]);
      if (tab) { safeClick(tab); }
      await sleep(CONFIG.actionDelay);

      // Step 2: 鍙栨秷鍑嗗
      await cancelPrepareIfNeeded();
      checkAbort();
      await sleep(CONFIG.actionDelay);

      // Step 3: 鍑嗗 + 鍑鸿埅
      await oneClickPrepareAndDepart();
      checkAbort();
      await sleep(CONFIG.longDelay);

      // Step 4: 绛?绉掕 UI 鍒锋柊锛岀劧鍚庢壂鎻忛奔缇?      log('馃攳 鎵弿鎺㈡煡鍒扮殑楸肩兢...', 'info');
      await sleep(1000);
      const result = checkTargetFish();

      if (result.allFound) {
        log(`馃帀 鐩爣楸煎叏閮ㄦ壘鍒帮紒(${result.found.join(', ')}) 鍋滄寰幆锛岀暀鍦ㄦ捣涓奰, 'success');
        return; // 涓嶈繑鑸紝鐣欏湪娴蜂笂
      }

      // Step 5: 鏈壘鍏?鈫?杩旇埅
      log(`鉂?鏈壘鍏?(缂?${result.missing.join(', ')})锛岃繑鑸繘鍏ヤ笅涓€杞?..`, 'warn');
      await oneClickReturn();
      checkAbort();
      await sleep(CONFIG.longDelay);

      // Step 6: 鍙栨秷鍑嗗锛堝噯澶囦笅涓€杞級
      await cancelPrepareIfNeeded();
      await sleep(CONFIG.actionDelay);
    }

    // 鎵€鏈夊惊鐜敤瀹?    log(`鈿?宸茶揪鏈€澶у惊鐜鏁?${maxCycles}锛岀洰鏍囬奔鏈壘鍏╜, 'warn');
    await oneClickReturn(); // 纭繚杩旇埅
    await sleep(CONFIG.actionDelay);
    await cancelPrepareIfNeeded();
    log('鐩爣楸煎惊鐜粨鏉?, 'info');
  }

  // ==================== 鎺у埗闈㈡澘 UI ====================

  function createPanel() {
    // 绉婚櫎鏃ч潰鏉?    const old = document.getElementById('lf-ship-panel');
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = 'lf-ship-panel';
    panel.innerHTML = `
      <style>
        #lf-ship-panel {
          position: fixed;
          z-index: 99999;
          background: linear-gradient(135deg, #0c4a6e 0%, #155e75 100%);
          border: 1px solid #22d3ee;
          border-radius: 12px;
          padding: 12px;
          width: 200px;
          font-family: system-ui, sans-serif;
          font-size: 13px;
          color: #e2e8f0;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
          user-select: none;
          overflow: hidden;
        }
        /* 鎶樺彔鍚庨殣钘忛潰鏉?*/
        #lf-ship-panel.lf-collapsed {
          display: none;
        }
        /* 鎶樺彔鍚庣殑鐙珛鎸夐挳 */
        #lf-collapsed-btn {
          position: fixed;
          z-index: 99999;
          width: 48px;
          height: 48px;
          user-select: none;
          touch-action: none;
          font-size: 22px;
          display: none;
          cursor: pointer;
        }
        #lf-collapsed-btn.lf-visible {
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        #lf-ship-panel .lf-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
          padding-bottom: 8px;
          border-bottom: 1px solid rgba(34,211,238,0.3);
          cursor: move;
        }
        #lf-ship-panel .lf-header-controls {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        #lf-ship-panel .lf-title {
          font-weight: bold;
          font-size: 14px;
          color: #67e8f9;
          flex: 1;
        }
        #lf-ship-panel .lf-toggle {
          background: rgba(255,255,255,0.1);
          border: 1px solid #475569;
          color: #94a3b8;
          border-radius: 3px;
          cursor: pointer;
          font-size: 12px;
          width: 20px;
          height: 20px;
          padding: 0;
          line-height: 18px;
          text-align: center;
          flex-shrink: 0;
        }
        #lf-ship-panel .lf-toggle:hover { color: #fff; border-color: #22d3ee; }
        #lf-ship-panel .lf-buttons {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        #lf-ship-panel .lf-btn {
          width: 100%;
          padding: 8px 10px;
          border: 1px solid transparent;
          border-radius: 8px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          color: #fff;
          transition: all 0.15s;
          text-align: center;
          white-space: nowrap;
          overflow: hidden;
        }
        #lf-ship-panel .lf-btn:hover { filter: brightness(1.15); }
        #lf-ship-panel .lf-btn:active { filter: brightness(0.85); }
        #lf-ship-panel .lf-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          filter: none;
        }
        #lf-ship-panel .lf-btn-prepare  { background: #0d9488; border-color: #2dd4bf; }
        #lf-ship-panel .lf-btn-return   { background: #c2410c; border-color: #fb923c; }
        #lf-ship-panel .lf-btn-cycle    { background: #7c3aed; border-color: #a78bfa; }
        #lf-ship-panel .lf-btn-stop     { background: #dc2626; border-color: #f87171; }
        #lf-ship-panel .lf-status {
          margin-top: 8px;
          padding: 6px 8px;
          background: rgba(0,0,0,0.3);
          border-radius: 6px;
          font-size: 11px;
          color: #94a3b8;
          min-height: 18px;
          word-break: break-all;
        }
        #lf-ship-panel .lf-page-indicator {
          font-size: 10px;
          color: #64748b;
          margin-top: 4px;
          text-align: center;
        }
        #lf-ship-panel .lf-config {
          display: flex;
          flex-direction: column;
          gap: 3px;
          margin-top: 6px;
          padding-top: 6px;
          border-top: 1px solid rgba(34,211,238,0.2);
        }
        #lf-ship-panel .lf-label {
          font-size: 10px;
          color: #64748b;
          margin-top: 2px;
        }
        #lf-ship-panel .lf-input {
          width: 100%;
          padding: 4px 6px;
          background: rgba(0,0,0,0.3);
          border: 1px solid #475569;
          border-radius: 4px;
          color: #e2e8f0;
          font-size: 11px;
          outline: none;
          box-sizing: border-box;
        }
        #lf-ship-panel .lf-input:focus { border-color: #22d3ee; }
        #lf-ship-panel .lf-input-short { width: 60px; }
        #lf-ship-panel.lf-dragging {
          opacity: 0.85;
          box-shadow: 0 12px 40px rgba(0,0,0,0.7);
        }
        #lf-ship-panel.lf-collapsed .lf-config {
          display: none;
        }
      </style>
      <div class="lf-header" id="lf-drag-handle" title="鎷栨嫿绉诲姩闈㈡澘">
        <span class="lf-title">${CONFIG.panelTitle}</span>
        <div class="lf-header-controls">
          <button class="lf-toggle" id="lf-toggle-btn" title="鎶樺彔涓哄浘鏍?>鈭?/button>
        </div>
      </div>
      <div class="lf-buttons" id="lf-buttons">
        <button class="lf-btn lf-btn-prepare" id="lf-btn-onestep">鈿?涓€閿噯澶?鍑鸿埅</button>
        <button class="lf-btn lf-btn-return"  id="lf-btn-return-only">鈿?涓€閿繑鑸?/button>
        <button class="lf-btn lf-btn-cycle"  id="lf-btn-cycle">馃攣 鐩爣楸煎惊鐜?/button>
        <button class="lf-btn lf-btn-stop" id="lf-btn-stop" style="display:none">鈴?鍋滄</button>
      </div>
      <div class="lf-config" id="lf-config">
        <label class="lf-label" for="lf-target-fish">馃幆 鐩爣楸?/label>
        <input class="lf-input" id="lf-target-fish" type="text" placeholder="閲戞灙楸?鏃楅奔,鐭虫枒楸? maxlength="100" value="${CONFIG.targetFishStr}">
        <label class="lf-label" for="lf-max-cycles">馃攧 鏈€澶ц疆娆?/label>
        <input class="lf-input lf-input-short" id="lf-max-cycles" type="number" min="1" max="999" value="${CONFIG.maxCycles}">
      </div>
      <div class="lf-status" id="lf-status">
        <span id="lf-status-text">灏辩华</span>
      </div>
      <div class="lf-page-indicator" id="lf-page-info">馃搷 <span id="lf-page-path"></span></div>
    `;

    document.body.appendChild(panel);

    // 鍒涘缓鎶樺彔鍚庣殑鐙珛鎸夐挳锛堣埞鍥炬爣锛?    const collapsedBtn = document.createElement('button');
    collapsedBtn.id = 'lf-collapsed-btn';
    collapsedBtn.className = 'btn btn-secondary';
    collapsedBtn.textContent = '馃殺';
    collapsedBtn.title = '灞曞紑鎿嶄綔鍙?;
    document.body.appendChild(collapsedBtn);

    // 搴旂敤淇濆瓨鐨勪綅缃?    applyPosition(panel, collapsedBtn);
    // 搴旂敤淇濆瓨鐨勬姌鍙犵姸鎬?    if (CONFIG.collapsed) {
      panel.classList.add('lf-collapsed');
      collapsedBtn.classList.add('lf-visible');
      document.getElementById('lf-toggle-btn').textContent = '+';
    }

    bindEvents(panel, collapsedBtn);
    updatePageInfo();
  }

  /** 搴旂敤浣嶇疆鍒伴潰鏉垮拰鎶樺彔鎸夐挳 */
  function applyPosition(panel, collapsedBtn) {
    const right = (CONFIG.panelRight ?? 16) + 'px';
    const top = (CONFIG.panelTop ?? 120) + 'px';
    panel.style.right = right;
    panel.style.left = 'auto';
    panel.style.top = top;
    if (collapsedBtn) {
      collapsedBtn.style.right = right;
      collapsedBtn.style.top = top;
    }
  }

  /** 淇濆瓨褰撳墠鐘舵€佸埌 localStorage */
  function persistState() {
    savePanelState({
      top: CONFIG.panelTop,
      right: CONFIG.panelRight,
      collapsed: CONFIG.collapsed,
      targetFishStr: CONFIG.targetFishStr,
      maxCycles: CONFIG.maxCycles,
    });
  }

  function bindEvents(panel, collapsedBtn) {
    const busy = { value: false };
    const stopBtn = document.getElementById('lf-btn-stop');
    const toggleBtn = document.getElementById('lf-toggle-btn');
    const handle = document.getElementById('lf-drag-handle');

    function guard(fn) {
      return async function () {
        if (busy.value) {
          log('鈴?涓婁竴鎿嶄綔浠嶅湪鎵ц涓?..', 'warn');
          return;
        }
        abortFlag = false;
        busy.value = true;
        setButtonsDisabled(true);
        stopBtn.style.display = 'block';
        try {
          await fn();
        } catch (e) {
          if (e.message === '鐢ㄦ埛涓') {
            log('鈴?鎿嶄綔宸插仠姝?, 'warn');
          } else {
            log('鎿嶄綔寮傚父: ' + e.message, 'error');
          }
        } finally {
          busy.value = false;
          abortFlag = false;
          setButtonsDisabled(false);
          stopBtn.style.display = 'none';
        }
      };
    }

    document.getElementById('lf-btn-onestep').addEventListener('click', guard(oneClickPrepareAndDepart));
    document.getElementById('lf-btn-return-only').addEventListener('click', guard(oneClickReturn));
    document.getElementById('lf-btn-cycle').addEventListener('click', guard(async () => {
      // 璇诲彇褰撳墠杈撳叆妗嗙殑鍊?      CONFIG.targetFishStr = document.getElementById('lf-target-fish').value.trim();
      CONFIG.maxCycles = parseInt(document.getElementById('lf-max-cycles').value) || 10;
      persistState();
      await fullCycle();
    }));

    // 鍋滄鎸夐挳
    stopBtn.addEventListener('click', function () {
      log('鈴?姝ｅ湪鍋滄...', 'warn');
      abortFlag = true;
    });

    // ==================== 鎷栨嫿绉诲姩 ====================
    let dragging = false;
    let startX, startY, startRight, startTop;

    function onDragStart(e) {
      if (e.target.tagName === 'BUTTON' && e.target !== collapsedBtn) return;
      e.preventDefault();
      dragging = true;

      const visibleEl = panel.classList.contains('lf-collapsed') ? collapsedBtn : panel;
      const rect = visibleEl.getBoundingClientRect();

      startX = e.clientX;
      startY = e.clientY;
      startRight = window.innerWidth - rect.right;
      startTop = rect.top;
    }

    handle.addEventListener('mousedown', onDragStart);
    collapsedBtn.addEventListener('mousedown', onDragStart);

    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const newRight = Math.max(0, startRight - dx);
      const newTop = Math.max(0, Math.min(window.innerHeight - 48, startTop + dy));
      const rightPx = newRight + 'px';
      const topPx = newTop + 'px';

      panel.style.right = rightPx;
      panel.style.left = 'auto';
      panel.style.top = topPx;
      collapsedBtn.style.right = rightPx;
      collapsedBtn.style.top = topPx;
    });

    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;

      const visibleEl = panel.classList.contains('lf-collapsed') ? collapsedBtn : panel;
      const rect = visibleEl.getBoundingClientRect();
      CONFIG.panelRight = window.innerWidth - rect.right;
      CONFIG.panelTop = rect.top;
      persistState();
    });

    // ==================== 閰嶇疆杈撳叆鑷姩淇濆瓨 ====================
    document.getElementById('lf-target-fish').addEventListener('change', function () {
      CONFIG.targetFishStr = this.value.trim();
      persistState();
    });
    document.getElementById('lf-max-cycles').addEventListener('change', function () {
      CONFIG.maxCycles = parseInt(this.value) || 10;
      persistState();
    });

    // ==================== 鎶樺彔/灞曞紑 ====================
    toggleBtn.addEventListener('click', function () {
      if (panel.classList.contains('lf-collapsed')) {
        // 灞曞紑
        panel.classList.remove('lf-collapsed');
        collapsedBtn.classList.remove('lf-visible');
        CONFIG.collapsed = false;
        toggleBtn.textContent = '鈭?;
      } else {
        // 鎶樺彔
        panel.classList.add('lf-collapsed');
        collapsedBtn.classList.add('lf-visible');
        CONFIG.collapsed = true;
        toggleBtn.textContent = '+';
      }
      persistState();
    });

    collapsedBtn.addEventListener('click', function (e) {
      if (dragging) return;
      // 鐐瑰嚮鎶樺彔鎸夐挳 鈫?灞曞紑闈㈡澘
      panel.classList.remove('lf-collapsed');
      collapsedBtn.classList.remove('lf-visible');
      CONFIG.collapsed = false;
      toggleBtn.textContent = '鈭?;
      persistState();
    });
  }

  function setButtonsDisabled(disabled) {
    const btns = document.querySelectorAll('#lf-buttons .lf-btn:not(#lf-btn-stop)');
    btns.forEach((b) => (b.disabled = disabled));
  }

  function updatePageInfo() {
    const el = document.getElementById('lf-page-path');
    if (el) {
      el.textContent = window.location.pathname || '/';
    }
  }

  // ==================== 椤甸潰璺敱鐩戝惉 ====================
  let _lastPath = window.location.pathname;
  function watchRouteChange() {
    // 浣跨敤杞婚噺鐨勫畾鏃惰疆璇㈡娴?URL 鍙樺寲锛岄伩鍏?MutationObserver 鐩戝惉鏁翠釜 body 瀵艰嚧鍗℃
    setInterval(() => {
      const currentPath = window.location.pathname;
      if (currentPath !== _lastPath) {
        _lastPath = currentPath;
        updatePageInfo();
      }
    }, 1000);
  }

  // ==================== 鍒濆鍖?====================
  function init() {
    try {
      log('鑷湁鑸规搷浣滆剼鏈凡鍔犺浇', 'success');
      log('鎷栨嫿鏍囬鏍忕Щ鍔?| 鈭?鎶樺彔涓鸿埞鍥炬爣 | 鐐瑰嚮鑸瑰浘鏍囧睍寮€', 'info');
      createPanel();
      watchRouteChange();

      // 妫€鏌ユ槸鍚︽湁寰呮仮澶嶇殑鎿嶄綔
      const pending = loadResumeAction();
      log(`馃攳 妫€鏌ユ帴鍔? ${pending ? pending.action : '鏃?}`, 'info');
      if (pending) {
        log(`馃攧 妫€娴嬪埌鏈畬鎴愮殑鎿嶄綔: ${pending.action} (arg=${pending.arg})`, 'warn');
        // 娓呴櫎鎺ュ姏鏍囪锛岄伩鍏嶉噸澶嶆墽琛?        clearResumeAction();
        setTimeout(() => {
          log(`馃殌 鑷姩鎭㈠: ${pending.action}`, 'info');
          if (pending.action === 'fullcycle') {
            // 鐩存帴璋冪敤 fullCycle锛堢幇鍦ㄥ凡鍦?/region锛屼細鐩存帴鎵ц锛?            fullCycle();
          }
        }, 2000);
      }
    } catch (e) {
      console.error('[LazyFisher] 鍒濆鍖栧け璐?', e);
    }
  }

  // 绛夊緟 SPA 娓叉煋瀹屾垚鍚庡啀鍒濆鍖栵紙杞 #root 鏄惁鏈夊唴瀹癸級
  let _initAttempts = 0;
  const MAX_ATTEMPTS = 30;

  function tryInit() {
    _initAttempts++;
    const root = document.getElementById('root');
    // 妫€鏌?#root 鏄惁鏈夎冻澶熺殑瀛愬厓绱狅紙SPA 宸叉覆鏌擄級
    if (root && root.children.length > 0) {
      init();
    } else if (_initAttempts < MAX_ATTEMPTS) {
      setTimeout(tryInit, 1000);
    } else {
      // 瓒呮椂鍏滃簳锛屼粛鐒跺皾璇曞垵濮嬪寲
      log('绛夊緟瓒呮椂锛屽己鍒跺垵濮嬪寲...', 'warn');
      init();
    }
  }

  setTimeout(tryInit, 1500);
})();
