// ==UserScript==
// @name         LazyFisher Ship Automation
// @namespace    https://lazyfisher.toogle.club
// @version      1.0.0
// @description  Auto prepare, depart, return, cancel & target fish loop for own ship
// @author       yf96
// @match        https://lazyfisher.toogle.club/*
// @icon         https://lazyfisher.toogle.club/pwa/fish.svg
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'lazyfisher_panel_state';

  function loadPanelState() {
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
    panelTitle: '\u{1F6A2} 自有船操作台',
    actionDelay: 800,
    longDelay: 2500,
    panelTop: saved.top ?? 120,
    panelRight: saved.right ?? 16,
    collapsed: saved.collapsed ?? true,
    targetFishStr: saved.targetFishStr ?? '',
    maxCycles: saved.maxCycles ?? 10,
  };

  function getTargetFish() {
    return CONFIG.targetFishStr
      .split(/[,,、\s]+/)
      .map(function(s) { return s.trim(); })
      .filter(function(s) { return s.length > 0; })
      .slice(0, 5);
  }

