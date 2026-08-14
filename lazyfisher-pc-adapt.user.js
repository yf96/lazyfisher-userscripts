// ==UserScript==
// @name         LazyFisher PC Adapt
// @namespace    https://lazyfisher.toogle.club/
// @version      2.0.0
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

    // ========== 3. 响应式内容区与船钓鱼群网格 ==========
    const layoutStyle = document.createElement('style');
    layoutStyle.textContent = `
        /* 桌面端：随 main-content 的可用宽度伸缩，保留可读性上限 */
        @media (min-width: 768px) {
            .page-wrapper {
                width: 100% !important;
                max-width: none !important;
                box-sizing: border-box !important;
            }
        }

        /* 窄窗口：继续使用原站的单列内容宽度 */
        @media (max-width: 767px) {
            .page-wrapper {
                width: 100% !important;
                max-width: 480px !important;
                box-sizing: border-box !important;
            }
        }

        /* 船钓页：探查鱼群卡片按可用宽度自动换列 */
        @media (min-width: 768px) {
            /* 钓鱼页：指标卡片按内容宽度排列，空间不足时再换行 */
            .fishing-overview-grid {
                display: flex !important;
                flex-wrap: wrap !important;
                align-items: start !important;
                justify-content: flex-start !important;
                gap: 4px !important;
                grid-template-columns: none !important;
            }

            .fishing-overview-grid > .fishing-overview-item {
                flex: 0 1 auto !important;
                width: max-content !important;
                min-width: 0 !important;
                max-width: 100% !important;
            }

            /* 钓鱼页实时状态：全屏时按固定卡片宽度增加每行数量 */
            .fishing-metric-grid {
                grid-template-columns: repeat(auto-fit, 280px) !important;
                justify-content: start !important;
                align-content: start !important;
                gap: 6px !important;
                align-items: start !important;
            }

            .fishing-metric-grid > .fishing-metric-card {
                width: 280px !important;
                min-width: 280px !important;
                max-width: 280px !important;
                box-sizing: border-box !important;
            }

            /* 专精页：效果汇总表改为多组指标并排，避免两列被拉得过宽 */
            .specialization-page .lfq-spec-table {
                display: block !important;
                width: 100% !important;
                table-layout: auto !important;
            }

            .specialization-page .lfq-spec-table > tbody {
                display: grid !important;
                grid-template-columns: repeat(
                    auto-fit,
                    160px
                ) !important;
                gap: 4px !important;
                justify-content: start !important;
            }

            .specialization-page .lfq-spec-table > tbody > tr {
                display: grid !important;
                grid-template-columns: 72px 88px !important;
                width: 160px !important;
                min-width: 160px !important;
                max-width: 160px !important;
            }

            .specialization-page .lfq-spec-table td {
                width: auto !important;
                min-width: 0 !important;
                box-sizing: border-box !important;
            }

            /* 按 4 字专精名和 8 字参数的最大长度固定两列 */
            .specialization-page .lfq-spec-table td:first-child {
                width: 72px !important;
                min-width: 72px !important;
                max-width: 72px !important;
            }

            .specialization-page .lfq-spec-table td:last-child {
                width: 88px !important;
                min-width: 88px !important;
                max-width: 88px !important;
                white-space: nowrap !important;
            }

            /* 专精技能卡：根据可用宽度自动增加每行卡片数量 */
            .specialization-page .specialization-skill-grid {
                grid-template-columns: repeat(
                    auto-fit,
                    minmax(200px, 1fr)
                ) !important;
            }

            /* 背包页：按最长普通装备名固定卡片，定制线最多占五行 */
            .inventory-card-grid {
                grid-template-columns: repeat(auto-fit, 280px) !important;
                justify-content: start !important;
                align-content: start !important;
                gap: 6px !important;
            }

            .inventory-card-grid > .item-card {
                display: flex !important;
                align-items: stretch !important;
                width: 280px !important;
                min-width: 280px !important;
                max-width: 280px !important;
                height: 120px !important;
                min-height: 120px !important;
                max-height: 120px !important;
                overflow: hidden !important;
                box-sizing: border-box !important;
            }

            .inventory-card-grid .inventory-square-item-card-content {
                display: flex !important;
                flex-direction: column !important;
                justify-content: flex-start !important;
                align-items: flex-start !important;
                height: 100% !important;
                width: 266px !important;
                min-width: 266px !important;
                max-width: 266px !important;
            }

            .inventory-card-grid .inventory-card-meta {
                flex: 0 0 auto !important;
                width: 266px !important;
                max-width: 266px !important;
            }

            .inventory-card-grid .item-quantity {
                margin-top: auto !important;
                align-self: flex-start !important;
            }

            .inventory-card-grid .item-name,
            .inventory-card-grid .item-name--multiline {
                display: block !important;
                width: 266px !important;
                min-width: 0 !important;
                max-width: 266px !important;
                overflow: visible !important;
                white-space: normal !important;
                text-overflow: clip !important;
                padding-right: 0 !important;
            }

            /* 定制主线/引线：装备名和定制参数固定拆成两段 */
            .inventory-card-grid .lf-inventory-custom-line-name {
                width: 230px !important;
                max-width: 230px !important;
                overflow-wrap: normal !important;
                word-break: normal !important;
            }

            .inventory-card-grid .lf-inventory-custom-line-suffix {
                display: block !important;
                white-space: normal !important;
            }

            /* 商店页：固定商品卡片，名称最多两行，灰色参数逐项单行 */
            .compact-card-grid:has(> .shop-grid-card) {
                grid-template-columns: repeat(auto-fit, 220px) !important;
                justify-content: start !important;
                align-content: start !important;
                gap: 6px !important;
            }

            .compact-card-grid:has(> .shop-grid-card) > .shop-grid-card {
                display: flex !important;
                width: 220px !important;
                min-width: 220px !important;
                max-width: 220px !important;
                height: 190px !important;
                min-height: 190px !important;
                max-height: 190px !important;
                overflow: hidden !important;
                box-sizing: border-box !important;
            }

            .compact-card-grid:has(> .shop-grid-card) .square-item-card-content {
                display: flex !important;
                flex-direction: column !important;
                justify-content: space-between !important;
                align-items: stretch !important;
                width: 206px !important;
                min-width: 206px !important;
                max-width: 206px !important;
                height: 100% !important;
            }

            .compact-card-grid:has(> .shop-grid-card) .item-name {
                display: -webkit-box !important;
                overflow: hidden !important;
                -webkit-box-orient: vertical !important;
                -webkit-line-clamp: 2 !important;
                line-clamp: 2 !important;
                width: 206px !important;
                max-width: 206px !important;
                white-space: normal !important;
                text-overflow: clip !important;
            }

            .compact-card-grid:has(> .shop-grid-card) .shop-card-meta {
                min-width: 0 !important;
                max-width: 206px !important;
                overflow: hidden !important;
            }

            .compact-card-grid:has(> .shop-grid-card) .shop-card-meta > span {
                display: block !important;
                width: 100% !important;
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: clip !important;
            }

            .compact-card-grid:has(> .shop-grid-card) .item-price {
                white-space: nowrap !important;
            }

            /* 消息页：按最长“鱼名 + 评级 + 重量/长度”固定卡片宽度 */
            .card-list:has(> .message-card) {
                display: grid !important;
                grid-template-columns: repeat(auto-fit, 440px) !important;
                justify-content: start !important;
                align-content: start !important;
                gap: 8px !important;
            }

            .card-list:has(> .message-card) > .message-card {
                width: 440px !important;
                min-width: 440px !important;
                max-width: 440px !important;
                box-sizing: border-box !important;
            }

            .card-list:has(> .message-card) .message-title,
            .card-list:has(> .message-card) .inline-meta,
            .card-list:has(> .message-card) .text-sm.text-muted,
            .card-list:has(> .message-card) .text-xs.text-muted,
            .card-list:has(> .message-card) .lfq-msg-interval,
            .card-list:has(> .message-card) .lfq-msg-interval * {
                white-space: nowrap !important;
            }

            .card-list:has(> .message-card) .text-sm.text-muted {
                overflow: visible !important;
                text-overflow: clip !important;
            }

            /* 公会成员管理：成员卡片按可用宽度自动多列排列 */
            .player-guild-card-list {
                display: grid !important;
                grid-template-columns: repeat(
                    auto-fit,
                    minmax(280px, 1fr)
                ) !important;
                gap: 8px !important;
                align-items: start !important;
            }

            /* 图鉴页：鱼类卡片按可用宽度自动多列排列 */
            .card-list:has(> .fish-card) {
                display: grid !important;
                grid-template-columns: repeat(auto-fit, 260px) !important;
                justify-content: start !important;
                align-content: start !important;
                gap: 8px !important;
                align-items: start !important;
            }

            .card-list:has(> .fish-card) > .fish-card {
                width: 260px !important;
                min-width: 260px !important;
                max-width: 260px !important;
                box-sizing: border-box !important;
            }

            /* 成就页：以当前最小窗口的原始卡片宽度固定尺寸并自动多列 */
            .card-list:has(> .achievement-card) {
                display: grid !important;
                grid-template-columns: repeat(auto-fit, 414px) !important;
                justify-content: start !important;
                align-content: start !important;
                gap: 8px !important;
                align-items: start !important;
            }

            .card-list:has(> .achievement-card) > .achievement-card {
                width: 414px !important;
                min-width: 414px !important;
                max-width: 414px !important;
                box-sizing: border-box !important;
            }

            /* 普通装备描述不截断；卡片本身固定高度并裁切超出内容 */
            .inventory-card-grid .inventory-card-meta {
                min-width: 0 !important;
                max-width: 266px !important;
            }

            /* 只有被脚本识别为“底图”的描述才显示省略号 */
            .inventory-card-grid .inventory-card-meta.lf-inventory-background-meta {
                overflow: hidden !important;
            }

            .inventory-card-grid .inventory-card-meta.lf-inventory-background-meta > span:not(:first-child) {
                display: -webkit-box !important;
                overflow: hidden !important;
                -webkit-box-orient: vertical !important;
                -webkit-line-clamp: 3 !important;
                line-clamp: 3 !important;
                white-space: normal !important;
                text-overflow: ellipsis !important;
                overflow-wrap: break-word !important;
            }

            /* 窄窗口：一行只放一张卡片，并让卡片贴合可用宽度 */
            @media (max-width: 560px) {
                .inventory-card-grid {
                    grid-template-columns: minmax(0, 1fr) !important;
                }

                .fishing-metric-grid {
                    grid-template-columns: minmax(0, 1fr) !important;
                }

                .fishing-metric-grid > .fishing-metric-card {
                    width: 100% !important;
                    min-width: 0 !important;
                    max-width: none !important;
                }

                .inventory-card-grid > .item-card {
                    width: 100% !important;
                    min-width: 0 !important;
                    max-width: none !important;
                }

                .inventory-card-grid .inventory-square-item-card-content,
                .inventory-card-grid .inventory-card-meta,
                .inventory-card-grid .item-name,
                .inventory-card-grid .item-name--multiline {
                    width: 100% !important;
                    min-width: 0 !important;
                    max-width: none !important;
                }
            }

            .page-wrapper div:has(> .region-fish-card) {
                display: grid !important;
                grid-template-columns: repeat(
                    auto-fit,
                    minmax(min(320px, 100%), 1fr)
                ) !important;
                gap: 8px !important;
            }

            /* 锁定键固定占位，鱼名和参数从同一左边界开始 */
            .region-fish-card {
                align-items: flex-start !important;
                justify-content: flex-start !important;
            }

            .region-fish-card-stack {
                display: grid !important;
                grid-template-columns: 20px minmax(0, 1fr) !important;
                column-gap: 6px !important;
                flex: 1 1 auto !important;
                min-width: 0 !important;
                align-items: stretch !important;
                justify-content: flex-start !important;
            }

            .region-fish-lock-button {
                position: static !important;
                top: auto !important;
                left: auto !important;
                right: auto !important;
                grid-column: 1 !important;
                grid-row: 1 !important;
                width: 20px !important;
                min-width: 20px !important;
                justify-self: start !important;
                align-self: start !important;
            }

            .region-fish-card-content {
                grid-column: 2 !important;
                grid-row: 1 !important;
                width: 100% !important;
                justify-content: flex-start !important;
                text-align: left !important;
            }

            .region-fish-card-content > div {
                width: 100% !important;
                min-width: 0 !important;
                align-items: flex-start !important;
            }

            .region-fish-card-content .item-name {
                justify-content: flex-start !important;
                text-align: left !important;
            }

            .region-fish-card .lfq-card-enhance {
                width: 100% !important;
                justify-content: flex-start !important;
                align-items: center !important;
            }

            .page-wrapper div:has(> .region-fish-card) > .region-fish-card {
                min-width: 0 !important;
                width: auto !important;
            }
        }

        /* 背包窄窗口：固定单列，避免卡片被压成多列窄条 */
        @media (max-width: 767px) {
            .fishing-metric-grid {
                grid-template-columns: minmax(0, 1fr) !important;
            }

            .fishing-metric-grid > .fishing-metric-card {
                width: 100% !important;
                min-width: 0 !important;
                max-width: none !important;
            }

            .inventory-card-grid {
                grid-template-columns: minmax(0, 1fr) !important;
                justify-content: stretch !important;
                align-content: start !important;
            }

            .inventory-card-grid > .item-card {
                width: 100% !important;
                min-width: 0 !important;
                max-width: none !important;
                height: 120px !important;
                min-height: 120px !important;
                max-height: 120px !important;
                overflow: hidden !important;
            }

            .inventory-card-grid .inventory-square-item-card-content,
            .inventory-card-grid .inventory-card-meta,
            .inventory-card-grid .item-name,
                .inventory-card-grid .item-name--multiline {
                width: 100% !important;
                min-width: 0 !important;
                    max-width: none !important;
                }

                .inventory-card-grid .lf-inventory-custom-line-name {
                    width: 100% !important;
                    max-width: none !important;
                }

                .compact-card-grid:has(> .shop-grid-card) {
                    grid-template-columns: minmax(0, 1fr) !important;
                }

                .compact-card-grid:has(> .shop-grid-card) > .shop-grid-card {
                    width: 100% !important;
                    min-width: 0 !important;
                    max-width: none !important;
                }

                .compact-card-grid:has(> .shop-grid-card) .square-item-card-content,
                .compact-card-grid:has(> .shop-grid-card) .item-name,
                .compact-card-grid:has(> .shop-grid-card) .shop-card-meta {
                    width: 100% !important;
                    min-width: 0 !important;
                    max-width: none !important;
                }

                .card-list:has(> .message-card) {
                    grid-template-columns: minmax(0, 1fr) !important;
                }

                .card-list:has(> .message-card) > .message-card {
                    width: 100% !important;
                    min-width: 0 !important;
                    max-width: none !important;
                    overflow-x: auto !important;
                }

                .player-guild-card-list {
                    grid-template-columns: minmax(0, 1fr) !important;
                }

                .card-list:has(> .fish-card) {
                    grid-template-columns: minmax(0, 1fr) !important;
                }

                .card-list:has(> .fish-card) > .fish-card {
                    width: 100% !important;
                    min-width: 0 !important;
                    max-width: none !important;
                }

                .card-list:has(> .achievement-card) {
                    grid-template-columns: minmax(0, 1fr) !important;
                }

                .card-list:has(> .achievement-card) > .achievement-card {
                    width: 100% !important;
                    min-width: 0 !important;
                    max-width: none !important;
                }
        }

        /* 卡片宽度足够时，水层至真饵偏好的 9 个参数保持一排 */
        @media (min-width: 1400px) {
            .page-wrapper div:has(> .region-fish-card) {
                grid-template-columns: repeat(
                    auto-fit,
                    minmax(460px, 1fr)
                ) !important;
            }

            .region-fish-card .lfq-card-enhance {
                flex-wrap: nowrap !important;
            }
        }
    `;
    document.head.appendChild(layoutStyle);

    // 背包页只给包含“底图”的描述加省略号，避免误伤完整装备名称。
    function markInventoryBackgroundMeta(root) {
        const scope = root && root.querySelectorAll ? root : document;
        scope.querySelectorAll('.inventory-card-grid .inventory-card-meta').forEach(function(meta) {
            meta.classList.toggle(
                'lf-inventory-background-meta',
                meta.textContent.indexOf('底图') !== -1
            );
        });
        scope.querySelectorAll('.inventory-card-grid .item-name').forEach(function(name) {
            const text = name.textContent;
            const marker = text.indexOf('定制主线') !== -1
                ? '定制主线'
                : (text.indexOf('定制引线') !== -1 ? '定制引线' : '');
            name.classList.toggle(
                'lf-inventory-custom-line-name',
                marker !== ''
            );

            if (marker !== '' && !name.querySelector('.lf-inventory-custom-line-suffix')) {
                const markerEnd = text.indexOf(marker) + marker.length;
                const head = text.slice(0, markerEnd);
                const suffix = text.slice(markerEnd).trim();
                name.textContent = '';
                name.appendChild(document.createTextNode(head));
                if (suffix) {
                    const suffixEl = document.createElement('span');
                    suffixEl.className = 'lf-inventory-custom-line-suffix';
                    suffixEl.textContent = suffix;
                    name.appendChild(suffixEl);
                }
            }
        });
    }

    markInventoryBackgroundMeta(document);
    new MutationObserver(function(records) {
        records.forEach(function(record) {
            record.addedNodes.forEach(function(node) {
                if (node.nodeType === 1) markInventoryBackgroundMeta(node);
            });
        });
    }).observe(document.body, { childList: true, subtree: true });

    // ========== 4. 文字自动换行（解决 … 截断问题） ==========
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

    console.log('✅ LazyFisher PC 适配 v2.0.0 已生效');
})();
