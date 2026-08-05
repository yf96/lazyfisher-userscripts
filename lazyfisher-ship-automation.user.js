// ==UserScript==
// @name         LazyFisher 自有船操作台
// @namespace    https://lazyfisher.toogle.club
// @version      1.3.2
// @description  Ship Ops - auto prepare/depart/return + target fish loop + auto board
// @author       yf96
// @match        https://lazyfisher.toogle.club/*
// @icon         https://lazyfisher.toogle.club/pwa/fish.svg
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  console.log('[LazyFisher] 自有船操作台 v1.2.2 已加载');

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
    maxCycles: saved.maxCycles != null ? saved.maxCycles : 10,
    shipOwnerId: saved.shipOwnerId || '',
    minCrew: saved.minCrew != null ? saved.minCrew : 1
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
    console.log('%c[LF] %c' + msg, 'font-weight:bold', 'color:' + (colors[type] || '#fff'));
    var st = document.getElementById('lf-status-text');
    if (st) { st.textContent = msg; st.style.color = colors[type]; }
  }

  var BTN = {
    prepare: ['开始准备', '准备出海'],
    depart: ['出航', '直接出航'],
    ret: ['返航', '主动返航'],
    cancel: ['取消准备'],
    confirm: ['确认', '确定', '是', '好的', 'OK'],
    myShip: ['我的船']
  };

  function clickPrepare() { var btn = findButtonByText(BTN.prepare); if (btn) { safeClick(btn); return true; } log('Prepare not found', 'error'); return false; }
  function clickDepart() { var btn = findButtonByText(BTN.depart); if (btn) { safeClick(btn); return true; } log('Depart not found', 'error'); return false; }
  function clickReturn() { var btn = findButtonByText(BTN.ret); if (btn) { safeClick(btn); return true; } log('Return not found', 'error'); return false; }
  function clickCancelPrep() { var btn = findButtonByText(BTN.cancel); if (btn) { safeClick(btn); return true; } return false; }
  function clickConfirm() {
    var modals = document.querySelectorAll('[role="dialog"], .modal, .ant-modal, [class*="modal"], [class*="Modal"], [class*="dialog"], [class*="Dialog"], [class*="confirm"], [class*="Confirm"]');
    var root = modals.length > 0 ? modals[modals.length - 1] : document;
    var btn = findButtonByText(BTN.confirm, root);
    if (btn) { safeClick(btn); return true; }
    return false;
  }

  function tryNavigate(path) {
    if (window.location.pathname === path || window.location.pathname.indexOf(path) === 0) return true;
    var map = { '/region': ['钓场', '区域', '海面', '我的船', '船钓'], '/equipment': ['装备', '整备'], '/fishing': ['钓鱼', '船钓'], '/keep': ['养鱼', '鱼仓'] };
    var kw = map[path] || [path.replace('/', '')];
    var els = document.querySelectorAll('a, button, [role="tab"], [role="link"], span, div');
    for (var i = 0; i < els.length; i++) {
      var el = els[i]; if (el.offsetParent === null && el.tagName !== 'A') continue;
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

  function scanFishNames() {
    var container = null;
    var all = document.querySelectorAll('div, section, ul, ol, [class*="card"], [class*="fish"], [class*="list"], [class*="grid"], [class*="container"]');
    for (var i = 0; i < all.length; i++) {
      var el = all[i]; if (!el.offsetParent) continue;
      var t = el.textContent || '';
      if (t.indexOf('探查') !== -1 && t.indexOf('鱼') !== -1) {
        if (!container || (el.offsetHeight >= 200 && el.offsetHeight < container.offsetHeight)) container = el;
      }
    }
    if (!container) {
      for (var j = 0; j < all.length; j++) {
        if ((all[j].textContent || '').indexOf('探查到的鱼群') !== -1) { container = all[j]; break; }
      }
    }
    if (!container) { log('Fish area not found', 'warn'); return []; }
    var origScroll = container.scrollTop;
    for (var s = 0; s < container.scrollHeight; s += 150) container.scrollTop = s;
    container.scrollTop = origScroll;
    var names = new Set();
    var cards = container.querySelectorAll('[class*="card"],[class*="item"],[class*="fish"],li,.cell,[class*="Cell"],[class*="grid"]>*');
    var src = cards.length > 0 ? cards : container.children;
    for (var k = 0; k < src.length; k++) {
      var txt = (src[k].textContent || '').trim();
      if (txt.length >= 1 && txt.length <= 30 && txt.indexOf('探查') === -1) {
        if (!/^[\d\s.]+$/.test(txt) && !/^(No|HP|Lv|LV|EXP|exp|×|\d+\/\d+)$/.test(txt)) names.add(txt);
      }
    }
    if (names.size < 3) {
      var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        var t2 = walker.currentNode.textContent.trim();
        if (t2.length >= 1 && t2.length <= 15 && /[一-鿿]/.test(t2)) names.add(t2);
      }
    }
    var arr = Array.from(names);
    log('Scanned ' + arr.length + ' fish: ' + arr.slice(0, 10).join(', ') + (arr.length > 10 ? '...' : ''), 'info');
    return arr;
  }

  function checkTargetFish() {
    var targets = getTargetFish();
    if (!targets.length) return { allFound: false, found: [], missing: [], allFish: [] };
    var all = scanFishNames();
    var found = [], missing = [];
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      var match = all.find(function (f) { return f.indexOf(t) !== -1 || t.indexOf(f) !== -1; });
      if (match) found.push(t); else missing.push(t);
    }
    log('Target: ' + targets.join(',') + ' | Found: ' + (found.join(',') || 'none') + ' | Miss: ' + (missing.join(',') || 'none'),
      found.length === targets.length ? 'success' : 'warn');
    return { allFound: missing.length === 0, found: found, missing: missing, allFish: all };
  }

  var seaRegionSet = false; // 只在第一次循环时选择海域

  async function selectSeaRegion() {
    if (seaRegionSet) return; // 已经选过海域，不再重复
    var lfSelect = document.getElementById('lf-region-select');
    var regionName = lfSelect ? lfSelect.options[lfSelect.selectedIndex].text : '';
    if (!regionName || regionName === '全部海域') return;
    seaRegionSet = true;

    log('选择海域: ' + regionName, 'info');
    // 在"我的船"页面找到 label 为"海面"的 <select>
    var labels = document.querySelectorAll('label');
    var targetSelect = null;
    for (var i = 0; i < labels.length; i++) {
      if ((labels[i].textContent || '').trim() === '海面') {
        // 找到相邻的 select
        targetSelect = labels[i].parentElement.querySelector('select');
        break;
      }
    }
    if (!targetSelect) {
      log('未找到"海面"选择器', 'warn');
      return false;
    }
    // 在选项中找匹配
    for (var j = 0; j < targetSelect.options.length; j++) {
      if (targetSelect.options[j].text === regionName) {
        targetSelect.value = targetSelect.options[j].value;
        targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
        log('已设置海面为: ' + regionName, 'success');
        await sleep(CONFIG.actionDelay);
        return true;
      }
    }
    log('未找到匹配的海面选项: ' + regionName, 'warn');
    return false;
  }

  async function oneClickPrepareAndDepart() {
    log('Prepare+Depart start', 'info');
    if (!(await ensurePage('/region'))) return;
    checkAbort();
    // 切换到我的船
    var tab = findButtonByText(BTN.myShip);
    if (tab) { safeClick(tab); await sleep(CONFIG.actionDelay); }
    // 选择海域
    await selectSeaRegion();
    await sleep(CONFIG.actionDelay);
    if (!clickPrepare()) return;
    if (await abortableSleep(CONFIG.actionDelay)) return;
    clickConfirm();
    if (await abortableSleep(CONFIG.longDelay)) return;
    checkAbort();
    if (!clickDepart()) return;
    if (await abortableSleep(CONFIG.actionDelay)) return;
    clickConfirm();
    if (await abortableSleep(CONFIG.longDelay)) return;
    log('Prepare+Depart done', 'success');
  }

  async function cancelPrepareIfNeeded() {
    if (!(await ensurePage('/region'))) return false;
    var btn = findButtonByText(BTN.cancel);
    if (btn) {
      log('Cancelling prep...', 'warn');
      safeClick(btn);
      if (await abortableSleep(CONFIG.actionDelay)) return false;
      clickConfirm();
      if (await abortableSleep(CONFIG.longDelay)) return false;
      log('Prep cancelled', 'success');
      return true;
    }
    return false;
  }

  async function oneClickReturn() {
    log('Return start', 'info');
    await cancelPrepareIfNeeded();
    checkAbort();
    if (!clickReturn()) { await ensurePage('/region'); clickReturn(); }
    if (await abortableSleep(CONFIG.actionDelay)) return;
    clickConfirm();
    if (await abortableSleep(CONFIG.longDelay)) return;
    clickConfirm();
    if (await abortableSleep(CONFIG.actionDelay)) return;
    await cancelPrepareIfNeeded();
    log('Return done', 'success');
  }

  function countCrewOnPage() {
    var bodyText = document.body.innerText || '';
    var m1 = bodyText.match(/准备出海\s*[·⋅]\s*(\d+)\s*\/\s*(\d+)\s*人/);
    if (m1) return { current: parseInt(m1[1]), max: parseInt(m1[2]) };
    var m2 = bodyText.match(/(\d+)\s*\/\s*(\d+)\s*人(?:和船位)?/);
    if (m2) return { current: parseInt(m2[1]), max: parseInt(m2[2]) };
    return null;
  }

  async function autoBoard() {
    if (!CONFIG.shipOwnerId) { log('请先在操作台输入船主ID', 'error'); return; }
    log('自动上船 开始 | 船主: ' + CONFIG.shipOwnerId, 'info');
    if (!(await ensurePage('/region'))) return;
    await sleep(CONFIG.actionDelay);
    var boatTab = findButtonByText(['船钓']);
    if (boatTab) { safeClick(boatTab); await sleep(CONFIG.longDelay); }
    else { log('未找到"船钓"标签', 'error'); return; }

    // 读取下拉选框选中的海域
    var selectEl = document.getElementById('lf-region-select');
    var selectedValue = selectEl ? selectEl.value : '';
    log('搜索海域: ' + (selectedValue || '全部海域'), 'info');

    // 通过改变游戏自带 <select> 来切换海域
    var gameSelect = document.querySelector('.boat-list-filter-select');
    if (gameSelect) {
      if (selectedValue) {
        gameSelect.value = selectedValue;
        gameSelect.dispatchEvent(new Event('change', { bubbles: true }));
        log('已切换到海域: ' + selectedValue, 'success');
        await sleep(CONFIG.longDelay);
      }
      // 全部海域：先设 __all__ 触发一次
      else {
        gameSelect.value = '__all__';
        gameSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(CONFIG.longDelay);
      }
    }

    // 搜索目标船
    var found = false;
    log('正在查找船主为 "' + CONFIG.shipOwnerId + '" 的船...', 'info');
    for (var attempt = 0; attempt < 60; attempt++) {
      checkAbort();
      var allCards = document.querySelectorAll('[class*="boat"],[class*="ship"],[class*="card"],[class*="item"],[class*="row"],li,tr');
      for (var i = 0; i < allCards.length; i++) {
        var el = allCards[i];
        if (!el.offsetParent) continue;
        var txt = el.textContent || '';
        if (txt.indexOf(CONFIG.shipOwnerId) !== -1 && txt.indexOf('上船') !== -1) {
          var boardBtn = el.querySelector('button');
          if (!boardBtn) boardBtn = findButtonByText(['上船', '加入', '登船'], el);
          if (boardBtn) { safeClick(boardBtn); log('已找到目标船并点击上船', 'success'); found = true; break; }
        }
      }
      if (found) break;
      await sleep(3000);
      log('  查找中... (' + (attempt + 1) + '/60)', 'info');
    }
    if (!found) { log('未在3分钟内找到目标船', 'error'); return; }
    log('自动上船 完成', 'success');
  }

  async function fullCycle() {
    var targets = getTargetFish();
    var max = CONFIG.maxCycles;
    if (!targets.length) { log('Please set target fish first', 'error'); return; }
    log('Fish loop start: ' + targets.join(',') + ' max=' + max, 'info');
    for (var c = 1; c <= max; c++) {
      checkAbort();
      log('Round ' + c + '/' + max, 'info');
      if (!(await ensurePage('/region', 'fullcycle'))) return;
      var tab = findButtonByText(BTN.myShip);
      if (tab) safeClick(tab);
      await sleep(CONFIG.actionDelay);
      await cancelPrepareIfNeeded();
      checkAbort();
      await sleep(CONFIG.actionDelay);
      await cancelPrepareIfNeeded();
      checkAbort();
      await sleep(CONFIG.actionDelay);

      // 先点"开始准备"，进入准备态
      if (!clickPrepare()) { log('未找到准备按钮，跳过本轮', 'error'); continue; }
      if (await abortableSleep(CONFIG.actionDelay)) return;
      clickConfirm();
      await sleep(CONFIG.longDelay);

      // 准备态下等待登船人数达标
      if (CONFIG.minCrew > 1) {
        log('等待登船人数达到 ' + CONFIG.minCrew + '...', 'warn');
        for (var w = 0; w < 200; w++) {
          checkAbort();
          var crew = countCrewOnPage();
          if (crew && crew.current >= CONFIG.minCrew) { log('登船人数已达 ' + crew.current + '/' + crew.max, 'success'); break; }
          if (crew) log('  当前登船人数: ' + crew.current + '/' + crew.max + ' (需要 ' + CONFIG.minCrew + ') ' + (w + 1) + '/200', 'info');
          else log('  未检测到人数信息... (' + (w + 1) + '/200)', 'info');
          await sleep(3000);
        }
      }

      // 人数够了 → 出航
      if (!clickDepart()) { log('未找到出航按钮', 'error'); continue; }
      if (await abortableSleep(CONFIG.actionDelay)) return;
      clickConfirm();
      if (await abortableSleep(CONFIG.longDelay)) return;
      log('Scanning fish...', 'info');
      await sleep(1000);
      var result = checkTargetFish();
      if (result.allFound) {
        log('All target fish found! (' + result.found.join(',') + ') Stopping.', 'success');
        return;
      }
      log('Missing: ' + result.missing.join(',') + ' - returning for next round', 'warn');
      await oneClickReturn();
      checkAbort();
      await sleep(CONFIG.longDelay);
      await cancelPrepareIfNeeded();
      await sleep(CONFIG.actionDelay);
    }
    log('Max cycles reached, target fish not found', 'warn');
    await oneClickReturn();
    await sleep(CONFIG.actionDelay);
    await cancelPrepareIfNeeded();
    log('Fish loop ended', 'info');
  }

  function setButtonsDisabled(v) {
    var btns = document.querySelectorAll('#lf-buttons .lf-btn:not(#lf-btn-stop)');
    for (var i = 0; i < btns.length; i++) btns[i].disabled = v;
  }

  function persistState() {
    savePanelState({
      top: CONFIG.panelTop, right: CONFIG.panelRight, collapsed: CONFIG.collapsed,
      targetFishStr: CONFIG.targetFishStr, maxCycles: CONFIG.maxCycles,
      shipOwnerId: CONFIG.shipOwnerId, minCrew: CONFIG.minCrew
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
        '<button class="lf-btn lf-btn-cycle" id="lf-btn-board" style="background:#0891b2;border-color:#22d3ee">⚓ 自动上船</button>' +
        '<button class="lf-btn lf-btn-stop" id="lf-btn-stop" style="display:none">⏹ 停止</button>' +
      '</div>' +
      '<div class="lf-config" id="lf-config">' +
        '<label class="lf-label">🎯 目标鱼</label>' +
        '<input class="lf-input" id="lf-target-fish" placeholder="金枪鱼,旗鱼,石斑鱼" maxlength="100" value="' + CONFIG.targetFishStr + '">' +
        '<label class="lf-label">🔄 最大轮次</label>' +
        '<input class="lf-input lf-input-short" id="lf-max-cycles" type="number" min="1" max="999" value="' + CONFIG.maxCycles + '">' +
        '<label class="lf-label">👤 船主ID</label>' +
        '<input class="lf-input" id="lf-owner-id" placeholder="船主名字或ID" maxlength="50" value="' + (CONFIG.shipOwnerId || '') + '">' +
        '<label class="lf-label">👥 最低登船人数</label>' +
        '<input class="lf-input lf-input-short" id="lf-min-crew" type="number" min="1" max="99" value="' + CONFIG.minCrew + '">' +
        '<label class="lf-label">🌊 搜索海域</label>' +
        '<select class="lf-input" id="lf-region-select" style="color:#e2e8f0">' +
          '<option value="">全部海域</option>' +
          '<option value="boat_bailu_lake">白鹭湖·晨雾船钓之旅</option>' +
          '<option value="boat_shimen_reservoir">石门水库·深湾船钓之旅</option>' +
          '<option value="boat_baijiao_nearshore">白礁港·近海船钓之旅</option>' +
          '<option value="boat_lanchao_shelf">蓝潮岬·外缘船钓之旅</option>' +
          '<option value="boat_yinlin_offshore">银鳞岛·外海船钓之旅</option>' +
          '<option value="boat_crimson_trench">赤湾深槽船钓之旅</option>' +
          '<option value="boat_leviathan_corridor">巨影海峡船钓之旅</option>' +
          '<option value="boat_epochal_ridge">纪元洋脊船钓之旅</option>' +
          '<option value="crown_current_cape">王流海岬</option>' +
          '<option value="fissure_cape_outer">风裂岬·外台</option>' +
          '<option value="blackreef_break">黑礁断面</option>' +
          '<option value="kelp_shoal">海杉礁·海带浅礁</option>' +
          '<option value="darktide_platform">玄潮台·海山边缘</option>' +
          '<option value="stormline_reef">暴线礁·远浪台</option>' +
          '<option value="abyss_gate_shore">渊门峡·岸投端</option>' +
          '<option value="blue_current_cliff">蓝潮断岸</option>' +
          '<option value="night_trench_edge">夜坠海沟缘</option>' +
          '<option value="epoch_rift_cape">纪元裂岬</option>' +
        '</select>' +
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
        if (busy.v) { log('Already busy', 'warn'); return; }
        abortFlag = false; busy.v = true;
        setButtonsDisabled(true); stopBtn.style.display = 'block';
        try { await fn(); } catch (e) {
          if (e.message === 'user-abort') log('Stopped by user', 'warn');
          else log('Error: ' + e.message, 'error');
        } finally { busy.v = false; abortFlag = false; setButtonsDisabled(false); stopBtn.style.display = 'none'; }
      };
    }

    document.getElementById('lf-btn-onestep').addEventListener('click', guard(oneClickPrepareAndDepart));
    document.getElementById('lf-btn-return-only').addEventListener('click', guard(oneClickReturn));
    document.getElementById('lf-btn-cycle').addEventListener('click', guard(async function () {
      CONFIG.targetFishStr = document.getElementById('lf-target-fish').value.trim();
      CONFIG.maxCycles = parseInt(document.getElementById('lf-max-cycles').value) || 10;
      CONFIG.shipOwnerId = document.getElementById('lf-owner-id').value.trim();
      CONFIG.minCrew = parseInt(document.getElementById('lf-min-crew').value) || 1;
      persistState();
      await fullCycle();
    }));
    document.getElementById('lf-btn-board').addEventListener('click', guard(async function () {
      CONFIG.shipOwnerId = document.getElementById('lf-owner-id').value.trim();
      CONFIG.minCrew = parseInt(document.getElementById('lf-min-crew').value) || 1;
      persistState();
      await autoBoard();
    }));
    stopBtn.addEventListener('click', function () { log('Stopping...', 'warn'); abortFlag = true; });

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

    document.getElementById('lf-target-fish').addEventListener('change', function () { CONFIG.targetFishStr = this.value.trim(); persistState(); });
    document.getElementById('lf-max-cycles').addEventListener('change', function () { CONFIG.maxCycles = parseInt(this.value) || 10; persistState(); });
    document.getElementById('lf-owner-id').addEventListener('change', function () { CONFIG.shipOwnerId = this.value.trim(); persistState(); });
    document.getElementById('lf-min-crew').addEventListener('change', function () { CONFIG.minCrew = parseInt(this.value) || 1; persistState(); });

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

  var lastPath = window.location.pathname;
  setInterval(function () { var p = window.location.pathname; if (p !== lastPath) { lastPath = p; updatePageInfo(); } }, 1000);

  function init() {
    try {
      log('Ship Ops loaded', 'success');
      createPanel();
      var pending = loadResumeAction();
      if (pending && pending.action === 'fullcycle') { log('Resuming fish loop...', 'warn'); clearResumeAction(); setTimeout(function () { fullCycle(); }, 2000); }
    } catch (e) { console.error('[LF] Init error:', e); }
  }

  var attempts = 0;
  function tryInit() { attempts++; var root = document.getElementById('root'); if (root && root.children.length > 0) init(); else if (attempts < 30) setTimeout(tryInit, 1000); else init(); }
  setTimeout(tryInit, 1500);
})();
