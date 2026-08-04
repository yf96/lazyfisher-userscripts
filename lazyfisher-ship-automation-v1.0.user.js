// ==UserScript==
// @name         LazyFisher 自有船操作台
// @namespace    https://lazyfisher.toogle.club
// @version      1.0.0
// @description  一键准备出海/出航/返航/取消准备 + 目标鱼自动循环
// @author       yf96
// @match        https://lazyfisher.toogle.club/*
// @icon         https://lazyfisher.toogle.club/pwa/fish.svg
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  console.log('[LazyFisher] 自有船操作台 v1.0.0 已加载');
  console.log('[LazyFisher] 拖拽标题栏移动 | - 折叠为图标 | 点击图标展开');

  var STORAGE_KEY = 'lazyfisher_panel_state';
  var RESUME_KEY = 'lazyfisher_resume_action';

  function loadPanelState() {
    try { var r = localStorage.getItem(STORAGE_KEY); if (r) return JSON.parse(r); } catch (e) {}
    return {};
  }
  function savePanelState(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {}
  }

  var saved = loadPanelState();

  var CONFIG = {
    panelTitle: '\u{1F6A2} 自有船操作台',
    actionDelay: 800,
    longDelay: 2500,
    panelTop: saved.top != null ? saved.top : 120,
    panelRight: saved.right != null ? saved.right : 16,
    collapsed: saved.collapsed != null ? saved.collapsed : true,
    targetFishStr: saved.targetFishStr || '',
    maxCycles: saved.maxCycles != null ? saved.maxCycles : 10
  };

  function getTargetFish() {
    return CONFIG.targetFishStr
      .split(/[,，、\s]+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; })
      .slice(0, 5);
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var abortFlag = false;

  function abortableSleep(ms, interval) {
    interval = interval || 200;
    var start = Date.now();
    return new Promise(function (resolve) {
      function tick() {
        if (abortFlag) return resolve(true);
        var remain = ms - (Date.now() - start);
        if (remain <= 0) return resolve(false);
        setTimeout(tick, Math.min(interval, remain));
      }
      tick();
    });
  }

  function checkAbort() { if (abortFlag) throw new Error('user-abort'); }

  function findButtonByText(texts, root) {
    root = root || document;
    var list = Array.isArray(texts) ? texts : [texts];
    var candidates = [];
    var selectors = ['button', 'a', '[role="button"]', 'span', 'div'];
    for (var si = 0; si < selectors.length; si++) {
      var els = root.querySelectorAll(selectors[si]);
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.offsetParent === null && el.tagName !== 'BUTTON') continue;
        if (el.disabled) continue;
        var txt = (el.textContent || '').trim();
        for (var j = 0; j < list.length; j++) {
          if (txt === list[j]) return el;
          if (txt.indexOf(list[j]) !== -1) candidates.push(el);
        }
      }
      if (candidates.length > 0) return candidates[0];
    }
    return candidates[0] || null;
  }

  function safeClick(el) {
    if (!el) return false;
    try { el.click(); return true; } catch (e) {
      try { var evt = new MouseEvent('click', { bubbles: true, cancelable: true }); el.dispatchEvent(evt); return true; }
      catch (e2) { return false; }
    }
  }

  function log(msg, type) {
    type = type || 'info';
    var colors = { info: '#1d9a8c', success: '#22c55e', error: '#ef4444', warn: '#f59e0b' };
    console.log('%c[LF] ' + msg, 'font-weight:bold;color:' + (colors[type] || '#fff'));
    var st = document.getElementById('lf-status-text');
    if (st) { st.textContent = msg; st.style.color = colors[type]; }
  }

  // Chinese button text patterns
  var BTN = {
    prepare: ['\u5f00\u59cb\u51c6\u5907', '\u51c6\u5907\u51fa\u6d77'],
    depart: ['\u51fa\u822a', '\u76f4\u63a5\u51fa\u822a'],
    ret: ['\u8fd4\u822a', '\u4e3b\u52a8\u8fd4\u822a'],
    cancel: ['\u53d6\u6d88\u51c6\u5907'],
    confirm: ['\u786e\u8ba4', '\u786e\u5b9a', '\u662f', '\u597d\u7684', 'OK'],
    myShip: ['\u6211\u7684\u8239']
  };

  function clickPrepare() {
    var btn = findButtonByText(BTN.prepare);
    if (btn) { safeClick(btn); log('已点击"开始准备"', 'success'); return true; }
    log('未找到"开始准备"按钮', 'error'); return false;
  }
  function clickDepart() {
    var btn = findButtonByText(BTN.depart);
    if (btn) { safeClick(btn); log('已点击"出航"', 'success'); return true; }
    log('未找到"出航"按钮', 'error'); return false;
  }
  function clickReturn() {
    var btn = findButtonByText(BTN.ret);
    if (btn) { safeClick(btn); log('已点击"返航"', 'success'); return true; }
    log('未找到"返航"按钮', 'error'); return false;
  }
  function clickCancelPrep() {
    var btn = findButtonByText(BTN.cancel);
    if (btn) { safeClick(btn); log('已点击"取消准备"', 'success'); return true; }
    return false;
  }
  function clickConfirm() {
    var modals = document.querySelectorAll('[role="dialog"], .modal, .ant-modal, [class*="modal"], [class*="Modal"], [class*="dialog"], [class*="Dialog"], [class*="confirm"], [class*="Confirm"]');
    var root = modals.length > 0 ? modals[modals.length - 1] : document;
    var btn = findButtonByText(BTN.confirm, root);
    if (btn) { safeClick(btn); return true; }
    return false;
  }

  // ==================== navigation ====================

  function tryNavigate(path) {
    if (window.location.pathname === path || window.location.pathname.indexOf(path) === 0) return true;
    var map = {
      '/region': ['\u9493\u573a', '\u533a\u57df', '\u6d77\u9762', '\u6211\u7684\u8239', '\u8239\u9493'],
      '/equipment': ['\u88c5\u5907', '\u6574\u5907'],
      '/fishing': ['\u9493\u9c7c', '\u8239\u9493'],
      '/keep': ['\u517b\u9c7c', '\u9c7c\u4ed3']
    };
    var kw = map[path] || [path.replace('/', '')];
    var els = document.querySelectorAll('a, button, [role="tab"], [role="link"], span, div');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.offsetParent === null && el.tagName !== 'A') continue;
      var t = (el.textContent || '').replace(/\s+/g, '').trim();
      for (var j = 0; j < kw.length; j++) { if (t === kw[j]) { safeClick(el); return false; } }
    }
    return false;
  }

  function ensurePage(path, resumeAction, resumeArg) {
    return new Promise(function (resolve) {
      if (window.location.pathname === path || window.location.pathname.indexOf(path) === 0) return resolve(true);
      tryNavigate(path);
      setTimeout(function () {
        if (window.location.pathname === path || window.location.pathname.indexOf(path) === 0) { resolve(true); return; }
        if (resumeAction) { saveResumeAction(resumeAction, resumeArg); }
        window.location.replace(path);
        resolve(false);
      }, CONFIG.longDelay);
    });
  }

  function saveResumeAction(action, arg) {
    var d = JSON.stringify({ action: action, arg: arg, ts: Date.now() });
    try { sessionStorage.setItem(RESUME_KEY, d); } catch (e) {}
    try { window.name = 'lf_' + d; } catch (e) {}
  }
  function loadResumeAction() {
    try { var r = sessionStorage.getItem(RESUME_KEY); if (r) { var d = JSON.parse(r); if (Date.now() - d.ts < 300000) return d; } } catch (e) {}
    try { if (window.name && window.name.indexOf('lf_') === 0) { var d2 = JSON.parse(window.name.slice(3)); if (Date.now() - d2.ts < 300000) return d2; } } catch (e) {}
    return null;
  }
  function clearResumeAction() { try { sessionStorage.removeItem(RESUME_KEY); } catch (e) {} try { window.name = ''; } catch (e) {} }

  // ==================== fish scanning ====================

  function scanFishNames() {
    var container = null;
    var all = document.querySelectorAll('div, section, ul, ol, [class*="card"], [class*="fish"], [class*="list"], [class*="grid"], [class*="container"]');
    for (var i = 0; i < all.length; i++) {
      var el = all[i]; if (!el.offsetParent) continue;
      var t = el.textContent || '';
      if (t.indexOf('\u63a2\u67e5') !== -1 && t.indexOf('\u9c7c') !== -1) {
        if (!container || (el.offsetHeight >= 200 && el.offsetHeight < container.offsetHeight)) container = el;
      }
    }
    if (!container) {
      for (var j = 0; j < all.length; j++) {
        if ((all[j].textContent || '').indexOf('\u63a2\u67e5\u5230\u7684\u9c7c\u7fa4') !== -1) { container = all[j]; break; }
      }
    }
    if (!container) { log('未找到"探查到的鱼群"区域', 'warn'); return []; }
    var origScroll = container.scrollTop;
    for (var s = 0; s < container.scrollHeight; s += 150) container.scrollTop = s;
    container.scrollTop = origScroll;
    var names = new Set();
    var cards = container.querySelectorAll('[class*="card"], [class*="item"], [class*="fish"], li, .cell, [class*="Cell"], [class*="grid"] > *');
    var src = cards.length > 0 ? cards : container.children;
    for (var k = 0; k < src.length; k++) {
      var txt = (src[k].textContent || '').trim();
      if (txt.length >= 1 && txt.length <= 30 && txt.indexOf('\u63a2\u67e5') === -1) {
        if (!/^[\d\s.]+$/.test(txt) && !/^(No|HP|Lv|LV|EXP|exp|\u00d7|\d+\/\d+)$/.test(txt)) {
          names.add(txt);
        }
      }
    }
    if (names.size < 3) {
      var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        var t2 = walker.currentNode.textContent.trim();
        if (t2.length >= 1 && t2.length <= 15 && /[\u4e00-\u9fff]/.test(t2)) names.add(t2);
      }
    }
    var arr = Array.from(names);
    log('扫描到 ' + arr.length + ' 种鱼: ' + arr.slice(0, 10).join(', ') + (arr.length > 10 ? '...' : ''), 'info');
    return arr;
  }

  function checkTargetFish() {
    var targets = getTargetFish();
    if (!targets.length) return { allFound: false, found: [], missing: [], allFish: [] };
    var all = scanFishNames();
    var found = [];
    var missing = [];
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      var match = all.find(function (f) { return f.indexOf(t) !== -1 || t.indexOf(f) !== -1; });
      if (match) found.push(t); else missing.push(t);
    }
    log('目标: ' + targets.join(',') + ' | 找到: ' + (found.join(',') || '无') + ' | 缺少: ' + (missing.join(',') || '无'),
      found.length === targets.length ? 'success' : 'warn');
    return { allFound: missing.length === 0, found: found, missing: missing, allFish: all };
  }

  // ==================== ship operations ====================

  async function oneClickPrepareAndDepart() {
    log('一键准备+出航 开始', 'info');
    if (!(await ensurePage('/region'))) return;
    checkAbort();
    if (!clickPrepare()) return;
    if (await abortableSleep(CONFIG.actionDelay)) return;
    clickConfirm();
    if (await abortableSleep(CONFIG.longDelay)) return;
    checkAbort();
    if (!clickDepart()) return;
    if (await abortableSleep(CONFIG.actionDelay)) return;
    clickConfirm();
    if (await abortableSleep(CONFIG.longDelay)) return;
    log('一键准备+出航 完成', 'success');
  }

  async function cancelPrepareIfNeeded() {
    if (!(await ensurePage('/region'))) return false;
    var btn = findButtonByText(BTN.cancel);
    if (btn) {
      log('检测到准备态，先取消准备...', 'warn');
      safeClick(btn);
      if (await abortableSleep(CONFIG.actionDelay)) return false;
      clickConfirm();
      if (await abortableSleep(CONFIG.longDelay)) return false;
      log('已取消准备', 'success');
      return true;
    }
    return false;
  }

  async function oneClickReturn() {
    log('一键返航 开始', 'info');
    await cancelPrepareIfNeeded();
    checkAbort();
    if (!clickReturn()) { await ensurePage('/region'); clickReturn(); }
    if (await abortableSleep(CONFIG.actionDelay)) return;
    clickConfirm();
    if (await abortableSleep(CONFIG.longDelay)) return;
    clickConfirm();
    if (await abortableSleep(CONFIG.actionDelay)) return;
    await cancelPrepareIfNeeded();
    log('一键返航 完成', 'success');
  }

  async function fullCycle() {
    var targets = getTargetFish();
    var max = CONFIG.maxCycles;
    if (!targets.length) { log('请先在操作台输入目标鱼名称', 'error'); return; }
    log('目标鱼循环开始 | 目标: ' + targets.join(',') + ' | 最多 ' + max + ' 轮', 'info');
    for (var c = 1; c <= max; c++) {
      checkAbort();
      log('第 ' + c + '/' + max + ' 轮', 'info');
      if (!(await ensurePage('/region', 'fullcycle'))) return;
      var tab = findButtonByText(BTN.myShip);
      if (tab) safeClick(tab);
      await sleep(CONFIG.actionDelay);
      await cancelPrepareIfNeeded();
      checkAbort();
      await sleep(CONFIG.actionDelay);
      await oneClickPrepareAndDepart();
      checkAbort();
      await sleep(CONFIG.longDelay);
      log('扫描探查到的鱼群...', 'info');
      await sleep(1000);
      var result = checkTargetFish();
      if (result.allFound) {
        log('目标鱼全部找到! (' + result.found.join(',') + ') 停止循环', 'success');
        return;
      }
      log('缺少: ' + result.missing.join(',') + ' - 返航进入下一轮', 'warn');
      await oneClickReturn();
      checkAbort();
      await sleep(CONFIG.longDelay);
      await cancelPrepareIfNeeded();
      await sleep(CONFIG.actionDelay);
    }
    log('已达最大轮次，目标鱼未找全', 'warn');
    await oneClickReturn();
    await sleep(CONFIG.actionDelay);
    await cancelPrepareIfNeeded();
    log('目标鱼循环结束', 'info');
  }

  // ==================== UI ====================

  function setButtonsDisabled(v) {
    var btns = document.querySelectorAll('#lf-buttons .lf-btn:not(#lf-btn-stop)');
    for (var i = 0; i < btns.length; i++) btns[i].disabled = v;
  }

  function persistState() {
    savePanelState({
      top: CONFIG.panelTop, right: CONFIG.panelRight, collapsed: CONFIG.collapsed,
      targetFishStr: CONFIG.targetFishStr, maxCycles: CONFIG.maxCycles
    });
  }

  function applyPosition(panel, cbtn) {
    var r = (CONFIG.panelRight != null ? CONFIG.panelRight : 16) + 'px';
    var t = (CONFIG.panelTop != null ? CONFIG.panelTop : 120) + 'px';
    panel.style.right = r; panel.style.left = 'auto'; panel.style.top = t;
    if (cbtn) { cbtn.style.right = r; cbtn.style.top = t; }
  }

  function updatePageInfo() {
    var el = document.getElementById('lf-page-path');
    if (el) el.textContent = window.location.pathname || '/';
  }

  function createPanel() {
    var old = document.getElementById('lf-ship-panel'); if (old) old.remove();
    var oldBtn = document.getElementById('lf-collapsed-btn'); if (oldBtn) oldBtn.remove();

    var panel = document.createElement('div');
    panel.id = 'lf-ship-panel';
    panel.innerHTML = '<style>' +
      '#lf-ship-panel{position:fixed;z-index:99999;background:linear-gradient(135deg,#0c4a6e,#155e75);border:1px solid #22d3ee;border-radius:12px;padding:12px;width:200px;font-family:system-ui,sans-serif;font-size:13px;color:#e2e8f0;box-shadow:0 8px 32px rgba(0,0,0,0.5);user-select:none;overflow:hidden}' +
      '#lf-ship-panel.lf-collapsed{display:none}' +
      '#lf-collapsed-btn{position:fixed;z-index:99999;width:48px;height:48px;user-select:none;touch-action:none;font-size:22px;display:none;cursor:pointer}' +
      '#lf-collapsed-btn.lf-visible{display:inline-flex;align-items:center;justify-content:center}' +
      '.lf-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(34,211,238,0.3);cursor:move}' +
      '.lf-header-controls{display:flex;align-items:center;gap:4px}' +
      '.lf-title{font-weight:bold;font-size:14px;color:#67e8f9;flex:1}' +
      '.lf-toggle{background:rgba(255,255,255,0.1);border:1px solid #475569;color:#94a3b8;border-radius:3px;cursor:pointer;font-size:12px;width:20px;height:20px;padding:0;line-height:18px;text-align:center;flex-shrink:0}' +
      '.lf-toggle:hover{color:#fff;border-color:#22d3ee}' +
      '.lf-buttons{display:flex;flex-direction:column;gap:6px}' +
      '.lf-btn{width:100%;padding:8px 10px;border:1px solid transparent;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;color:#fff;transition:all 0.15s;text-align:center;white-space:nowrap;overflow:hidden}' +
      '.lf-btn:hover{filter:brightness(1.15)}' +
      '.lf-btn:active{filter:brightness(0.85)}' +
      '.lf-btn:disabled{opacity:0.4;cursor:not-allowed;filter:none}' +
      '.lf-btn-prepare{background:#0d9488;border-color:#2dd4bf}' +
      '.lf-btn-return{background:#c2410c;border-color:#fb923c}' +
      '.lf-btn-cycle{background:#7c3aed;border-color:#a78bfa}' +
      '.lf-btn-stop{background:#dc2626;border-color:#f87171}' +
      '.lf-status{margin-top:8px;padding:6px 8px;background:rgba(0,0,0,0.3);border-radius:6px;font-size:11px;color:#94a3b8;min-height:18px;word-break:break-all}' +
      '.lf-page-indicator{font-size:10px;color:#64748b;margin-top:4px;text-align:center}' +
      '.lf-config{display:flex;flex-direction:column;gap:3px;margin-top:6px;padding-top:6px;border-top:1px solid rgba(34,211,238,0.2)}' +
      '.lf-label{font-size:10px;color:#64748b;margin-top:2px}' +
      '.lf-input{width:100%;padding:4px 6px;background:rgba(0,0,0,0.3);border:1px solid #475569;border-radius:4px;color:#e2e8f0;font-size:11px;outline:none;box-sizing:border-box}' +
      '.lf-input:focus{border-color:#22d3ee}' +
      '.lf-input-short{width:60px}' +
      '.lf-collapsed .lf-config{display:none}' +
      '</style>' +
      '<div class="lf-header" id="lf-drag-handle" title="拖拽移动面板">' +
        '<span class="lf-title">' + CONFIG.panelTitle + '</span>' +
        '<div class="lf-header-controls"><button class="lf-toggle" id="lf-toggle-btn">-</button></div>' +
      '</div>' +
      '<div class="lf-buttons" id="lf-buttons">' +
        '<button class="lf-btn lf-btn-prepare" id="lf-btn-onestep">⚡ 一键准备+出航</button>' +
        '<button class="lf-btn lf-btn-return" id="lf-btn-return-only">⚡ 一键返航</button>' +
        '<button class="lf-btn lf-btn-cycle" id="lf-btn-cycle">🔁 目标鱼循环</button>' +
        '<button class="lf-btn lf-btn-stop" id="lf-btn-stop" style="display:none">⏹ 停止</button>' +
      '</div>' +
      '<div class="lf-config" id="lf-config">' +
        '<label class="lf-label">🎯 目标鱼</label>' +
        '<input class="lf-input" id="lf-target-fish" placeholder="金枪鱼,旗鱼,石斑鱼" maxlength="100" value="' + CONFIG.targetFishStr + '">' +
        '<label class="lf-label">🔄 最大轮次</label>' +
        '<input class="lf-input lf-input-short" id="lf-max-cycles" type="number" min="1" max="999" value="' + CONFIG.maxCycles + '">' +
      '</div>' +
      '<div class="lf-status" id="lf-status"><span id="lf-status-text">就绪</span></div>' +
      '<div class="lf-page-indicator" id="lf-page-info">' + window.location.pathname + '</div>';

    document.body.appendChild(panel);

    var cbtn = document.createElement('button');
    cbtn.id = 'lf-collapsed-btn';
    cbtn.className = 'btn btn-secondary';
    cbtn.textContent = '\u{1F6A2}';
    cbtn.title = '展开操作台';
    document.body.appendChild(cbtn);

    applyPosition(panel, cbtn);
    if (CONFIG.collapsed) {
      panel.classList.add('lf-collapsed');
      cbtn.classList.add('lf-visible');
      document.getElementById('lf-toggle-btn').textContent = '+';
    }

    bindEvents(panel, cbtn);
    updatePageInfo();
  }

  function bindEvents(panel, cbtn) {
    var busy = { v: false };
    var stopBtn = document.getElementById('lf-btn-stop');
    var toggleBtn = document.getElementById('lf-toggle-btn');
    var handle = document.getElementById('lf-drag-handle');

    function guard(fn) {
      return async function () {
        if (busy.v) { log('上一操作仍在执行中', 'warn'); return; }
        abortFlag = false; busy.v = true;
        setButtonsDisabled(true); stopBtn.style.display = 'block';
        try { await fn(); } catch (e) {
          if (e.message === 'user-abort') log('操作已停止', 'warn');
          else log('异常: ' + e.message, 'error');
        } finally { busy.v = false; abortFlag = false; setButtonsDisabled(false); stopBtn.style.display = 'none'; }
      };
    }

    document.getElementById('lf-btn-onestep').addEventListener('click', guard(oneClickPrepareAndDepart));
    document.getElementById('lf-btn-return-only').addEventListener('click', guard(oneClickReturn));
    document.getElementById('lf-btn-cycle').addEventListener('click', guard(async function () {
      CONFIG.targetFishStr = document.getElementById('lf-target-fish').value.trim();
      CONFIG.maxCycles = parseInt(document.getElementById('lf-max-cycles').value) || 10;
      persistState();
      await fullCycle();
    }));
    stopBtn.addEventListener('click', function () { log('正在停止...', 'warn'); abortFlag = true; });

    // ===== Drag =====
    var dragging = false, startX, startY, startRight, startTop;

    function onDragStart(e) {
      if (e.target.tagName === 'BUTTON' && e.target !== cbtn) return;
      e.preventDefault(); dragging = true;
      var vel = panel.classList.contains('lf-collapsed') ? cbtn : panel;
      var rect = vel.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startRight = window.innerWidth - rect.right; startTop = rect.top;
    }
    handle.addEventListener('mousedown', onDragStart);
    cbtn.addEventListener('mousedown', onDragStart);
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var nr = Math.max(0, startRight - (e.clientX - startX));
      var nt = Math.max(0, Math.min(window.innerHeight - 48, startTop + (e.clientY - startY)));
      var rp = nr + 'px', tp = nt + 'px';
      panel.style.right = rp; panel.style.left = 'auto'; panel.style.top = tp;
      cbtn.style.right = rp; cbtn.style.top = tp;
    });
    document.addEventListener('mouseup', function () {
      if (!dragging) return; dragging = false;
      var vel = panel.classList.contains('lf-collapsed') ? cbtn : panel;
      var rect = vel.getBoundingClientRect();
      CONFIG.panelRight = window.innerWidth - rect.right;
      CONFIG.panelTop = rect.top; persistState();
    });

    // ===== Config auto-save =====
    document.getElementById('lf-target-fish').addEventListener('change', function () {
      CONFIG.targetFishStr = this.value.trim(); persistState();
    });
    document.getElementById('lf-max-cycles').addEventListener('change', function () {
      CONFIG.maxCycles = parseInt(this.value) || 10; persistState();
    });

    // ===== Collapse =====
    toggleBtn.addEventListener('click', function () {
      if (panel.classList.contains('lf-collapsed')) {
        panel.classList.remove('lf-collapsed'); cbtn.classList.remove('lf-visible');
        CONFIG.collapsed = false; toggleBtn.textContent = '-';
      } else {
        panel.classList.add('lf-collapsed'); cbtn.classList.add('lf-visible');
        CONFIG.collapsed = true; toggleBtn.textContent = '+';
      }
      persistState();
    });
    cbtn.addEventListener('click', function (e) {
      if (dragging) return;
      panel.classList.remove('lf-collapsed'); cbtn.classList.remove('lf-visible');
      CONFIG.collapsed = false; toggleBtn.textContent = '-'; persistState();
    });
  }

  // ==================== init ====================

  var lastPath = window.location.pathname;
  setInterval(function () {
    var p = window.location.pathname;
    if (p !== lastPath) { lastPath = p; updatePageInfo(); }
  }, 1000);

  function init() {
    try {
      log('自有船操作台已加载', 'success');
      createPanel();

      var pending = loadResumeAction();
      if (pending && pending.action === 'fullcycle') {
        log('检测到未完成的目标鱼循环，自动恢复...', 'warn');
        clearResumeAction();
        setTimeout(function () { fullCycle(); }, 2000);
      }
    } catch (e) { console.error('[LF] Init error:', e); }
  }

  var attempts = 0;
  function tryInit() {
    attempts++;
    var root = document.getElementById('root');
    if (root && root.children.length > 0) init();
    else if (attempts < 30) setTimeout(tryInit, 1000);
    else init();
  }
  setTimeout(tryInit, 1500);

})();