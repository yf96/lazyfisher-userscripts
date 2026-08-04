// ==UserScript==
// @name         LazyFisher PC Adapt
// @namespace    https://lazyfisher.toogle.club/
// @version      1.3
// @description  Mouse wheel horizontal scroll, drag simulate touch, text wrap
// @author       yf96
// @match        https://lazyfisher.toogle.club/*
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
                    isDragging = true;
                    startX = e.clientX;
                    startY = e.clientY;
                    currentEl = el;
                    el.style.cursor = 'grabbing';
                    el.style.userSelect = 'none';
                    e.preventDefault();
                    return;
                }
                el = el.parentElement;
            }
        });

        document.addEventListener('mousemove', function(e) {
            if (!isDragging || !currentEl) return;
            const dx = startX - e.clientX;
            const dy = startY - e.clientY;
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
    `;
    document.head.appendChild(wrapStyle);

    console.log('✅ LazyFisher PC 适配 v1.3 已生效');
})();
