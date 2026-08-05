// ==UserScript==
// @name         LazyFisher 上鱼概率计算器
// @namespace    lazyfisher-prob-calc
// @version      1.8.1
// @description  上鱼概率计算器。v1.8.1: 矶竿水层推断修复：根据 float_length_cm 计算实际钓深替代关键词硬映射。
// @author       大整条饵鱼
// @match        https://lazyfisher.toogle.club/*
// @match        http://lazyfisher.toogle.club/*
// @match        http://toogle.club:36018/*
// @match        https://toogle.club:36018/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    //  常量与配置
    // ============================================================

    /** localStorage key：装备缓存 */
    const EQUIP_CACHE_KEY = 'lf_prob_equipment_cache';

    /** localStorage key 前缀：核心游戏数据 */
    const CORE_CATALOG_PREFIX = 'lazyfisher-game-data-bundle:core_catalog';

    /** localStorage key 前缀：装备目录 */
    const TACKLE_CATALOG_PREFIX = 'lazyfisher-game-data-bundle:tackle_catalog';

    /** 水层相邻关系定义（surface → mid → bottom → deep） */
    const WATER_LAYER_ORDER = ['surface', 'mid', 'bottom', 'deep'];

    /** 高斯衰减 σ */
    const GAUSS_SIGMA = 6.0;   // TIME_SIGMA: 2→6 (23点验证，Spearman ρ 0.71→0.88)

    /** s_screen 下限 φ：尺寸筛选地板值（即使饵远大于鱼口也不归零） */
    const S_SCREEN_PHI = 0.2;

    /** s_screen 幂次：控制匹配度衰减速度，越大越严苛 */
    const S_SCREEN_POWER = 2.0;

    /** 钩子最小重要性因子 r_min：ρ_hook 最低值 = 1 - r_min */
    const HOOK_R_MIN = 0.3;

    /** 混合匹配权重：ρ_size 权重 */
    const MIX_WEIGHT_SIZE = 0.6;

    /** 混合匹配权重：ρ_hook 权重 */
    const MIX_WEIGHT_HOOK = 0.4;

    /** 路亚：饵过大时指数衰减系数 k */
    const LURE_OVERSIZE_K = 2.5;

    /** 路亚：饵过小时欠尺寸低保（地板值） */
    const LURE_UNDERSIZE_FLOOR = 0.35;

    /** 真饵 ρ_size：高斯 σ（相对鱼口比例） */
    const BAIT_GAUSSIAN_SIGMA = 0.5;   // 0.3→0.5 (饵口匹配窗口放宽)

    /** 矶竿 ρ_size：高斯 σ（更宽） */
    const ROCK_GAUSSIAN_SIGMA = 0.7;   // 0.5→0.7 (同步放宽)

    /** 钩号→cm：基准 */
    const HOOK_BASE_CM = 0.3;

    /** 钩号→cm：衰减系数 */
    const HOOK_SCALE_FACTOR = 0.08;

    /** 路亚钩号目标比（钩/鱼口，应略大） */
    const HOOK_TARGET_LURE = 0.9;

    /** 真饵钩号目标比（钩/鱼口，应略小） */
    const HOOK_TARGET_BAIT = 0.7;

    /** 钩匹配高斯 σ */
    const HOOK_MATCH_SIGMA = 0.4;

    /** 钓鱼页面 URL 特征 */
    const FISH_PAGE_PATTERNS = ['/fish', '/region', '/fishing'];

    /** 装备名关键词 → 饵料类型映射 */
    const BAIT_KEYWORDS = {
        corn:      ['玉米', '玉米粒'],
        soft_bait: ['软饵', '软虫', '卷尾', 'T尾', '针尾'],
        worm:      ['蚯蚓', '红虫', '沙蚕'],
        small_fish:['小鱼', '鱼苗', '泥鳅', '麦穗', '餐条'],
        insect:    ['昆虫', '蚂蚱', '蝗虫', '蛆', '苍蝇', '蟋蟀'],
        snail:     ['螺', '螺蛳', '田螺', '福寿螺'],
        algae_paste:['藻', '藻团', '藻饵', '水藻'],
        grass:     ['草', '水草', '芦苇', '浮萍'],
        spoon:     ['亮片', '勺子', '旋转亮片'],
        minnow:    ['米诺', '小胖'],
        topwater:  ['水面系', '雷蛙', '波趴', '铅笔'],
        jig:       ['铅头钩', '倒吊', '德州', '卡罗'],
        crank:     ['胖子', '摇摆', '深潜', '浅潜'],
        worm_lure: ['软饵', '卷尾', 'T尾'],
    };

    /** 竿型关键词 → 水层映射 */
    const ROD_WATER_LAYER_KEYWORDS = {
        surface: ['浮漂', '手竿', '赛竿', '矶竿浮漂'],
        mid:     ['路亚', '飞蝇'],
        bottom:  ['底钓', '抛竿', '海竿', '筏竿', '远投', '矶竿', '船竿', '深海'],
        deep:    [],
    };

    /** 装备名→类型精确查表缓存（惰性构建） */
    let tackleNameIndex = null;

    // ============================================================
    //  自有船探查鱼群（WebSocket 实时更新）
    // ============================================================

    /**
     * 探查鱼群缓存：{ region_id, voyage_id, signals: [{fish_id, encounter_weight, base_ratio, ...}], timestamp }
     * 来自 WS sync → active_ship_voyage.last_scout.signals
     */
    let scoutedFishCache = null;

    /** 自有船鱼池刷新防抖计时器 */
    let scoutRefreshTimer = null;

    /** 钓鱼模式锁定：'private_boat' | 'public_boat' | 'shore'，确定后不再回退 */
    let fishingMode = null;

    /** 探查缓存过期时间 30 分钟（超时无 WS 更新则视为航线结束） */
    const SCOUT_CACHE_TTL = 30 * 60 * 1000;

    /** 处理 WebSocket 消息，提取自有船探查鱼群 */
    function onWsScoutMessage(message) {
        if (typeof message !== 'string') return;
        var parsed;
        try { parsed = JSON.parse(message); } catch(e) { return; }
        if (!parsed || parsed.action !== 'sync') return;

        var voyage = parsed.data && parsed.data.progress && parsed.data.progress.active_ship_voyage;
        if (!voyage) return;

        var signals = voyage.last_scout && voyage.last_scout.signals;
        if (!Array.isArray(signals) || signals.length === 0) return;

        scoutedFishCache = {
            region_id: voyage.region_id || null,
            voyage_id: voyage.voyage_id || null,
            signals: signals.map(function(s) { return s; }),
            timestamp: Date.now()
        };
        fishingMode = 'private_boat';
        console.log('[LF Prob] 自有船探查鱼群更新：', signals.length, '种鱼');

        // 防抖：面板可见时自动刷新
        if (panelVisible) {
            if (scoutRefreshTimer) clearTimeout(scoutRefreshTimer);
            scoutRefreshTimer = setTimeout(function() {
                runFishingPage();
            }, 500);
        }
    }

    /** 劫持 MessageEvent.prototype.data 拦截游戏 WebSocket */
    function hookWebSocket() {
        var OrigWebSocket = window.WebSocket;
        if (!OrigWebSocket) return;

        window.WebSocket = function(url, protocols) {
            return protocols ? new OrigWebSocket(url, protocols) : new OrigWebSocket(url);
        };
        window.WebSocket.prototype = OrigWebSocket.prototype;
        try {
            window.WebSocket.CONNECTING = OrigWebSocket.CONNECTING;
            window.WebSocket.OPEN = OrigWebSocket.OPEN;
            window.WebSocket.CLOSING = OrigWebSocket.CLOSING;
            window.WebSocket.CLOSED = OrigWebSocket.CLOSED;
        } catch(e) {}

        var dataDesc = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data');
        if (!dataDesc || !dataDesc.get) return;
        var origGet = dataDesc.get;

        dataDesc.get = function() {
            var sock = this.currentTarget;
            if (!(sock instanceof WebSocket)) return origGet.call(this);
            var url = sock.url || '';
            if (url.indexOf('lazyfisher.toogle.club/ws') === -1 &&
                url.indexOf('toogle.club:36018/ws') === -1) {
                return origGet.call(this);
            }

            var msg = origGet.call(this);
            Object.defineProperty(this, 'data', { value: msg });
            try { onWsScoutMessage(msg); } catch(e) {}
            return msg;
        };
        Object.defineProperty(MessageEvent.prototype, 'data', dataDesc);
        console.log('[LF Prob] WebSocket 探查鱼群拦截已启动');
    }

    /** 判断当前页面是否为自有船 */
    function isOwnedShipPage() {
        return document.body.innerText.indexOf('自有船') !== -1;
    }

    /**
     * 从 DOM 主动抓取探查鱼群（WS 缓存缺失时的后备方案）
     * 解析 .region-fish-card 列表，提取鱼名和基础概率
     * @returns {Array|null} [{name, hasBaseProb, baseProb}, ...] 或 null
     */
    function scrapeScoutedFishFromDOM() {
        var cards = document.querySelectorAll('.region-fish-card');
        if (!cards || cards.length === 0) return null;

        var fishList = [];
        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            var textEl = card.querySelector('.region-fish-card-content div');
            if (!textEl) continue;
            var text = textEl.textContent.trim();

            // 水层关键字 → 鱼名在水层之前
            var m = text.match(/(表层|中层|底层|深层)/);
            if (!m) continue;
            var fishName = text.substring(0, m.index).trim();
            var waterLayer = m[1];
            var afterLayer = text.substring(m.index + waterLayer.length);

            // 已探查鱼（有"基础"和"鱼口"）vs 信号鱼（仅"离岸"）
            var hasBaseProb = afterLayer.indexOf('基础') !== -1;
            var baseProbMatch = afterLayer.match(/基础\s*([\d.]+)%/);
            var baseProb = baseProbMatch ? parseFloat(baseProbMatch[1]) / 100 : null;

            // 检查是否已被锁定（保留按钮状态）
            var lockBtn = card.querySelector('.region-fish-lock-button');
            var isLocked = lockBtn && lockBtn.getAttribute('aria-label') !== '保留这个鱼种';

            fishList.push({
                name: fishName,
                hasBaseProb: hasBaseProb,
                baseProb: baseProb,
                waterLayer: waterLayer,
                isLocked: isLocked
            });
        }

        console.log('[LF Prob] DOM 抓取探查鱼群：' + fishList.length + '条鱼（' +
            fishList.filter(function(f) { return f.hasBaseProb; }).length + '条已探查）');
        return fishList;
    }

    // ============================================================
    //  工具函数
    // ============================================================

    /** 高斯函数：exp(-x²/(2σ²)) */
    function gauss(x, sigma) {
        const s = sigma || GAUSS_SIGMA;
        return Math.exp(-(x * x) / (2 * s * s));
    }

    /** 24 小时环距离 */
    function hourRingDist(t, h) {
        const d = Math.abs(t - h) % 24;
        return Math.min(d, 24 - d);
    }

    /** 限制数值在 [lo, hi] */
    function clamp(v, lo, hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    /** 水层顺序索引 */
    function waterLayerIndex(layer) {
        const idx = WATER_LAYER_ORDER.indexOf(layer);
        return idx === -1 ? -1 : idx;
    }

    /** 水层匹配系数 */
    function rhoLayer(equipLayer, fishLayer) {
        if (!equipLayer) return 0.5; // 无装备信息取中性
        if (equipLayer === fishLayer) return 1.0;
        const ei = waterLayerIndex(equipLayer);
        const fi = waterLayerIndex(fishLayer);
        if (ei === -1 || fi === -1) return 0.5;
        const dist = Math.abs(ei - fi);
        if (dist === 1) return 0.7;
        return 0.3; // dist >= 2
    }

    /** 饵型匹配系数 */
    function rhoPref(equipBait, fish) {
        if (!equipBait) return 0.5; // 无装备信息取中性
        // 检查真饵偏好
        if (fish.bait_preference && fish.bait_preference === equipBait) return 1.0;
        // 检查拟饵偏好
        if (fish.lure_preference && fish.lure_preference === equipBait) return 1.0;
        return 0.3; // 不匹配
    }

    /**
     * 饵尺寸匹配系数 ρ_size（按钓法分窗口）
     * - 路亚：非对称窗口——饵过大指数衰减，饵过小取 max(ratio, floor)
     * - 真饵：双边高斯（以鱼口为中心）
     * - 矶竿：双边高斯（更宽容忍度）
     * @param {string} method - 钓法
     * @param {number|null} baitSize - 饵号数 cm
     * @param {number} mouthCm - 鱼口 cm
     * @returns {number} [0.05, 1.0]
     */
    function rhoSize(method, baitSize, mouthCm) {
        if (baitSize == null || mouthCm == null || mouthCm <= 0) return 0.0;
        var ratio = baitSize / mouthCm;

        if (method === 'lure') {
            // 路亚非对称窗口
            if (ratio >= 1) {
                // 饵过大：指数衰减
                return Math.exp(-LURE_OVERSIZE_K * (ratio - 1));
            } else {
                // 饵过小：取 max(实际匹配, 欠尺寸低保)
                return Math.max(ratio, LURE_UNDERSIZE_FLOOR);
            }
        } else {
            // 真饵 / 矶竿：高斯
            var sigma = (method === 'rock_fishing') ? ROCK_GAUSSIAN_SIGMA : BAIT_GAUSSIAN_SIGMA;
            // 高斯：已量纲化 (baitSize-mouthCm)/(sigma*mouthCm) 为无量纲偏移
            var normalizedDiff = (baitSize - mouthCm) / (sigma * mouthCm);
            return Math.exp(-(normalizedDiff * normalizedDiff) / 2);
        }
    }

    /** 天气修正系数 */
    function rhoWeather(rainVal) {
        if (rainVal == null || rainVal <= 0) return 1.0;
        if (rainVal >= 5) return 0.6;
        return 1.0 - (rainVal / 5) * 0.4;
    }

    /**
     * 根据风/云/雨匹配 weather_presets，返回匹配到的预设对象
     * @param {Object} coreData - 核心数据（含 weather_presets）
     * @param {number} wind - 风力值
     * @param {number} cloud - 云量值
     * @param {number} rain - 雨量值
     * @returns {Object|null} 匹配到的预设 或 null
     */
    function getWeatherPreset(coreData, wind, cloud, rain) {
        if (!coreData || !coreData.weather_presets) return null;
        const presets = coreData.weather_presets;
        if (!presets || presets.length === 0) return null;

        // 初筛：三项均在各自范围内
        const matches = presets.filter(function (p) {
            const wOk = wind == null || (wind >= p.wind_range[0] && wind <= p.wind_range[1]);
            const cOk = cloud == null || (cloud >= p.cloud_range[0] && cloud <= p.cloud_range[1]);
            const rOk = rain == null || (rain >= p.rain_range[0] && rain <= p.rain_range[1]);
            return wOk && cOk && rOk;
        });

        if (matches.length > 0) {
            matches.sort(function (a, b) {
                const aMid = (a.rain_range[0] + a.rain_range[1]) / 2;
                const bMid = (b.rain_range[0] + b.rain_range[1]) / 2;
                return Math.abs(rain - aMid) - Math.abs(rain - bMid);
            });
            return matches[0];
        }

        // 无完全匹配：加权距离找最近预设
        var best = null, bestDist = Infinity;
        for (var i = 0; i < presets.length; i++) {
            var p = presets[i];
            var wMid = (p.wind_range[0] + p.wind_range[1]) / 2;
            var cMid = (p.cloud_range[0] + p.cloud_range[1]) / 2;
            var rMid = (p.rain_range[0] + p.rain_range[1]) / 2;
            var dist = Math.abs((wind||0) - wMid) + Math.abs((cloud||0) - cMid) + Math.abs((rain||0) - rMid) * 2;
            if (dist < bestDist) { bestDist = dist; best = p; }
        }
        return best;
    }

    /**
     * 离岸偏好匹配系数
     * @param {number} spotOffshore - 钓位归一化离岸值 [-1, 1]，-1=近岸，1=远岸
     * @param {number} fishOffshorePref - 鱼种离岸偏好，需预先 Min-Max 归一化到 [-1, 1]
     * @returns {number} 匹配系数 [0.3, 1.0]
     */
    function rhoOffshore(spotOffshore, fishOffshorePref) {
        if (spotOffshore == null || fishOffshorePref == null) return 0.5;
        var dist = Math.abs(spotOffshore - fishOffshorePref);
        return 1.0 - dist * 0.35;
    }

    /**
     * 从装备名中推断饵料类型
     * 优先从 tackle_catalog 精确查表，回退到关键词匹配
     * @param {string[]} equipmentNames - 装备名称列表
     * @returns {string|null} 饵料类型或 null
     */
    function inferBaitType(equipmentNames) {
        if (!equipmentNames || equipmentNames.length === 0) return null;

        // 精确查表：从 tackle_catalog 中匹配装备名
        var index = buildTackleNameIndex();
        for (var i = 0; i < equipmentNames.length; i++) {
            var name = equipmentNames[i];
            if (index[name] && index[name].type) {
                return index[name].type;
            }
        }

        // 回退：关键词匹配
        const combined = equipmentNames.join(' ');
        for (const [baitType, keywords] of Object.entries(BAIT_KEYWORDS)) {
            if (keywords.some(kw => combined.includes(kw))) {
                return baitType;
            }
        }
        return null;
    }

    /**
     * 从装备名中推断饵料号数（cm）
     * 优先从 tackle_catalog 精确查表
     * @param {string[]} equipmentNames - 装备名称列表
     * @returns {number|null} 饵料号数或 null
     */
    function inferBaitSize(equipmentNames) {
        if (!equipmentNames || equipmentNames.length === 0) return null;

        var index = buildTackleNameIndex();
        var indexKeys = Object.keys(index);

        for (var i = 0; i < equipmentNames.length; i++) {
            var name = equipmentNames[i];

            // 1. 精确匹配
            if (index[name] && index[name].size != null) {
                return index[name].size;
            }

            // 2. 正则直接提取号数：装备文本中常有"号数 19号"格式，直取最准确
            var sizeMatch = name.match(/号数\s*([\d.]+)号/);
            if (sizeMatch) {
                return parseFloat(sizeMatch[1]);
            }

            // 3. 子串模糊匹配：装备缓存 name 可能含属性文本（如"肥鱼段备用 231饵型 活小鱼号数 19号"）
            //    优先取最长匹配 key，避免"活小鱼"错误匹配而漏掉正确的"肥鱼段"
            var bestMatch = null;
            var bestLen = 0;
            for (var j = 0; j < indexKeys.length; j++) {
                var key = indexKeys[j];
                if (name.indexOf(key) !== -1 && index[key].size != null && key.length > bestLen) {
                    bestMatch = index[key].size;
                    bestLen = key.length;
                }
            }
            if (bestMatch != null) return bestMatch;
        }
        return null;
    }

    /**
     * 从装备名列表中提取钩子信息（号数 + 类型）
     * 装备缓存格式：...钩型 单钩 号数 8/0 ...
     * 注意：钩号数"8/0"在 tackle_catalog 中存为 size=-8
     * @param {string[]} equipmentNames - 装备名称列表
     * @returns {{ size: number, type: string }|null} size 为 catalog 号数（8/0→-8），type 为钩型
     */
    function inferHookInfo(equipmentNames) {
        if (!equipmentNames || equipmentNames.length === 0) return null;
        for (var i = 0; i < equipmentNames.length; i++) {
            var name = equipmentNames[i];
            // 提取钩型
            var typeMatch = name.match(/钩型\s*(\S+)/);
            if (!typeMatch) continue;
            var hookType = typeMatch[1]; // 单钩 / 双钩 / 三本钩

            // 提取号数：优先匹配 X/Y 格式（如"8/0"→ -8）
            var sizeMatch = name.match(/号数\s*(\d+)\s*\/\s*(\d+)/);
            if (sizeMatch) {
                var numerator = parseInt(sizeMatch[1], 10);
                var denominator = parseInt(sizeMatch[2], 10);
                // /0 系列：号数越小刀越大，8/0 → -8, 1/0 → -1
                var size = denominator === 0 ? -numerator : numerator;
                return { size: size, type: hookType };
            }

            // 普通号数：匹配纯数字
            sizeMatch = name.match(/号数\s*([\d.]+)/);
            if (sizeMatch) {
                return { size: parseFloat(sizeMatch[1]), type: hookType };
            }
        }
        return null;
    }

    /**
     * 钩号数 → 近似钩口径 cm（指数映射）
     * 公式：hook_cm = HOOK_BASE_CM × exp(HOOK_SCALE_FACTOR × (15 - size))
     * size=20(最小钩) → ~0.20cm，size=0 → ~1.0cm，size=-8(8/0) → ~1.9cm
     */
    function hookCm(size) {
        if (size == null) return null;
        return HOOK_BASE_CM * Math.exp(HOOK_SCALE_FACTOR * (15 - size));
    }

    /**
     * 钩子匹配系数 ρ_hook
     * ρ_hook = 1 - (1 - p_hook_raw) × r_min
     * p_hook_raw = exp(-((hookCm/mouthCm - target)^2) / (2 × σ²))
     * @param {number|null} hookSize - hook 号数（catalog size）
     * @param {number} mouthCm - 鱼口 cm
     * @param {string} method - 'lure' | 'bait' | 'rock_fishing'
     * @returns {number} [1-r_min, 1.0]
     */
    function rhoHook(hookSize, mouthCm, method) {
        if (hookSize == null || mouthCm == null || mouthCm <= 0) return 1 - HOOK_R_MIN;
        var hcm = hookCm(hookSize);
        if (hcm == null || hcm <= 0) return 1 - HOOK_R_MIN;

        var target = (method === 'lure') ? HOOK_TARGET_LURE : HOOK_TARGET_BAIT;
        var ratio = hcm / mouthCm;
        var diff = ratio - target;
        var pRaw = Math.exp(-(diff * diff) / (2 * HOOK_MATCH_SIGMA * HOOK_MATCH_SIGMA));

        return 1 - (1 - pRaw) * HOOK_R_MIN;
    }

    /**
     * 根据饵型和竿型推断钓法
     * @param {string|null} baitType
     * @param {string} rodSummary - 竿型摘要
     * @returns {string} 'lure' | 'bait' | 'rock_fishing'
     */
    function getFishingMethod(baitType, rodSummary) {
        var rodText = rodSummary || '';
        // 矶竿优先
        if (rodText.indexOf('矶竿') !== -1) return 'rock_fishing';

        // 拟饵类型 → 路亚
        var lureTypes = ['spoon', 'minnow', 'topwater', 'jig', 'crank', 'worm_lure', 'jerkbait', 'chatterbait', 'spinnerbait'];
        if (baitType && lureTypes.indexOf(baitType) !== -1) return 'lure';

        // 竿型含"路亚"
        if (rodText.indexOf('路亚') !== -1) return 'lure';

        return 'bait';
    }

    /**
     * 从竿型文本推断水层
     * @param {string} rodText - 竿型文本（如"路亚 22g"）
     * @returns {string|null}
     */
    function inferWaterLayer(rodText) {
        if (!rodText) return null;
        for (const [layer, keywords] of Object.entries(ROD_WATER_LAYER_KEYWORDS)) {
            if (keywords.some(kw => rodText.includes(kw))) {
                return layer;
            }
        }
        return null;
    }

    // ============================================================
    //  数据获取：localStorage
    // ============================================================

    /** 获取核心游戏数据 */
    function getCoreCatalog() {
        try {
            const key = Object.keys(localStorage).find(
                k => k.startsWith(CORE_CATALOG_PREFIX)
            );
            if (!key) return null;
            const raw = localStorage.getItem(key);
            return JSON.parse(raw);
        } catch (e) {
            console.error('[LF Prob] 读取核心数据失败:', e);
            return null;
        }
    }

    /** 获取装备目录 */
    function getTackleCatalog() {
        try {
            const key = Object.keys(localStorage).find(
                k => k.startsWith(TACKLE_CATALOG_PREFIX)
            );
            if (!key) return null;
            const raw = localStorage.getItem(key);
            return JSON.parse(raw);
        } catch (e) {
            console.error('[LF Prob] 读取装备目录失败:', e);
            return null;
        }
    }

    /**
     * 构建装备名→类型精确查表（惰性单次构建）
     * 从 tackle_catalog 中提取所有饵料和拟饵的名称与类型
     */
    function buildTackleNameIndex() {
        if (tackleNameIndex) return tackleNameIndex;

        var catalog = getTackleCatalog();
        if (!catalog) {
            tackleNameIndex = {};
            return tackleNameIndex;
        }

        var index = {};

        // 饵料：name → bait_type
        if (catalog.baits) {
            for (var bk in catalog.baits) {
                var b = catalog.baits[bk];
                if (b && b.name && b.bait_type) {
                    index[b.name] = { type: b.bait_type, category: 'bait', size: b.size };
                }
            }
        }

        // 拟饵：lure 的 type 字段即 fish.lure_preference 匹配键
        if (catalog.lures) {
            for (var lk in catalog.lures) {
                var l = catalog.lures[lk];
                if (l && l.name) {
                    var lureType = l.type || l.lure_type || l.bait_type || null;
                    if (lureType) {
                        index[l.name] = { type: lureType, category: 'lure', size: l.size };
                    }
                }
            }
        }

        tackleNameIndex = index;
        if (Object.keys(index).length === 0) {
            console.warn('[LF Prob] tackle_catalog 中未提取到有效名称映射');
        }
        return tackleNameIndex;
    }

    /** 获取装备缓存 */
    function getEquipmentCache() {
        try {
            const raw = localStorage.getItem(EQUIP_CACHE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    /** 保存装备缓存 */
    function saveEquipmentCache(data) {
        try {
            localStorage.setItem(EQUIP_CACHE_KEY, JSON.stringify(data));
        } catch (e) {
            console.error('[LF Prob] 保存装备缓存失败:', e);
        }
    }

    // ============================================================
    //  数据获取：DOM
    // ============================================================

    /** 从钓鱼页面获取当前区域名称 */
    function getCurrentRegionName() {
        const items = document.querySelectorAll('.fishing-overview-item');
        for (const item of items) {
            const label = item.querySelector('.text-xs, .text-muted');
            if (label && label.textContent.includes('当前区域')) {
                const strong = item.querySelector('strong');
                return strong ? strong.textContent.trim() : null;
            }
        }
        // 后备：钓场页（自有船探查页），区域名在 .text-xs.text-muted.mt-xs 中，含"船钓"/"岸钓"关键字
        var scoutTexts = document.querySelectorAll('.text-xs.text-muted.mt-xs');
        for (var sti = 0; sti < scoutTexts.length; sti++) {
            var st = scoutTexts[sti].textContent.trim();
            if (st.indexOf('船钓') !== -1 || st.indexOf('岸钓') !== -1) {
                return st;
            }
        }
        return null;
    }

    /** 从钓鱼页面获取当前钓位名称 */
    function getCurrentSpotName() {
        const items = document.querySelectorAll('.fishing-overview-item');
        for (const item of items) {
            const label = item.querySelector('.text-xs, .text-muted');
            if (label && label.textContent.includes('当前钓位')) {
                const strong = item.querySelector('strong');
                return strong ? strong.textContent.trim() : null;
            }
        }
        return null;
    }

    /** 从钓鱼页面获取当前时间小时数 */
    function getCurrentHour() {
        const items = document.querySelectorAll('.fishing-overview-item');
        for (const item of items) {
            const label = item.querySelector('.text-xs, .text-muted');
            if (label && label.textContent.includes('时间')) {
                const strong = item.querySelector('strong');
                if (strong) {
                    const match = strong.textContent.trim().match(/^(\d{1,2}):/);
                    return match ? parseInt(match[1], 10) : null;
                }
            }
        }
        return null;
    }

    /** 从钓鱼页面获取天气数据（含雨量） */
    function getWeatherData() {
        // 主路径：从 overview-item "环境" 正则解析 (风N 云N 雨N)
        const items = document.querySelectorAll('.fishing-overview-item');
        for (const item of items) {
            const label = item.querySelector('.text-xs, .text-muted');
            if (label && label.textContent.includes('环境')) {
                const strong = item.querySelector('strong');
                if (strong) {
                    const text = strong.textContent.trim();
                    const weather = {};
                    const windMatch  = text.match(/风\s*([\d.]+)/);
                    const cloudMatch = text.match(/云\s*([\d.]+)/);
                    const rainMatch  = text.match(/雨\s*([\d.]+)/);
                    if (windMatch)  weather.wind  = parseFloat(windMatch[1]);
                    if (cloudMatch) weather.cloud = parseFloat(cloudMatch[1]);
                    if (rainMatch)  weather.rain  = parseFloat(rainMatch[1]);
                    if (Object.keys(weather).length > 0) return weather;
                }
                break;
            }
        }

        // 备选路径：从 .weather-icon-row span title 解析
        const spans = document.querySelectorAll('.weather-icon-row span');
        const weather = {};
        for (const span of spans) {
            const title = span.getAttribute('title') || '';
            const match = title.match(/^(雨|风|云)\s+([\d.]+)/);
            if (match) {
                const key = match[1] === '雨' ? 'rain' : match[1] === '风' ? 'wind' : 'cloud';
                weather[key] = parseFloat(match[2]);
            }
        }
        return weather;
    }

    /** 从装备页提取装备配置 */
    function extractEquipmentFromPage() {
        try {
            // 获取装备摘要（竿型、抛距等）
            const summaryEl = document.querySelector('.equipment-selection-summary');
            const summaryText = summaryEl ? summaryEl.textContent.trim() : '';

            // 获取 loadout 控制摘要（含"路亚动作 中层匀速"等水层信息）
            const loadoutSummaryEl = document.querySelector('.loadout-control-summary');
            const loadoutSummaryText = loadoutSummaryEl ? loadoutSummaryEl.textContent.trim() : '';

            // 遍历 .loadout-slot 获取所有槽位装备（覆盖 active 和折叠状态）
            const slots = document.querySelectorAll('.loadout-slot');
            const equipment = [];
            const equipmentNames = [];

            for (const slot of slots) {
                // 槽位名：.loadout-slot-label
                const labelEl = slot.querySelector('.loadout-slot-label');
                const slotName = labelEl ? labelEl.textContent.trim() : '';

                // 装备名：优先从 .equipment-item-name / .item-name
                let equipName = '';
                const nameEl = slot.querySelector('.equipment-item-name, .item-name');
                if (nameEl) {
                    equipName = nameEl.textContent.trim();
                } else {
                    // 非 active 槽位折叠显示，从 slot 整体 textContent 解析
                    // 格式类似 "鱼竿 详情 极光远投竿..."
                    const fullText = slot.textContent.trim();
                    const textWithoutLabel = slotName
                        ? fullText.replace(slotName, '').trim()
                        : fullText;
                    const detailIdx = textWithoutLabel.indexOf('详情');
                    if (detailIdx !== -1) {
                        equipName = textWithoutLabel.substring(detailIdx + 2).trim();
                    }
                }

                equipment.push({ slot: slotName, name: equipName });
                if (equipName) equipmentNames.push(equipName);
            }

            // 推断水层：矶竿根据 float_length_cm 计算实际钓深
            let waterLayer = null;
            // 1. 优先从 loadout-control-summary 匹配
            const actionMatch = loadoutSummaryText.match(/路亚动作\s*(顶层|中层|底层|表层|沉底)/);
            if (actionMatch) {
                const layerMap = {
                    '顶层': 'surface', '表层': 'surface',
                    '中层': 'mid',
                    '底层': 'bottom', '沉底': 'bottom',
                };
                waterLayer = layerMap[actionMatch[1]] || null;
            }
            // 2. 矶竿/远投/船竿等钓底竿 → 检查装备详情中的浮漂长度确定实际可及水层
            if (!waterLayer) {
                const summaryLower = summaryText.toLowerCase();
                const isDeepRod = ['矶竿', '远投', '船竿', '深海', '筏竿', '底钓', '抛竿', '海竿'].some(
                    kw => summaryText.indexOf(kw) !== -1
                );
                if (isDeepRod) {
                    // 从装备详情中查找 float_length_cm（浮漂长度）
                    let floatLen = null;
                    for (let i = 0; i < equipment.length; i++) {
                        const name = equipment[i].name || '';
                        const detailBtn = document.querySelector('.loadout-slot:nth-child(' + (i + 1) + ') .item-detail-text');
                        if (detailBtn) {
                            const detailText = detailBtn.textContent || '';
                            const fm = detailText.match(/float_length_cm["\s:：]+([\d.]+)/);
                            if (fm) { floatLen = parseFloat(fm[1]); break; }
                        }
                        // 后备：从装备名中匹配
                        const nm = name.match(/float_length_cm["\s:：]+([\d.]+)/);
                        if (nm) { floatLen = parseFloat(nm[1]); break; }
                    }
                    // 也尝试从页面所有元素中匹配
                    if (floatLen == null) {
                        const allText = document.body.innerText || '';
                        const fm = allText.match(/float_length_cm["\s:：]+([\d.]+)/);
                        if (fm) floatLen = parseFloat(fm[1]);
                    }
                    // 根据浮漂长度判断水层：float_length_cm 代表钓深(cm)
                    if (floatLen != null) {
                        if (floatLen <= 720) {
                            waterLayer = 'surface';  // ≤7.2m 表层
                        } else if (floatLen <= 2160) {
                            waterLayer = 'mid';       // ≤21.6m 中层
                        } else if (floatLen <= 3600) {
                            waterLayer = 'bottom';    // ≤36m 底层
                        } else {
                            waterLayer = 'deep';       // >36m 深层
                        }
                    } else {
                        // 无浮漂长度数据时，钓底竿默认底层（之前默认深层有问题）
                        waterLayer = 'bottom';
                    }
                } else {
                    // 非钓底竿：默认中层
                    waterLayer = inferWaterLayer(summaryText);
                }
            }

            // 推断饵料类型（优先从装备名，其次从摘要）
            let baitType = inferBaitType(equipmentNames);
            if (!baitType) {
                baitType = inferBaitType([summaryText]);
            }

            // 推断饵料号数（从 tackle_catalog 查表）
            const baitSize = inferBaitSize(equipmentNames);

            // 推断钩子信息（号数 + 类型）
            const equipHookInfo = inferHookInfo(equipmentNames);

            return {
                water_layer: waterLayer,
                bait_type: baitType,
                bait_size: baitSize,
                hook_size: (equipHookInfo && equipHookInfo.size != null) ? equipHookInfo.size : null,
                hook_type: (equipHookInfo && equipHookInfo.type) || null,
                summary: summaryText,
                loadout_summary: loadoutSummaryText,
                equipment: equipment,
                updated_at: Date.now(),
            };
        } catch (e) {
            console.error('[LF Prob] 提取装备配置失败:', e);
            return null;
        }
    }

    // ============================================================
    //  页面判定
    // ============================================================

    function isEquipmentPage() {
        const hash = window.location.hash || '';
        const path = window.location.pathname || '';
        return hash.includes('/equipment') || path.includes('/equipment');
    }

    function isFishingPage() {
        const hash = window.location.hash || '';
        const path = window.location.pathname || '';
        const isFishUrl = path === '/fishing'
            || FISH_PAGE_PATTERNS.some(p => hash.includes(p) || path.includes(p));
        const hasFishingCard = !!document.querySelector('.fishing-compact-card');
        return isFishUrl || hasFishingCard;
    }

    // ============================================================
    //  概率计算引擎
    // ============================================================

    /**
     * 计算单条鱼的综合得分
     * @param {Object} fish - 鱼种对象
     * @param {number} baseRatio - 基础占比（来自 fish_pool）
     * @param {number} currentHour - 当前小时 0-23
     * @param {string|null} equipWaterLayer - 装备推断水层
     * @param {string|null} equipBaitType - 装备推断饵型
     * @param {number} fishActivityFactor - 天气预设活跃度因子
     * @param {number|null} spotOffshore - 钓位归一化离岸值 [-1,1]
     * @param {number|null} fishOffshoreNorm - 鱼种离岸偏好，已 Min-Max 归一化到 [-1, 1]
     * @returns {{ score: number, factors: Object }}
     */
    function calcFishScore(fish, baseRatio, currentHour, equipWaterLayer, equipBaitType, fishActivityFactor, spotOffshore, equipBaitSize, mouthCm, hookSize, method, fishOffshoreNorm) {
        // ρ_time：开口时段高斯衰减
        let rhoTime = 0.5; // 默认中性
        if (fish.bite_hours && Array.isArray(fish.bite_hours) && fish.bite_hours.length > 0) {
            let maxGauss = 0;
            for (const h of fish.bite_hours) {
                const dist = hourRingDist(currentHour, h);
                const g = gauss(dist, GAUSS_SIGMA);
                if (g > maxGauss) maxGauss = g;
            }
            rhoTime = maxGauss;
        }

        // ρ_layer：水层匹配
        const rhoL = rhoLayer(equipWaterLayer, fish.water_layer);

        // ρ_pref：饵型匹配
        const rhoP = rhoPref(equipBaitType, fish);

        // ρ_weather：天气预设活跃度因子
        const rhoW = fishActivityFactor;

        // ρ_offshore：离岸偏好匹配
        const rhoOff = spotOffshore != null && fishOffshoreNorm != null
            ? rhoOffshore(spotOffshore, fishOffshoreNorm)
            : 0.5;

        // s_screen：尺寸+钩子混合匹配（贴合游戏内部公式）
        // step 1: ρ_size（分钓法窗口）
        var rhoSz = rhoSize(method, equipBaitSize, mouthCm);

        // step 2: ρ_hook（钩子匹配）
        var rhoHk = rhoHook(hookSize, mouthCm, method);

        // step 3: 混合匹配度
        var mixedMatch = MIX_WEIGHT_SIZE * rhoSz + MIX_WEIGHT_HOOK * rhoHk;

        // step 4: s_screen = clamp(φ + (1-φ) × mixedMatch^power, φ, 1)
        var sScreen = S_SCREEN_PHI + (1 - S_SCREEN_PHI) * Math.pow(mixedMatch, S_SCREEN_POWER);

        // 综合得分（用 s_screen 替代旧的 rhoSz）
        var score = baseRatio * rhoTime * rhoL * rhoP * rhoW * rhoOff * sScreen;

        return {
            score: score,
            factors: {
                time: rhoTime,
                layer: rhoL,
                pref: rhoP,
                weather: rhoW,
                offshore: rhoOff,
                size: rhoSz,
                hook: rhoHk,
                screen: sScreen,
                base_ratio: baseRatio,
            },
        };
    }

    /**
     * 主计算函数：计算所有候选鱼的得分并排序
     * @returns {{ results: Array, regionName: string, analysis: Object }|null}
     */
    function calculateProbabilities() {
        const errors = [];

        // 1. 获取核心数据
        const coreData = getCoreCatalog();
        if (!coreData || !coreData.fish || !coreData.regions) {
            errors.push('未找到 core_catalog（游戏核心数据）');
            return { error: true, errors: errors };
        }

        // 1.5 构建 fish.id → 鱼对象 映射表
        // coreData.fish 的 key 是数字索引（"0","1",...），但 fish_pool 用 fish_id（字符串名）
        const fishById = {};
        for (const key of Object.keys(coreData.fish)) {
            const f = coreData.fish[key];
            if (f && f.id) fishById[f.id] = f;
        }

        // 2. 获取当前区域（优先 DOM，失败时从探查缓存反查）
        let regionName = getCurrentRegionName();
        let regionId = null;
        let regionData = null;

        if (!regionName) {
            // DOM 缺失（如钓场页无 fishing-overview-item），尝试探查缓存
            if (scoutedFishCache && scoutedFishCache.region_id && coreData.regions[scoutedFishCache.region_id]) {
                regionId = scoutedFishCache.region_id;
                regionData = coreData.regions[regionId];
                regionName = regionData.name || '(自有船探查)';
                console.log('[LF Prob] DOM 区域缺失，从探查缓存反查：', regionName);
            }
        }

        if (!regionName) {
            errors.push('未找到当前区域（.fishing-overview-item 中无"当前区域"标签）');
            return { error: true, errors: errors };
        }

        // 3. 匹配区域 ID（如果尚未从缓存获取）
        if (!regionData) {
            for (const [rid, rdata] of Object.entries(coreData.regions)) {
                if (rdata.name === regionName) {
                    regionId = rid;
                    regionData = rdata;
                    break;
                }
            }
        }
        if (!regionData || !regionData.fish_pool || regionData.fish_pool.length === 0) {
            errors.push(`未在 core_catalog 中找到匹配区域 "${regionName}" 或鱼池为空`);
            return { error: true, errors: errors };
        }

        // 4. 获取时间和天气（DOM 缺失时用中性默认值）
        const currentHour = getCurrentHour() || 12;
        const weather = getWeatherData();
        const rainVal = weather.rain || 0;

        // fallback 到默认 12 点，不再单独报错

        // 4.5 天气预设匹配
        const weatherPreset = getWeatherPreset(coreData, weather.wind, weather.cloud, weather.rain);
        const fishActivityFactor = weatherPreset ? weatherPreset.fish_activity_factor : rhoWeather(rainVal);
        const weatherPresetName = weatherPreset ? weatherPreset.name : '未知';

        // 4.6 当前钓位与离岸归一化
        const spotName = getCurrentSpotName();
        let spotOffshore = null;
        if (spotName && regionData && regionData.spots && regionData.spots.length > 0) {
            var offsets = [];
            var currentOffset = null;
            for (var i = 0; i < regionData.spots.length; i++) {
                var s = regionData.spots[i];
                if (s.cast_expectation_offset != null) {
                    offsets.push(s.cast_expectation_offset);
                    if (s.name === spotName) currentOffset = s.cast_expectation_offset;
                }
            }
            if (currentOffset != null && offsets.length >= 2) {
                var minOff = Math.min.apply(null, offsets);
                var maxOff = Math.max.apply(null, offsets);
                spotOffshore = maxOff > minOff ? -1 + (currentOffset - minOff) / (maxOff - minOff) * 2 : 0;
            }
        } else if (regionData && regionData.cast_expectation_offset != null) {
            // spots 为空时回退到区域级 offset，spotOffshore 归一化为 0（中位）
            spotOffshore = 0;
        }

        // 5. 获取装备配置
        const equipCache = getEquipmentCache();
        const equipWaterLayer = equipCache ? equipCache.water_layer : null;
        const equipBaitType = equipCache ? equipCache.bait_type : null;
        let equipBaitSize = equipCache ? equipCache.bait_size : null;
        // 旧版缓存兼容：bait_size 缺失时从 equipment 数组中重新推断
        if (equipBaitSize == null && equipCache && equipCache.equipment) {
            const cachedNames = equipCache.equipment
                .filter(function (e) { return e && e.name; })
                .map(function (e) { return e.name; });
            equipBaitSize = inferBaitSize(cachedNames);
        }
        var equipHookSize = equipCache ? equipCache.hook_size : null;
        var equipMethod = getFishingMethod(equipBaitType, equipCache ? equipCache.summary : '');

        // 5.5 鱼种离岸偏好 Min-Max 归一化到 [-1, 1]
        const fishOffshoreNormMap = {};
        var offshorePrefs = [];
        for (const entry of regionData.fish_pool) {
            const fish = fishById[entry.fish_id];
            if (fish && fish.offshore_preference != null) {
                offshorePrefs.push({ id: fish.id, pref: fish.offshore_preference });
            }
        }
        if (offshorePrefs.length > 0) {
            var minPref = Math.min.apply(null, offshorePrefs.map(function(x) { return x.pref; }));
            var maxPref = Math.max.apply(null, offshorePrefs.map(function(x) { return x.pref; }));
            var prefRange = maxPref - minPref;
            for (var ip = 0; ip < offshorePrefs.length; ip++) {
                var fp = offshorePrefs[ip];
                fishOffshoreNormMap[fp.id] = prefRange > 0
                    ? -1 + (fp.pref - minPref) / prefRange * 2
                    : 0;
            }
        }

        // 6. 确定有效鱼池：自有船探查缓存 → DOM 抓取 → 区域鱼池兜底
        //    fishingMode 锁定后页面切换不丢数据，超时 30 分钟自动过期
        var effectiveFishPool = regionData.fish_pool;
        var isPrivateBoat = false;

        // 缓存有效性判断
        var scoutSignals = null;
        if (scoutedFishCache && scoutedFishCache.signals && scoutedFishCache.signals.length > 0) {
            var cacheAge = Date.now() - scoutedFishCache.timestamp;
            if (cacheAge > SCOUT_CACHE_TTL) {
                // 30 分钟无 WS 更新 → 航线已结束，清空缓存
                scoutedFishCache = null;
                fishingMode = null;
                console.log('[LF Prob] 探查缓存已过期（', Math.round(cacheAge / 60000), '分钟无更新），已清除');
            } else {
                var scoutedRegionId = scoutedFishCache.region_id;
                // 条件 1: region_id 为空（服务端不填）→ 直接信任
                // 条件 2: region_id 匹配当前区域
                // 条件 3: fishingMode 已锁定自有船 → 信任缓存（航线未变）
                if (scoutedRegionId == null) {
                    scoutSignals = scoutedFishCache.signals;
                    console.log('[LF Prob] WS 探查鱼群命中（region_id 缺失）：', scoutSignals.length, '种鱼');
                } else if (String(scoutedRegionId) === String(regionId)) {
                    scoutSignals = scoutedFishCache.signals;
                    console.log('[LF Prob] WS 探查鱼群命中：', scoutSignals.length, '种鱼 (region=', regionId, ')');
                } else if (fishingMode === 'private_boat') {
                    // 自有船已锁定但 region 不匹配——可能是页面路由切换导致的 regionId 变化
                    // 信任缓存（航线状态优先于页面区域判断）
                    scoutSignals = scoutedFishCache.signals;
                    console.log('[LF Prob] 自有船模式已锁定，忽略 region 不匹配，使用缓存：', scoutSignals.length, '种鱼');
                } else {
                    console.log('[LF Prob] WS 探查鱼群 region 不匹配：缓存=', scoutedRegionId, '(', typeof scoutedRegionId, ') 当前=', regionId, '(', typeof regionId, ')');
                }
            }
        }

        // 后备：WS 缓存缺失且未锁定自有船时，从 DOM 抓取
        if (!scoutSignals && fishingMode !== 'private_boat') {
            console.log('[LF Prob] WS 缓存不可用，尝试 DOM 抓取...');
            var domFishList = scrapeScoutedFishFromDOM();
            if (!domFishList || domFishList.length === 0) {
                console.log('[LF Prob] DOM 抓取失败：未找到探查鱼群卡片 (.region-fish-card)');
            } else {
                // 构建鱼名 → fish_id 映射（core_catalog 中 name 为中文）
                var nameToId = {};
                for (var key in coreData.fish) {
                    var cdFish = coreData.fish[key];
                    if (cdFish && cdFish.name && cdFish.id) nameToId[cdFish.name] = cdFish.id;
                }
                scoutSignals = [];
                for (var di = 0; di < domFishList.length; di++) {
                    var df = domFishList[di];
                    var fid = nameToId[df.name];
                    if (fid) {
                        var weight = df.hasBaseProb ? (df.baseProb || 0.01) : 0.001;
                        scoutSignals.push({
                            fish_id: fid,
                            encounter_weight: weight,
                            base_ratio: df.baseProb || 0
                        });
                    }
                }
                if (scoutSignals.length > 0) {
                    scoutedFishCache = {
                        region_id: regionId,
                        voyage_id: null,
                        signals: scoutSignals,
                        timestamp: Date.now(),
                        _source: 'dom'
                    };
                    fishingMode = 'private_boat';
                    console.log('[LF Prob] DOM 抓取探查鱼群：', scoutSignals.length, '种鱼（后备方案）');
                } else {
                    scoutSignals = null;
                }
            }
        }

        if (scoutSignals) {
            // 自有船：用探查鱼群信号构建有效鱼池
            var totalWeight = 0;
            for (var si = 0; si < scoutSignals.length; si++) {
                totalWeight += (scoutSignals[si].encounter_weight ||
                               scoutSignals[si].base_ratio || 0);
            }
            effectiveFishPool = [];
            for (var sj = 0; sj < scoutSignals.length; sj++) {
                var sig = scoutSignals[sj];
                var rawWeight = sig.encounter_weight || sig.base_ratio || 0;
                var sm = 1.0;
                for (var pk = 0; pk < regionData.fish_pool.length; pk++) {
                    if (regionData.fish_pool[pk].fish_id === sig.fish_id) {
                        sm = regionData.fish_pool[pk].size_modifier || 1.0;
                        break;
                    }
                }
                effectiveFishPool.push({
                    fish_id: sig.fish_id,
                    base_ratio: totalWeight > 0 ? rawWeight / totalWeight : (1 / scoutSignals.length),
                    size_modifier: sm
                });
            }
            isPrivateBoat = true;
        } else {
            console.log('[LF Prob] 无探查数据，使用区域鱼池（', regionData.fish_pool.length, '种鱼）');
        }

        // 7. 逐鱼计算得分
        const results = [];
        for (const entry of effectiveFishPool) {
            const fish = fishById[entry.fish_id];
            if (!fish) continue;

            // 鱼口 cm：体长中位数 / 10（必须在 calcFishScore 之前计算）
            const sMin = fish.size_min_cm || 0;
            const sMax = fish.size_max_cm || 0;
            const sizeMedianCm = (sMin + sMax) / 2;
            const mouthCm = Math.round((sizeMedianCm / 10) * 10) / 10;

            const { score, factors } = calcFishScore(
                fish, entry.base_ratio, currentHour,
                equipWaterLayer, equipBaitType, fishActivityFactor, spotOffshore,
                equipBaitSize, mouthCm, equipHookSize, equipMethod,
                fishOffshoreNormMap[fish.id]
            );

            results.push({
                fish: fish,
                base_ratio: entry.base_ratio,
                size_modifier: entry.size_modifier || 1.0,
                score: score,
                factors: factors,
                mouth_cm: mouthCm,
            });
        }

        // 按得分降序排序
        results.sort((a, b) => b.score - a.score);

        // 归一化：所有鱼得分除以总分，得到真实上鱼概率（总和=100%）
        const totalScore = results.reduce((sum, r) => sum + r.score, 0);
        for (const r of results) {
            r.probability = totalScore > 0 ? r.score / totalScore : 0;
        }

        return {
            results: results,
            regionName: regionName,
            regionId: regionId,
            spotName: spotName,
            isPrivateBoat: isPrivateBoat,
            scoutedFishCount: isPrivateBoat ? results.length : null,
            analysis: {
                currentHour: currentHour,
                weatherPreset: weatherPresetName,
                weatherRain: rainVal,
                fishActivityFactor: fishActivityFactor,
                equipWaterLayer: equipWaterLayer,
                equipBaitType: equipBaitType,
                equipBaitSize: equipBaitSize,
                equipHookSize: equipHookSize,
                equipMethod: equipMethod,
                hasEquipment: !!equipCache,
            },
        };
    }

    // ============================================================
    //  面板 UI
    // ============================================================

    let panelEl = null;
    let panelVisible = false;

    function showPanel() {
        if (panelEl) panelEl.classList.add('visible');
        panelVisible = true;
        updateFabText();
    }
    function hidePanel() {
        if (panelEl) panelEl.classList.remove('visible');
        panelVisible = false;
        updateFabText();
    }

    /** 最近一次成功渲染的数据（用于其他页面展示） */
    let lastRenderData = null;

    /** 创建或获取面板 DOM */
    function getOrCreatePanel() {
        if (panelEl) return panelEl;

        panelEl = document.createElement('div');
        panelEl.id = 'lf-prob-panel';
        panelEl.innerHTML = `
            <style>
                #lf-prob-panel {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    width: 480px;
                    max-height: 70vh;
                    background: #e8f4fd;
                    border: 1px solid #b0cfe0;
                    border-radius: 8px;
                    color: #3a4a5a;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    font-size: 12px;
                    z-index: 99999;
                    box-shadow: 0 4px 24px rgba(0,0,0,0.15);
                    display: none;
                    flex-direction: column;
                    user-select: none;
                }
                #lf-prob-panel.visible { display: flex; }
                #lf-prob-panel.hidden { display: none; }
                .lf-panel-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 8px 12px;
                    background: #c8e3f7;
                    border-bottom: 1px solid #a8c8dc;
                    border-radius: 8px 8px 0 0;
                    cursor: move;
                }
                .lf-panel-title {
                    font-weight: 600;
                    font-size: 13px;
                    color: #1a3a5c;
                }
                .lf-panel-close {
                    cursor: pointer;
                    color: #78909c;
                    font-size: 16px;
                    padding: 0 4px;
                    line-height: 1;
                    transition: color 0.2s;
                }
                .lf-panel-close:hover { color: #f44; }
                .lf-panel-refresh {
                    cursor: pointer;
                    color: #78909c;
                    font-size: 15px;
                    padding: 0 6px;
                    line-height: 1;
                    transition: color 0.2s;
                }
                .lf-panel-refresh:hover { color: #1976d2; }
                .lf-panel-help {
                    cursor: pointer;
                    color: #78909c;
                    font-size: 15px;
                    padding: 0 6px;
                    line-height: 1;
                    transition: color 0.2s;
                }
                .lf-panel-help:hover { color: #f9a825; }
                .lf-help-guide {
                    display: none;
                    margin: 4px 0;
                    padding: 6px 8px;
                    background: #dce9f2;
                    border: 1px solid #b0d4ec;
                    border-radius: 4px;
                    font-size: 10px;
                    line-height: 1.6;
                    color: #607d8b;
                }
                .lf-help-guide.show { display: block; }
                .lf-help-guide b { color: #1565c0; }
                .lf-panel-body {
                    overflow-y: auto;
                    padding: 6px;
                    flex: 1;
                    min-height: 100px;
                }
                .lf-panel-body::-webkit-scrollbar { width: 4px; }
                .lf-panel-body::-webkit-scrollbar-thumb { background: #90a4ae; border-radius: 2px; }
                .lf-summary-row {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 3px 10px;
                    padding: 3px 6px;
                    margin-bottom: 4px;
                    background: #d6edfc;
                    border-radius: 4px;
                    font-size: 10px;
                }
                .lf-summary-row span { color: #5a6c7d; }
                .lf-summary-row strong { color: #1976d2; }
                .lf-fish-card {
                    background: #f0f7fc;
                    border: 1px solid #c8dce8;
                    border-radius: 4px;
                    padding: 4px 5px;
                    margin-bottom: 2px;
                    transition: background 0.15s;
                }
                .lf-fish-card:hover { background: #dce9f2; }
                .lf-fish-card.rank-1 { border-left: 3px solid #ffd700; }
                .lf-fish-card.rank-2 { border-left: 3px solid #c0c0c0; }
                .lf-fish-card.rank-3 { border-left: 3px solid #cd7f32; }
                .lf-fish-header {
                    display: flex;
                    align-items: baseline;
                    gap: 4px;
                    margin-bottom: 2px;
                }
                .lf-fish-rank {
                    font-weight: 700;
                    font-size: 12px;
                    color: #b8860b;
                    min-width: 14px;
                }
                .lf-fish-name {
                    font-weight: 600;
                    font-size: 11px;
                    color: #1a3a5c;
                }
                .lf-fish-score {
                    margin-left: auto;
                    font-weight: 700;
                    font-size: 11px;
                    color: #1565c0;
                }
                .lf-fish-details {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 1px 10px;
                    font-size: 10px;
                    color: #78909c;
                }
                .lf-fish-details span { color: #546e7a; }
                .lf-factors {
                    display: flex;
                    gap: 4px;
                    margin-top: 2px;
                    font-size: 9px;
                }
                .lf-factor {
                    padding: 1px 3px;
                    border-radius: 2px;
                    background: #e3f2fd;
                    border: 1px solid #c5dae8;
                }
                .lf-factor.high { border-color: #43a047; color: #2e7d32; }
                .lf-factor.mid  { border-color: #ef6c00; color: #e65100; }
                .lf-factor.low  { border-color: #e53935; color: #c62828; }
                .lf-empty {
                    text-align: center;
                    padding: 20px;
                    color: #90a4ae;
                    font-size: 12px;
                }
                #lf-prob-fab {
                    position: fixed;
                    bottom: 80px;
                    right: 20px;
                    width: 44px;
                    height: 44px;
                    border-radius: 50%;
                    background: #e3f2fd;
                    border: 2px solid #1976d2;
                    color: #1976d2;
                    font-size: 12px;
                    font-weight: bold;
                    cursor: pointer;
                    z-index: 99998;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 2px 12px rgba(25,118,210,0.3);
                    transition: transform 0.2s, box-shadow 0.2s;
                    user-select: none;
                }
                #lf-prob-fab:hover {
                    transform: scale(1.1);
                    box-shadow: 0 4px 20px rgba(25,118,210,0.5);
                }
                /* ===== 手机浏览器适配 (≤768px) ===== */
                @media (max-width: 768px) {
                    #lf-prob-panel {
                        width: 100vw;
                        max-height: 55vh;
                        bottom: 0;
                        right: 0;
                        left: 0;
                        border-radius: 12px 12px 0 0;
                        font-size: 13px;
                    }
                    #lf-prob-panel.hidden { display: none; }
                    .lf-panel-header {
                        padding: 10px 14px;
                        border-radius: 12px 12px 0 0;
                    }
                    .lf-panel-title { font-size: 14px; }
                    .lf-panel-close,
                    .lf-panel-refresh,
                    .lf-panel-help {
                        font-size: 20px;
                        padding: 0 8px;
                        line-height: 1;
                    }
                    .lf-panel-body { padding: 8px; }
                    .lf-summary-row {
                        flex-direction: column;
                        gap: 2px 0;
                        font-size: 11px;
                        padding: 5px 8px;
                    }
                    .lf-fish-card { padding: 6px 8px; margin-bottom: 3px; }
                    .lf-fish-header { font-size: 13px; gap: 6px; }
                    .lf-fish-rank { font-size: 14px; min-width: 16px; }
                    .lf-fish-name { font-size: 13px; }
                    .lf-fish-score { font-size: 13px; }
                    .lf-fish-details {
                        flex-direction: column;
                        gap: 1px 0;
                        font-size: 11px;
                    }
                    .lf-factors {
                        flex-wrap: wrap;
                        gap: 3px;
                        font-size: 10px;
                    }
                    .lf-factor { padding: 2px 4px; }
                    #lf-prob-fab {
                        bottom: 16px;
                        right: 12px;
                        width: 48px;
                        height: 48px;
                        font-size: 14px;
                        border-radius: 50%;
                    }
                    .lf-help-guide { font-size: 11px; padding: 8px 10px; }
                    .lf-empty { font-size: 13px; padding: 16px; }
                }
                @media (max-width: 480px) {
                    .lf-factors { gap: 2px; }
                    .lf-factor { font-size: 9px; padding: 1px 3px; }
                }
            </style>
            <div class="lf-panel-header" id="lf-panel-drag-handle">
                <span class="lf-panel-title">上鱼概率 Top 5</span>
                <span class="lf-panel-refresh" id="lf-panel-refresh-btn" title="刷新数据">&#x21BB;</span>
                <span class="lf-panel-help" id="lf-panel-help-btn" title="使用说明">?</span>
                <span class="lf-panel-close" id="lf-panel-close-btn">&times;</span>
            </div>
            <div class="lf-panel-body" id="lf-panel-body">
                <div class="lf-empty">正在计算...</div>
            </div>
            <div class="lf-help-guide" id="lf-help-guide">
                <b>点击右下角 P% 按钮</b> 开关面板<br>
                <b>概率计算</b>：综合当前钓组、天气、时间、水层、偏好匹配度，推算出上鱼概率最高的 5 条鱼<br>
                <b>排序规则</b>：概率从高到低排列，金/银/铜左边条分别标识前 3 名<br>
                <b>刷新 ↻</b>：重新获取装备和钓场配置，计算最新概率<br>
                <b>面板可拖拽</b>：按住标题栏拖动到任意位置
            </div>
        `;

        document.body.appendChild(panelEl);

        // 关闭按钮
        document.getElementById('lf-panel-close-btn').addEventListener('click', () => {
            hidePanel();
        });

        // 刷新按钮
        document.getElementById('lf-panel-refresh-btn').addEventListener('click', () => {
            refreshPanel();
        });

        // 帮助按钮
        document.getElementById('lf-panel-help-btn').addEventListener('click', () => {
            document.getElementById('lf-help-guide').classList.toggle('show');
        });

        // 拖拽功能
        enableDrag(panelEl, document.getElementById('lf-panel-drag-handle'));

        return panelEl;
    }

    /** 面板拖拽（支持鼠标+触摸） */
    function enableDrag(panel, handle) {
        let offsetX = 0, offsetY = 0, startX = 0, startY = 0;
        let dragging = false;

        function getClientXY(e) {
            if (e.touches && e.touches.length > 0) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            if (e.changedTouches && e.changedTouches.length > 0) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
            return { x: e.clientX, y: e.clientY };
        }

        function onStart(e) {
            var isTouch = e.type === 'touchstart';
            // 触摸时如果面板由 media query 强制 left:0,right:0 则不拖拽
            if (isTouch && window.innerWidth <= 768) {
                var cs = getComputedStyle(panel);
                if (cs.left === '0px') return; // 底部停靠模式，不拖拽
            }
            e.preventDefault();
            dragging = true;
            var xy = getClientXY(e);
            startX = xy.x;
            startY = xy.y;
            var rect = panel.getBoundingClientRect();
            offsetX = startX - rect.left;
            offsetY = startY - rect.top;
            panel.style.transition = 'none';
        }

        function onMove(e) {
            if (!dragging) return;
            e.preventDefault();
            var xy = getClientXY(e);
            var x = xy.x - offsetX;
            var y = xy.y - offsetY;
            var maxX = window.innerWidth - panel.offsetWidth;
            var maxY = window.innerHeight - panel.offsetHeight;
            panel.style.left = clamp(x, 0, maxX) + 'px';
            panel.style.top = clamp(y, 0, maxY) + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        }

        function onEnd() {
            if (dragging) {
                dragging = false;
                panel.style.transition = '';
            }
        }

        handle.addEventListener('mousedown', onStart);
        handle.addEventListener('touchstart', onStart, { passive: false });
        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('mouseup', onEnd);
        document.addEventListener('touchend', onEnd);
    }

    /** FAB 按钮 */
    let fabEl = null;

    /** 移动端（≤768px）重置面板内联定位，让 media query 生效 */
    function resetPanelMobilePosition() {
        if (!panelEl || window.innerWidth > 768) return;
        panelEl.style.left = '';
        panelEl.style.top = '';
        panelEl.style.right = '';
        panelEl.style.bottom = '';
    }

    function updateFabText() {
        if (!fabEl) return;
        fabEl.textContent = panelVisible ? '\u00D7' : 'P%';
    }

    function createFabButton() {
        if (fabEl) return;
        fabEl = document.createElement('div');
        fabEl.id = 'lf-prob-fab';
        fabEl.title = '上鱼概率计算器';
        fabEl.textContent = 'P%';
        document.body.appendChild(fabEl);

        fabEl.addEventListener('click', () => {
            if (panelVisible) {
                hidePanel();
            } else {
                const panel = getOrCreatePanel();
                resetPanelMobilePosition();
                showPanel();
                if (isFishingPage()) {
                    runFishingPage();
                } else if (lastRenderData) {
                    renderPanel(lastRenderData);
                } else {
                    document.getElementById('lf-panel-body').innerHTML =
                        '<div class="lf-empty">请先进入钓鱼页面获取数据</div>';
                }
            }
        });
    }

    /** 刷新面板：重新获取装备 + 重算概率 */
    function refreshPanel() {
        if (isEquipmentPage()) {
            const equipData = extractEquipmentFromPage();
            if (equipData && equipData.equipment && equipData.equipment.length > 0) {
                saveEquipmentCache(equipData);
                console.log('[LF Prob] 手动刷新：装备配置已更新');
            }
        }
        if (isFishingPage()) {
            runFishingPage();
        } else if (lastRenderData && panelVisible) {
            // 非钓鱼页但有缓存数据，重新渲染
            renderPanel(lastRenderData);
        }
    }

    /** 格式化水层中文 */
    function formatWaterLayer(layer) {
        const map = { surface: '表层', mid: '中层', bottom: '底层', deep: '深层' };
        return map[layer] || layer || '?';
    }

    /** 格式化开口时段 */
    function formatBiteHours(hours) {
        if (!hours || hours.length === 0) return '--';
        // 排序后合并连续区间
        const sorted = [...hours].sort((a, b) => a - b);
        const ranges = [];
        let start = sorted[0], end = sorted[0];
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] === end + 1) {
                end = sorted[i];
            } else {
                ranges.push(start === end ? `${start}` : `${start}-${end}`);
                start = sorted[i];
                end = sorted[i];
            }
        }
        ranges.push(start === end ? `${start}` : `${start}-${end}`);
        return ranges.join(', ') + '时';
    }

    /** 格式化饵型中文（单个类型，非鱼种偏好） */
    function formatBaitType(type) {
        if (!type) return '?';
        const baitMap = {
            corn: '玉米', soft_bait: '软饵', worm: '蚯蚓', small_fish: '小鱼',
            insect: '昆虫', snail: '螺', algae_paste: '藻饵', grass: '草',
            spoon: '亮片', minnow: '米诺', topwater: '水面系', jig: '铅头钩',
            crank: '胖子', worm_lure: '软虫',
        };
        return baitMap[type] || type;
    }

    /** 格式化饵型中文 */
    function formatBaitPref(fish) {
        const baitMap = {
            corn: '玉米', soft_bait: '软饵', worm: '蚯蚓', small_fish: '小鱼',
            insect: '昆虫', snail: '螺', algae_paste: '藻饵', grass: '草',
            spoon: '亮片', minnow: '米诺', topwater: '水面系', jig: '铅头钩',
            crank: '胖子', worm_lure: '软虫',
        };
        const parts = [];
        if (fish.bait_preference) parts.push(baitMap[fish.bait_preference] || fish.bait_preference);
        if (fish.lure_preference) parts.push(baitMap[fish.lure_preference] || fish.lure_preference);
        return parts.length > 0 ? parts.join('/') : '--';
    }

    /** 因子级别判定 */
    function factorLevel(v) {
        if (v >= 0.8) return 'high';
        if (v >= 0.5) return 'mid';
        return 'low';
    }

    /** 渲染面板内容（更新数据但不自动展开面板） */
    function renderPanel(data) {
        getOrCreatePanel();
        const body = document.getElementById('lf-panel-body');
        if (!body) return;

        if (!data || !data.results || data.results.length === 0) {
            body.innerHTML = '<div class="lf-empty">暂无数据，请进入钓鱼区域后再试</div>';
            lastRenderData = data;
            return;
        }

        const top5 = data.results.slice(0, 5);
        const analysis = data.analysis;

        let html = '';

        // 摘要行
        html += '<div class="lf-summary-row">';
        html += `<span>区域: <strong>${escapeHtml(data.regionName)}</strong></span>`;
        if (data.isPrivateBoat) {
            html += `<span style="color:#e65100;">🚢 <strong>自有船探查</strong> (${data.scoutedFishCount}种)</span>`;
        }
        html += `<span>时间: <strong>${analysis.currentHour}:00</strong></span>`;
        html += `<span>天气: <strong>${escapeHtml(analysis.weatherPreset)}${analysis.weatherRain != null ? ' 雨' + Number(analysis.weatherRain).toFixed(1) : ''}</strong></span>`;
        if (analysis.hasEquipment) {
            html += `<span>竿层: <strong>${formatWaterLayer(analysis.equipWaterLayer)}</strong></span>`;
            html += `<span>饵: <strong>${formatBaitType(analysis.equipBaitType)}${analysis.equipBaitSize != null ? ' #' + Number(analysis.equipBaitSize).toFixed(1) : ''}</strong></span>`;
            html += '<span>钩: <strong>#' + Number(analysis.equipHookSize).toFixed(1) + '</strong></span>';
        } else {
            html += '<span style="color:#f90;">⚠ 无装备缓存，取中性值</span>';
        }
        html += '</div>';

        if (data.results.length === 0) {
            html += '<div class="lf-empty">当前区域无鱼种数据</div>';
        } else {
            for (let i = 0; i < top5.length; i++) {
                const r = top5[i];
                const f = r.fish;
                const rankClass = i < 3 ? ` rank-${i + 1}` : '';

                html += `<div class="lf-fish-card${rankClass}">`;

                // 头部：排名、鱼名、得分
                html += '<div class="lf-fish-header">';
                html += `<span class="lf-fish-rank">#${i + 1}</span>`;
                html += `<span class="lf-fish-name">${escapeHtml(f.name || f.id)}</span>`;
                html += `<span class="lf-fish-score">${(r.probability * 100).toFixed(2)}%</span>`;
                html += '</div>';

                // 详细信息
                html += '<div class="lf-fish-details">';
                html += `<div>水层: <span>${formatWaterLayer(f.water_layer)}</span></div>`;
                html += `<div>鱼口: <span>${r.mouth_cm} cm</span></div>`;
                html += `<div>体长: <span>${f.size_min_cm || '?'} ~ ${f.size_max_cm || '?'} cm</span></div>`;
                html += `<div>体重: <span>${f.weight_min_kg || '?'} ~ ${f.weight_max_kg || '?'} kg</span></div>`;
                html += `<div>偏好饵: <span>${formatBaitPref(f)}</span></div>`;
                html += `<div>开口: <span>${formatBiteHours(f.bite_hours)}</span></div>`;
                html += '</div>';

                // 匹配因子
                const ft = r.factors;
                html += '<div class="lf-factors">';
                html += `<span class="lf-factor ${factorLevel(ft.time)}">时间 ${(ft.time * 100).toFixed(0)}%</span>`;
                html += `<span class="lf-factor ${factorLevel(ft.layer)}">水层 ${(ft.layer * 100).toFixed(0)}%</span>`;
                html += `<span class="lf-factor ${factorLevel(ft.size)}">饵号 ${(ft.size * 100).toFixed(0)}%</span>`;
                html += `<span class="lf-factor ${factorLevel(ft.hook)}">钩号 ${(ft.hook * 100).toFixed(0)}%</span>`;
                html += `<span class="lf-factor ${factorLevel(ft.screen)}">综合 ${(ft.screen * 100).toFixed(0)}%</span>`;
                html += `<span class="lf-factor ${factorLevel(ft.offshore)}">离岸 ${(ft.offshore * 100).toFixed(0)}%</span>`;
                html += `<span class="lf-factor ${factorLevel(ft.base_ratio)}">基础 ${(ft.base_ratio * 100).toFixed(1)}%</span>`;
                html += '</div>';

                html += '</div>';
            }

            // 如果多于5条，显示省略提示
            if (data.results.length > 5) {
                html += `<div class="lf-empty">共 ${data.results.length} 种鱼，仅显示前5名</div>`;
            }
        }

        body.innerHTML = html;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ============================================================
    //  主流程
    // ============================================================

    /** 钓鱼页：计算并渲染 */
    function runFishingPage() {
        var data = calculateProbabilities();
        if (data && data.error) {
            var panel = getOrCreatePanel();
            panel.classList.remove('hidden');
            panelVisible = true;
            var errList = data.errors.map(function(e) { return '<li>' + escapeHtml(e) + '</li>'; }).join('');
            document.getElementById('lf-panel-body').innerHTML =
                '<div class="lf-empty">数据获取失败，缺少以下数据：<ul style="text-align:left;margin:8px 0;padding-left:20px;">' + errList + '</ul></div>';
            return;
        }
        if (!data) {
            var panel2 = getOrCreatePanel();
            panel2.classList.remove('hidden');
            panelVisible = true;
            document.getElementById('lf-panel-body').innerHTML =
                '<div class="lf-empty">无法获取完整数据，请确认已登录并进入钓鱼区域</div>';
            return;
        }
        renderPanel(data);
        lastRenderData = data;
    }

    /** 装备页：自动抓取并缓存 */
    function runEquipmentPage() {
        const equipData = extractEquipmentFromPage();
        if (equipData && equipData.equipment && equipData.equipment.length > 0) {
            saveEquipmentCache(equipData);
            console.log('[LF Prob] 装备配置已缓存:', equipData);
        }
    }

    /** 等待 DOM 元素出现（MutationObserver + 超时兜底） */
    function waitForElement(selector, timeout) {
        timeout = timeout || 15000;
        return new Promise(function (resolve) {
            const el = document.querySelector(selector);
            if (el) { resolve(el); return; }

            const observer = new MutationObserver(function () {
                const el = document.querySelector(selector);
                if (el) { observer.disconnect(); resolve(el); }
            });
            observer.observe(document.body, { childList: true, subtree: true });

            setTimeout(function () { observer.disconnect(); resolve(null); }, timeout);
        });
    }

    /** 主入口 */
    async function main() {
        hookWebSocket();
        createFabButton();

        // 在钓鱼页后台拉取数据，但不自动弹出面板
        if (isFishingPage()) {
            await waitForElement('.fishing-overview-item', 15000);
            setTimeout(runFishingPage, 500);
            return;
        }

        if (isEquipmentPage()) {
            await waitForElement('.loadout-slot', 15000);
            setTimeout(runEquipmentPage, 500);
            return;
        }
    }

    // ============================================================
    //  URL 变化监听（SPA hash 路由）
    // ============================================================

    let lastUrl = window.location.href;

    async function onHashChange() {
        const newUrl = window.location.href;
        if (newUrl === lastUrl) return;
        lastUrl = newUrl;

        if (isEquipmentPage()) {
            await waitForElement('.loadout-slot', 15000);
            setTimeout(runEquipmentPage, 500);
        } else if (isFishingPage()) {
            await waitForElement('.fishing-overview-item', 15000);
            setTimeout(runFishingPage, 500);
        }
    }

    window.addEventListener('hashchange', onHashChange, false);

    // ============================================================
    //  启动
    // ============================================================

    // 等待页面基本就绪后执行
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(main, 500);
    } else {
        window.addEventListener('DOMContentLoaded', () => setTimeout(main, 500));
    }

    // 额外：监听 pushState / replaceState（某些 SPA 框架用 History API）
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function () {
        origPush.apply(this, arguments);
        setTimeout(onHashChange, 300);
    };
    history.replaceState = function () {
        origReplace.apply(this, arguments);
        setTimeout(onHashChange, 300);
    };

})();
