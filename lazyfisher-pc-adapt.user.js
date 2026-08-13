// ==UserScript==
// @name         LazyFisher PC Adapt
// @namespace    https://lazyfisher.toogle.club/
// @version      1.3.3
// @description  Horizontal scroll (wheel), drag scroll, text wrap for LazyFisher
// @author       yf96
// @match        https://lazyfisher.toogle.club/*
// @icon         https://lazyfisher.toogle.club/pwa/fish.svg
// @grant        none
// @run-at       document-end
// ==/UserScript==
(function() {
    'use strict';

    // ========== 1. 鼠标滚轮 → 横向滚动 ==========
    document.addEventListener('wheel', function(e) {
        let el = e.target;
        while (el && el !== document.body) {
            if (el.scrollWidth > el.clientWidth + 2) {
                e.preventDefault();
                el.scrollLeft += e.deltaY;
                return;
            }
            el = el.parentElement;
        }
    }, { passive: false });

    // ========== 2. 鼠标按住拖拽 → 模拟触摸滑动 ==========
    (function() {
        const DRAG_THRESHOLD = 3; // 最小移动像素，低于此值不触发拖拽，避免影响文字选择

        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let currentEl = null;

        document.addEventListener('mousedown', function(e) {
            let el = e.target;
            while (el && el !== document.body) {
                const hasOverflow = el.scrollWidth > el.clientWidth + 2
                                 || el.scrollHeight > el.clientHeight + 2;
                if (hasOverflow) {
                    // 仅记录起始位置，不立即激活拖拽，不调用 preventDefault
                    // 留给文字选择等默认行为
                    startX = e.clientX;
                    startY = e.clientY;
                    currentEl = el;
                    isDragging = false;
                    return;
                }
                el = el.parentElement;
            }
        });

        document.addEventListener('mousemove', function(e) {
            if (!currentEl) return;
            const dx = startX - e.clientX;
            const dy = startY - e.clientY;

            if (!isDragging) {
                // 移动超过阈值才激活拖拽，否则保留默认行为（文字选择）
                if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
                    return;
                }
                isDragging = true;
                currentEl.style.cursor = 'grabbing';
                currentEl.style.userSelect = 'none';
            }

            currentEl.scrollLeft += dx;
            currentEl.scrollTop += dy;
            startX = e.clientX;
            startY = e.clientY;
        });

        document.addEventListener('mouseup', function() {
            if (currentEl) {
                currentEl.style.cursor = '';
                currentEl.style.userSelect = '';
            }
            isDragging = false;
            currentEl = null;
        });
    })();

    // ========== 3. 文字自动换行（解决 … 截断问题） ==========
    const wrapStyle = document.createElement('style');
    wrapStyle.textContent = `
        * {
            /* 长单词/长文本强制换行 */
            overflow-wrap: break-word !important;
            word-break: break-word !important;
        }

        /* 解除单行截断：把 nowrap → normal，ellipsis → clip */
        p, span, div, li, td, th, a, label,
        [class*="text"], [class*="desc"], [class*="name"], [class*="title"],
        [class*="content"], [class*="info"], [class*="detail"] {
            white-space: normal !important;
            text-overflow: clip !important;
        }

        /* ===== 恢复例外：注入脚本与 KaTeX 公式 ===== */
        /* fish-query(lfq-)/prob-calc(lf-) 注入元素：恢复自身样式设计 */
        [class^="lf-"], [class*=" lf-"] {
            overflow-wrap: normal !important;
            word-break: normal !important;
        }

        /* fish-query 表格数字与标签：恢复 nowrap 设计 */
        .lfq-fish-table th, .lfq-fish-table td,
        .lfq-spec-table th, .lfq-spec-table td,
        .lfq-filter-label, .lfq-msg-badge {
            white-space: nowrap !important;
        }

        /* fish-query 省略号标签：恢复 nowrap + ellipsis 截断 */
        .lfq-card-tag, .lfq-region-info, #lfq-title {
            white-space: nowrap !important;
            text-overflow: ellipsis !important;
        }

        /* fish-query 装备槽位表第三列：作者内联 break-all，保持换行 */
        .lfq-fish-table td[style*="break-all"] {
            white-space: normal !important;
            word-break: break-all !important;
        }

        /* KaTeX 公式：保持单行（帮助页算法公式） */
        .katex, .katex * {
            overflow-wrap: normal !important;
            word-break: normal !important;
            white-space: nowrap !important;
        }

        /* 游戏天气行与渔场详情预报面板：数字与时间不拆断 */
        .region-weather-row span, .weather-icon-row span,
        .region-forecast-detail, .region-forecast-detail * {
            white-space: nowrap !important;
        }
    `;
    document.head.appendChild(wrapStyle);

    console.log('✅ LazyFisher PC 适配 v1.3.3 已生效');
})();
