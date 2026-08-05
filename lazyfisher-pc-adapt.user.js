// ==UserScript==
// @name         LazyFisher PC Adapt
// @namespace    https://lazyfisher.toogle.club/
// @version      1.3.2
// @description  Horizontal scroll (wheel), drag scroll, text wrap for LazyFisher
// @author       yf96
// @match        https://lazyfisher.toogle.club/*
// @icon         https://lazyfisher.toogle.club/pwa/fish.svg
// @grant        none
// @run-at       document-end
// ==/UserScript==
(function() {
    'use strict';

    // ========== 1. 榧犳爣婊氳疆 鈫?妯悜婊氬姩 ==========
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

    // ========== 2. 榧犳爣鎸変綇鎷栨嫿 鈫?妯℃嫙瑙︽懜婊戝姩 ==========
    (function() {
        const DRAG_THRESHOLD = 3; // 鏈€灏忕Щ鍔ㄥ儚绱狅紝浣庝簬姝ゅ€间笉瑙﹀彂鎷栨嫿锛岄伩鍏嶅奖鍝嶆枃瀛楅€夋嫨

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
                    // 浠呰褰曡捣濮嬩綅缃紝涓嶇珛鍗虫縺娲绘嫋鎷斤紝涓嶈皟鐢?preventDefault
                    // 鐣欑粰鏂囧瓧閫夋嫨绛夐粯璁よ涓?                    startX = e.clientX;
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
                // 绉诲姩瓒呰繃闃堝€兼墠婵€娲绘嫋鎷斤紝鍚﹀垯淇濈暀榛樿琛屼负锛堟枃瀛楅€夋嫨锛?                if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
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

    // ========== 3. 鏂囧瓧鑷姩鎹㈣锛堣В鍐?鈥?鎴柇闂锛?==========
    const wrapStyle = document.createElement('style');
    wrapStyle.textContent = `
        * {
            /* 闀垮崟璇?闀挎枃鏈己鍒舵崲琛?*/
            overflow-wrap: break-word !important;
            word-break: break-word !important;
        }

        /* 瑙ｉ櫎鍗曡鎴柇锛氭妸 nowrap 鈫?normal锛宔llipsis 鈫?clip */
        p, span, div, li, td, th, a, label,
        [class*="text"], [class*="desc"], [class*="name"], [class*="title"],
        [class*="content"], [class*="info"], [class*="detail"] {
            white-space: normal !important;
            text-overflow: clip !important;
        }
    `;
    document.head.appendChild(wrapStyle);

    console.log('鉁?LazyFisher PC 閫傞厤 v1.3 宸茬敓鏁?);
})();
