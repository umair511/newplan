"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMetallizedFilm = isMetallizedFilm;
exports.isMetallizerOrder = isMetallizerOrder;
exports.generateMSLWidthCombinations = generateMSLWidthCombinations;
exports.generateJumboRollRequirements = generateJumboRollRequirements;
exports.generateMetallizerPlans = generateMetallizerPlans;
const metallizerMasterData_1 = require("./metallizerMasterData");
const filmCompatibilityMaster_1 = require("./filmCompatibilityMaster");
/**
 * HARD BUSINESS RULE — METALLIZED FILM IDENTIFICATION
 * A film order shall be treated as a METALLIZED FILM order ONLY when its Film Code contains "MZ".
 * Examples:
 * - MZ10S-18 -> Metallized Film
 * - MZ18 -> Metallized Film
 * - MZ20 -> Metallized Film
 * - MZ10S-20 -> Metallized Film
 * - MZ10MB-15 -> Metallized Film
 *
 * Any Film Code that does NOT contain "MZ" must NOT be treated as a Metallized Film order.
 * This classification is strictly enforced at the BACKEND / optimizer level.
 */
function isMetallizedFilm(filmCode) {
    if (!filmCode || typeof filmCode !== 'string')
        return false;
    return filmCode.toUpperCase().includes('MZ');
}
/**
 * Binary search lower bound: first index where arr[idx] >= target
 */
function binarySearchLower(arr, target, low, high) {
    let l = low;
    let r = high;
    let ans = high + 1;
    while (l <= r) {
        const mid = (l + r) >> 1;
        if (arr[mid] >= target) {
            ans = mid;
            r = mid - 1;
        }
        else {
            l = mid + 1;
        }
    }
    return ans;
}
/**
 * Binary search upper bound: last index where arr[idx] <= target
 */
function binarySearchUpper(arr, target, low, high) {
    let l = low;
    let r = high;
    let ans = low - 1;
    while (l <= r) {
        const mid = (l + r) >> 1;
        if (arr[mid] <= target) {
            ans = mid;
            l = mid + 1;
        }
        else {
            r = mid - 1;
        }
    }
    return ans;
}
/**
 * Check if a VA05 order is a metallized film order based strictly on whether its film code contains "MZ"
 */
function isMetallizerOrder(order) {
    if (!order)
        return false;
    return isMetallizedFilm(order.film);
}
/**
 * Generate candidate combinations of finished slit widths (1 to 6 UPS) from available orders.
 * MSL slitter has 6 UPS physically available (Arms 1-3 on Side A, Arms 4-6 on Side B).
 * All 1 to 6 UPS are available at all times wherever deckle is maximally adjusted.
 * Supports:
 * - Single width repeats (1-6 UPS)
 * - Mixed widths (e.g. 1120 + 1130 + 1140 mm)
 * - Mixed compatible lengths (e.g. 10,000 m + 20,000 m)
 */
function generateMSLWidthCombinations(uniqueWidths, maxUps = 6, maxTotalWidth = 3650, minTrim = 20) {
    const sortedWidths = uniqueWidths.slice().sort((a, b) => a - b);
    const combinations = [];
    const maxMslUps = Math.min(6, maxUps);
    // Helper recursive generator for up to maxMslUps (strictly ascending index guarantees canonical unique combos)
    function explore(currentWidths, startIndex, currentSum) {
        if (currentWidths.length > 0) {
            if (currentSum + minTrim <= maxTotalWidth) {
                combinations.push({
                    widths: currentWidths.slice(),
                    ups: currentWidths.length,
                    sumWidth: currentSum,
                });
            }
        }
        if (currentWidths.length >= maxMslUps)
            return;
        for (let i = startIndex; i < sortedWidths.length; i++) {
            const w = sortedWidths[i];
            if (currentSum + w + minTrim > maxTotalWidth)
                break;
            currentWidths.push(w);
            explore(currentWidths, i, currentSum + w);
            currentWidths.pop();
        }
    }
    explore([], 0, 0);
    return combinations;
}
/**
 * Internal single-pool demand optimizer
 * Solves jumbo requirements for an arbitrary pool of orders (can be a single film or a combined compatible group).
 * - Allows a portfolio of different jumbo widths in the solution
 * - Evaluates multi-width & multi-length MSL patterns
 * - Performs PS01 feasibility handshake (3-UPS preferred, 4-UPS fallback, 5/6-UPS forbidden)
 * - Rejects RED candidates immediately (0 KG, 0 rolls)
 * - Strictly enforces individual +3% order ceiling (Allocated <= Balance * 1.03)
 * - Maximizes practical jumbo length (e.g. 20,000m, 39,000m)
 */
function optimizeDemandPool(groupOrders, rawSettings, groupLabel, startReqCounter = 1) {
    const settings = { ...metallizerMasterData_1.DEFAULT_METALLIZER_SETTINGS, ...rawSettings };
    if (groupOrders.length === 0) {
        return {
            requirements: [],
            score: 0,
            evaluation: {
                strategy: 'SEPARATE',
                film_group: groupLabel,
                films_included: [],
                requirements: [],
                total_rolls: 0,
                unique_jumbo_widths: [],
                total_planned_kg: 0,
                total_trim_kg: 0,
                average_waste_percent: 0,
                ps01_3ups_count: 0,
                ps01_4ups_count: 0,
                max_jumbo_length_m: 0,
                is_fully_feasible: true,
                score: 0,
                reason: 'No open orders',
            },
        };
    }
    const filmsInGroup = Array.from(new Set(groupOrders.map(o => o.film)));
    const thickness = groupOrders[0].thickness_micron || settings.thickness_micron_default;
    const density = settings.density || 0.91;
    const maxMslUps = Math.min(6, settings.max_planning_ups || 6);
    function computeLengthFamilies(lengths, filmThickness, maxDiameterMm, configuredMultiples) {
        const sorted = Array.from(new Set(lengths)).sort((a, b) => a - b);
        const visited = new Set();
        const families = [];
        for (const len of sorted) {
            if (visited.has(len))
                continue;
            const famLens = [len];
            visited.add(len);
            // Find compatible lengths (exact 1:2, 2:1, 1:3, 3:1, 1:4, 4:1 or integer multiple/divisor relationships)
            for (const other of sorted) {
                if (!visited.has(other)) {
                    const isCompatible = famLens.some(l => other === l * 2 || l === other * 2 || other === l * 3 || l === other * 3 || other === l * 4 || l === other * 4 || (l % other === 0) || (other % l === 0));
                    if (isCompatible) {
                        famLens.push(other);
                        visited.add(other);
                    }
                }
            }
            famLens.sort((a, b) => a - b);
            const baseLengthM = famLens[0];
            const packLengthM = famLens[famLens.length - 1]; // e.g. 18,700m for [9350, 18700], or 20,000m for [10000, 20000]
            const validMultiples = [];
            const maxK = Math.max(...configuredMultiples, 6);
            for (let k = 1; k <= maxK; k++) {
                const jumboLen = packLengthM * k;
                const dia = (0, metallizerMasterData_1.calculateJumboDiameter)(filmThickness, jumboLen);
                if (dia <= maxDiameterMm) {
                    validMultiples.push({ multiple: k, length_m: jumboLen, diameter_mm: dia });
                }
            }
            if (validMultiples.length === 0) {
                validMultiples.push({
                    multiple: 1,
                    length_m: packLengthM,
                    diameter_mm: (0, metallizerMasterData_1.calculateJumboDiameter)(filmThickness, packLengthM),
                });
            }
            // Sort descending so the maximum possible jumbo length (near 1250mm diameter) is prioritized first
            validMultiples.sort((a, b) => b.length_m - a.length_m);
            families.push({
                familyId: famLens.join('_'),
                lengths: famLens,
                baseLengthM,
                packLengthM,
                validMultiples,
            });
        }
        return families;
    }
    const lengthFamilies = computeLengthFamilies(groupOrders.map(o => o.length_m || 19500), thickness, settings.max_jumbo_diameter_mm, settings.package_multiples);
    const demandSlots = [];
    const slotMap = new Map();
    for (const o of groupOrders) {
        const len = o.length_m || 19500;
        const fam = lengthFamilies.find(f => f.lengths.includes(len)) || lengthFamilies[0];
        const key = `${o.film}__${o.width_mm}__${len}`;
        if (!slotMap.has(key)) {
            slotMap.set(key, demandSlots.length);
            demandSlots.push({ film: o.film, width_mm: o.width_mm, length_m: len, familyId: fam.familyId, key });
        }
    }
    const numDemandSlots = demandSlots.length;
    const orderTrackers = groupOrders.map(o => {
        const len = o.length_m || 19500;
        const fam = lengthFamilies.find(f => f.lengths.includes(len)) || lengthFamilies[0];
        const mult = Math.max(1, Math.round(len / fam.baseLengthM));
        const slotIdx = slotMap.get(`${o.film}__${o.width_mm}__${len}`);
        return {
            order: o,
            pkgLength: len,
            lengthMultiple: mult,
            slotIdx,
            initialBalanceKg: o.remaining_qty,
            maxAllowedKg: Number((o.remaining_qty * 1.03).toFixed(2)),
            allocatedKg: 0,
            remainingKg: o.remaining_qty,
            allocatedReels: 0,
            status: 'PENDING',
        };
    });
    // Side-effect free candidate generator: generates MS1 candidates independently per film & length family
    function generateCandidatePool(activeTrackers) {
        const activeFilms = Array.from(new Set(activeTrackers.map(t => t.order.film)));
        if (activeFilms.length === 0)
            return [];
        const candidateTrims = [20, 30];
        const pool = [];
        const seen = new Map();
        for (const filmCode of activeFilms) {
            for (const fam of lengthFamilies) {
                const filmFamTrackers = activeTrackers.filter(t => t.order.film === filmCode && fam.lengths.includes(t.pkgLength));
                if (filmFamTrackers.length === 0)
                    continue;
                const filmWidths = Array.from(new Set(filmFamTrackers.map(t => t.order.width_mm))).sort((a, b) => a - b);
                if (filmWidths.length === 0)
                    continue;
                const uniqueCombos = generateMSLWidthCombinations(filmWidths, maxMslUps, settings.max_jumbo_width_mm, 20);
                for (const combo of uniqueCombos) {
                    // Generate valid length assignments for each cut in combo
                    // Each cut width w_i can only take lengths that exist in demand for that width
                    const possibleCutLengths = combo.widths.map(w => {
                        const validLengths = fam.lengths.filter(L => slotMap.has(`${filmCode}__${w}__${L}`));
                        return validLengths.length > 0 ? validLengths : [fam.packLengthM];
                    });
                    // Generate Cartesian product of length assignments
                    const lengthAssignments = [];
                    const buildAssignments = (idx, current) => {
                        if (idx === combo.widths.length) {
                            lengthAssignments.push([...current]);
                            return;
                        }
                        for (const len of possibleCutLengths[idx]) {
                            current.push(len);
                            buildAssignments(idx + 1, current);
                            current.pop();
                        }
                    };
                    buildAssignments(0, []);
                    // Deduplicate symmetric length assignments for identical widths
                    const uniqueAssignments = [];
                    const seenAssign = new Set();
                    for (const assign of lengthAssignments) {
                        const key = combo.widths.map((w, idx) => `${w}:${assign[idx]}`).sort().join('|');
                        if (!seenAssign.has(key)) {
                            seenAssign.add(key);
                            uniqueAssignments.push(assign);
                        }
                    }
                    for (const assign of uniqueAssignments) {
                        const uniqueLens = Array.from(new Set(assign));
                        // Physical Duplex Slitter Constraint:
                        // 1. Cannot have more than 2 distinct lengths in a single slitter run
                        if (uniqueLens.length > 2)
                            continue;
                        // 2. If 2 distinct lengths exist:
                        if (uniqueLens.length === 2) {
                            const lenA = uniqueLens[0];
                            const lenB = uniqueLens[1];
                            const countA = assign.filter(L => L === lenA).length;
                            const countB = assign.filter(L => L === lenB).length;
                            // MSL Slitter has 6 arms total: Side A (Arms 1-3, max 3) and Side B (Arms 4-6, max 3)
                            if (countA > 3 || countB > 3)
                                continue;
                            // Strict Duplex Arm Balance Rule: difference between Side A and Side B arms cannot exceed ±1 (|countA - countB| <= 1)
                            // (e.g. 1 vs 1, 1 vs 2, 2 vs 2, 2 vs 3, 3 vs 3 are feasible)
                            if (Math.abs(countA - countB) > 1)
                                continue;
                            // Dual length must be in exact 1:2 ratio
                            const minL = Math.min(lenA, lenB);
                            const maxL = Math.max(lenA, lenB);
                            if (maxL !== minL * 2)
                                continue;
                        }
                        for (const testTrim of candidateTrims) {
                            const derivedJumbo = combo.sumWidth + testTrim;
                            if (derivedJumbo < 1500 || derivedJumbo > settings.max_jumbo_width_mm)
                                continue;
                            for (const vm of fam.validMultiples) {
                                const cuts = new Array(numDemandSlots).fill(0);
                                const activeIndicesSet = new Set();
                                const cutsList = [];
                                for (let ci = 0; ci < combo.widths.length; ci++) {
                                    const cutW = combo.widths[ci];
                                    const cutL = assign[ci];
                                    const sIdx = slotMap.get(`${filmCode}__${cutW}__${cutL}`);
                                    const reelsPerJumbo = Math.max(1, Math.round(vm.length_m / cutL));
                                    const singleReelWeightKg = (0, metallizerMasterData_1.calculateJumboWeight)(cutW, thickness, density, cutL);
                                    if (sIdx !== undefined) {
                                        cuts[sIdx]++;
                                        activeIndicesSet.add(sIdx);
                                        cutsList.push({
                                            slotIdx: sIdx,
                                            film: filmCode,
                                            width_mm: cutW,
                                            length_m: cutL,
                                            reelsPerJumbo,
                                            singleReelWeightKg,
                                        });
                                    }
                                }
                                const activeIndices = Array.from(activeIndicesSet);
                                const cutsKey = cuts.join(',');
                                const key = `${filmCode}|${fam.familyId}|${derivedJumbo}|${cutsKey}|${vm.multiple}|${vm.length_m}`;
                                const existing = seen.get(key);
                                if (existing) {
                                    if (testTrim < existing.mslTrim) {
                                        existing.mslTrim = testTrim;
                                        existing.combo = combo;
                                        existing.cutsList = cutsList;
                                    }
                                    continue;
                                }
                                const singleWeight = (0, metallizerMasterData_1.calculateJumboWeight)(derivedJumbo, thickness, density, vm.length_m);
                                const cand = {
                                    id: `cand-${filmCode}-${key}`,
                                    film: filmCode,
                                    familyId: fam.familyId,
                                    combo,
                                    jumboWidth: derivedJumbo,
                                    mslTrim: testTrim,
                                    packageMultiple: vm.multiple,
                                    jumboLengthM: vm.length_m,
                                    jumboDiameterMm: vm.diameter_mm,
                                    singleJumboWeightKg: singleWeight,
                                    cutsList,
                                    cuts,
                                    activeIndices,
                                };
                                seen.set(key, cand);
                                pool.push(cand);
                            }
                        }
                    }
                }
            }
        }
        return pool;
    }
    const finalRequirements = [];
    let reqCounter = startReqCounter;
    let iteration = 0;
    const maxIterations = 100;
    // Precompute full candidate pool across films independently to eliminate combinatorial cross-film explosion
    const masterCandidatePool = generateCandidatePool(orderTrackers);
    // Main optimization loop: searches global 3-UPS / 4-UPS portfolios iteratively until demand is satisfied
    while (iteration < maxIterations) {
        iteration++;
        const activeTrackers = orderTrackers.filter(t => t.remainingKg > 0.01);
        if (activeTrackers.length === 0)
            break;
        const activeSlotsSet = new Set(activeTrackers.map(t => t.slotIdx));
        const candidatePool = masterCandidatePool.filter(c => c.activeIndices.every(s => activeSlotsSet.has(s)));
        if (candidatePool.length === 0)
            break;
        let bestWinningSet = null;
        let bestSetScore = -Infinity;
        // Two-Phase Search Engine:
        // Phase 1: Strict Full-Length First (Multipliers >= 2x, ~1200-1250mm OD). Any odd 1x remainder is ejected back to the pool.
        // Phase 2: If no full-length pack can be formed across all active balance orders, allow a single tail set (1x remainder relaxation).
        const runSearchPass = (allowTailMultiples) => {
            for (const fam of lengthFamilies) {
                const maxMultipleInFam = Math.max(...fam.validMultiples.map(v => v.multiple));
                for (const vm of fam.validMultiples) {
                    const isTail = maxMultipleInFam > 1 && vm.multiple === 1;
                    if (isTail && !allowTailMultiples)
                        continue;
                    if (!isTail && allowTailMultiples)
                        continue;
                    const candidatesForMult = candidatePool.filter(c => c.familyId === fam.familyId && c.packageMultiple === vm.multiple && c.jumboLengthM === vm.length_m);
                    if (candidatesForMult.length === 0)
                        continue;
                    // Precompute cuts capacity and weight per cut for active demand slots under this package multiple
                    const capacity = new Array(numDemandSlots).fill(0);
                    const weightPerCut = new Array(numDemandSlots).fill(0);
                    for (const tr of activeTrackers) {
                        if (tr.remainingKg <= 0.01)
                            continue;
                        const s = tr.slotIdx;
                        const spareKg = tr.maxAllowedKg - tr.allocatedKg;
                        const weightPerReel = (0, metallizerMasterData_1.calculateJumboWeight)(tr.order.width_mm, thickness, density, tr.pkgLength);
                        const reelsPerCut = Math.max(1, Math.round(vm.length_m / tr.pkgLength));
                        const weightForCut = weightPerReel * reelsPerCut;
                        const cutsAllowed = Math.floor((spareKg + 0.01) / weightForCut);
                        capacity[s] += Math.max(0, cutsAllowed);
                        if (weightPerCut[s] === 0)
                            weightPerCut[s] = weightForCut;
                    }
                    // Filter to viable candidates whose required cuts do not exceed current remaining capacity
                    const viableCandidates = candidatesForMult.filter(c => {
                        const cCuts = c.cuts;
                        for (let a = 0; a < c.activeIndices.length; a++) {
                            const s = c.activeIndices[a];
                            if (capacity[s] < cCuts[s])
                                return false;
                        }
                        return true;
                    });
                    if (viableCandidates.length === 0)
                        continue;
                    // Group viable candidates by width bucket for O(1) indexed lookup
                    const candidatesByWidth = new Map();
                    for (const c of viableCandidates) {
                        let list = candidatesByWidth.get(c.jumboWidth);
                        if (!list) {
                            list = [];
                            candidatesByWidth.set(c.jumboWidth, list);
                        }
                        list.push(c);
                    }
                    // Sort candidates within each width bucket by potential yield for optimal Branch-and-Bound pruning
                    for (const [width, list] of candidatesByWidth.entries()) {
                        list.sort((a, b) => {
                            let yieldA = 0;
                            let yieldB = 0;
                            for (let ai = 0; ai < a.activeIndices.length; ai++) {
                                const s = a.activeIndices[ai];
                                yieldA += a.cuts[s] * weightPerCut[s];
                            }
                            for (let bi = 0; bi < b.activeIndices.length; bi++) {
                                const s = b.activeIndices[bi];
                                yieldB += b.cuts[s] * weightPerCut[s];
                            }
                            return (b.packageMultiple - a.packageMultiple) || (b.jumboDiameterMm - a.jumboDiameterMm) || (yieldB - yieldA) || (a.mslTrim - b.mslTrim);
                        });
                        // Retain top 15 highest-yield candidates per width bucket
                        if (list.length > 15) {
                            candidatesByWidth.set(width, list.slice(0, 15));
                        }
                    }
                    // Bound candidate width buckets to top 96 highest-yield buckets
                    let widthEntriesList = Array.from(candidatesByWidth.entries());
                    if (widthEntriesList.length > 96) {
                        widthEntriesList.sort((a, b) => {
                            let yieldA = 0;
                            let yieldB = 0;
                            const cA = a[1][0];
                            const cB = b[1][0];
                            if (cA) {
                                for (let ai = 0; ai < cA.activeIndices.length; ai++) {
                                    yieldA += cA.cuts[cA.activeIndices[ai]] * weightPerCut[cA.activeIndices[ai]];
                                }
                            }
                            if (cB) {
                                for (let bi = 0; bi < cB.activeIndices.length; bi++) {
                                    yieldB += cB.cuts[cB.activeIndices[bi]] * weightPerCut[cB.activeIndices[bi]];
                                }
                            }
                            return yieldB - yieldA;
                        });
                        const topWidthsSet = new Set(widthEntriesList.slice(0, 96).map(e => e[0]));
                        for (const w of Array.from(candidatesByWidth.keys())) {
                            if (!topWidthsSet.has(w)) {
                                candidatesByWidth.delete(w);
                            }
                        }
                    }
                    const uniqueWidths = Array.from(candidatesByWidth.keys()).sort((a, b) => a - b);
                    const numUniqueWidths = uniqueWidths.length;
                    // 1. PRIORITY #1: PURE SINGLE-CANDIDATE 3-UPS & 4-UPS PACKS (High Volume Pure Runs with 0 Surplus)
                    const searchPurePacks = (minTrimAllowed, maxTrimAllowed) => {
                        for (const cand of viableCandidates) {
                            // Check 3-UPS Pure Pack (3 x candidate)
                            const totalWeb3 = cand.jumboWidth * 3;
                            const trim3 = 10400 - totalWeb3;
                            if (trim3 >= minTrimAllowed && trim3 <= maxTrimAllowed && trim3 >= 120 && trim3 <= 500) {
                                const status3 = (trim3 >= 140 && trim3 <= 250) ? 'GREEN' : 'YELLOW';
                                let maxCycles3 = Infinity;
                                let canForm3 = true;
                                let cyclePlannedKgPerRun3 = 0;
                                for (let a = 0; a < cand.activeIndices.length; a++) {
                                    const s = cand.activeIndices[a];
                                    const needed = cand.cuts[s] * 3;
                                    if (needed === 0)
                                        continue;
                                    const cap = capacity[s];
                                    if (cap < needed) {
                                        canForm3 = false;
                                        break;
                                    }
                                    const cycles = Math.floor(cap / needed);
                                    if (cycles < maxCycles3)
                                        maxCycles3 = cycles;
                                    cyclePlannedKgPerRun3 += weightPerCut[s] * needed;
                                }
                                if (canForm3 && maxCycles3 >= 1) {
                                    const repeatCycles = maxCycles3;
                                    const cyclePlannedKg = cyclePlannedKgPerRun3 * repeatCycles;
                                    const mslTrimKg = ((cand.mslTrim / cand.jumboWidth) * cand.singleJumboWeightKg * 3) * repeatCycles;
                                    const ps01TrimKgBase = (0, metallizerMasterData_1.calculateJumboWeight)(trim3, thickness, density, cand.jumboLengthM);
                                    const totalTrimKg = mslTrimKg + (ps01TrimKgBase * repeatCycles);
                                    let score = status3 === 'GREEN' ? 1000000 : 50000;
                                    score += cyclePlannedKg * 25;
                                    score += 50000; // Bonus for pure uniform pack (0 setup changes)
                                    score += Math.max(0, (500 - trim3) * 50); // Trim tightness bonus
                                    score += cand.packageMultiple * 50000; // Multiplier priority (2x, 3x full jumbo)
                                    score += (cand.jumboDiameterMm / 1250) * 100000; // Target diameter (~1250mm) bonus
                                    score += repeatCycles * 3000;
                                    const wastePct = totalTrimKg > 0 ? (totalTrimKg / (cyclePlannedKg + totalTrimKg)) * 100 : 0;
                                    score -= wastePct * 100;
                                    if (score > bestSetScore) {
                                        bestSetScore = score;
                                        bestWinningSet = {
                                            candidates: [cand, cand, cand],
                                            ps01Ups: 3,
                                            jumboWidths: [cand.jumboWidth, cand.jumboWidth, cand.jumboWidth],
                                            totalWeb: totalWeb3,
                                            ps01Trim: trim3,
                                            status: status3,
                                            repeatCycles,
                                            totalPlannedKg: cyclePlannedKg,
                                            totalTrimKg,
                                            score,
                                        };
                                    }
                                }
                            }
                            // Check 4-UPS Pure Pack (4 x candidate, for jumbo widths <= 2565mm)
                            const totalWeb4 = cand.jumboWidth * 4;
                            const trim4 = 10400 - totalWeb4;
                            if (trim4 >= minTrimAllowed && trim4 <= maxTrimAllowed && trim4 >= 120 && trim4 <= 500) {
                                const status4 = (trim4 >= 140 && trim4 <= 250) ? 'GREEN' : 'YELLOW';
                                let maxCycles4 = Infinity;
                                let canForm4 = true;
                                let cyclePlannedKgPerRun4 = 0;
                                for (let a = 0; a < cand.activeIndices.length; a++) {
                                    const s = cand.activeIndices[a];
                                    const needed = cand.cuts[s] * 4;
                                    if (needed === 0)
                                        continue;
                                    const cap = capacity[s];
                                    if (cap < needed) {
                                        canForm4 = false;
                                        break;
                                    }
                                    const cycles = Math.floor(cap / needed);
                                    if (cycles < maxCycles4)
                                        maxCycles4 = cycles;
                                    cyclePlannedKgPerRun4 += weightPerCut[s] * needed;
                                }
                                if (canForm4 && maxCycles4 >= 1) {
                                    const repeatCycles = maxCycles4;
                                    const cyclePlannedKg = cyclePlannedKgPerRun4 * repeatCycles;
                                    const mslTrimKg = ((cand.mslTrim / cand.jumboWidth) * cand.singleJumboWeightKg * 4) * repeatCycles;
                                    const ps01TrimKgBase = (0, metallizerMasterData_1.calculateJumboWeight)(trim4, thickness, density, cand.jumboLengthM);
                                    const totalTrimKg = mslTrimKg + (ps01TrimKgBase * repeatCycles);
                                    let score = status4 === 'GREEN' ? 1000000 : 50000;
                                    score += cyclePlannedKg * 25;
                                    score += 55000; // 4-UPS pure pack bonus
                                    score += Math.max(0, (500 - trim4) * 50); // Trim tightness bonus
                                    score += cand.packageMultiple * 50000; // Multiplier priority (2x, 3x full jumbo)
                                    score += (cand.jumboDiameterMm / 1250) * 100000; // Target diameter (~1250mm) bonus
                                    score += repeatCycles * 3000;
                                    const wastePct = totalTrimKg > 0 ? (totalTrimKg / (cyclePlannedKg + totalTrimKg)) * 100 : 0;
                                    score -= wastePct * 100;
                                    if (score > bestSetScore) {
                                        bestSetScore = score;
                                        bestWinningSet = {
                                            candidates: [cand, cand, cand, cand],
                                            ps01Ups: 4,
                                            jumboWidths: [cand.jumboWidth, cand.jumboWidth, cand.jumboWidth, cand.jumboWidth],
                                            totalWeb: totalWeb4,
                                            ps01Trim: trim4,
                                            status: status4,
                                            repeatCycles,
                                            totalPlannedKg: cyclePlannedKg,
                                            totalTrimKg,
                                            score,
                                        };
                                    }
                                }
                            }
                        }
                    };
                    // 2. PRIORITY #2: MULTI-ORDER SYNCHRONIZED TRIPLETS SEARCH
                    const searchTriplets = (minTrimAllowed, maxTrimAllowed) => {
                        for (let i = 0; i < numUniqueWidths; i++) {
                            const w1 = uniqueWidths[i];
                            const list1 = candidatesByWidth.get(w1);
                            for (let j = i; j < numUniqueWidths; j++) {
                                const w2 = uniqueWidths[j];
                                const list2 = candidatesByWidth.get(w2);
                                const minW3 = Math.max(w2, 10400 - w1 - w2 - maxTrimAllowed);
                                const maxW3 = Math.min(settings.max_jumbo_width_mm, 10400 - w1 - w2 - minTrimAllowed);
                                if (minW3 > maxW3)
                                    continue;
                                const startK = binarySearchLower(uniqueWidths, minW3, j, numUniqueWidths - 1);
                                const endK = binarySearchUpper(uniqueWidths, maxW3, j, numUniqueWidths - 1);
                                if (startK > endK)
                                    continue;
                                for (let k = startK; k <= endK; k++) {
                                    const w3 = uniqueWidths[k];
                                    const totalWeb = w1 + w2 + w3;
                                    const ps01Trim = 10400 - totalWeb;
                                    if (ps01Trim < 120 || ps01Trim > 500)
                                        continue;
                                    const status = (ps01Trim >= 140 && ps01Trim <= 250) ? 'GREEN' : 'YELLOW';
                                    const baseStatusScore = status === 'GREEN' ? 1000000 : 40000;
                                    const uniqueWidthsCount = (w1 === w2 && w2 === w3) ? 1 : (w1 === w2 || w2 === w3 || w1 === w3) ? 2 : 3;
                                    const setupPenalty = (uniqueWidthsCount - 1) * 300;
                                    const ps01TrimKgBase = (0, metallizerMasterData_1.calculateJumboWeight)(ps01Trim, thickness, density, list1[0].jumboLengthM);
                                    const list3 = candidatesByWidth.get(w3);
                                    for (let idx1 = 0; idx1 < list1.length; idx1++) {
                                        const c1 = list1[idx1];
                                        const cuts1 = c1.cuts;
                                        const start2 = (w1 === w2) ? idx1 : 0;
                                        for (let idx2 = start2; idx2 < list2.length; idx2++) {
                                            const c2 = list2[idx2];
                                            const cuts2 = c2.cuts;
                                            const start3 = (w2 === w3) ? idx2 : 0;
                                            // Pair capacity feasibility filter
                                            let pairPossible = true;
                                            for (let a = 0; a < c1.activeIndices.length; a++) {
                                                const s = c1.activeIndices[a];
                                                if (cuts1[s] + cuts2[s] > capacity[s]) {
                                                    pairPossible = false;
                                                    break;
                                                }
                                            }
                                            if (!pairPossible)
                                                continue;
                                            for (let a = 0; a < c2.activeIndices.length; a++) {
                                                const s = c2.activeIndices[a];
                                                if (cuts1[s] + cuts2[s] > capacity[s]) {
                                                    pairPossible = false;
                                                    break;
                                                }
                                            }
                                            if (!pairPossible)
                                                continue;
                                            for (let idx3 = start3; idx3 < list3.length; idx3++) {
                                                const c3 = list3[idx3];
                                                const cuts3 = c3.cuts;
                                                let maxAllowedCycles = Infinity;
                                                let canSatisfyAllCuts = true;
                                                // Direct check over candidate slots
                                                for (let a = 0; a < c1.activeIndices.length; a++) {
                                                    const w = c1.activeIndices[a];
                                                    const needed = cuts1[w] + cuts2[w] + cuts3[w];
                                                    const cap = capacity[w];
                                                    if (cap < needed) {
                                                        canSatisfyAllCuts = false;
                                                        break;
                                                    }
                                                    const cycles = Math.floor(cap / needed);
                                                    if (cycles < maxAllowedCycles)
                                                        maxAllowedCycles = cycles;
                                                }
                                                if (!canSatisfyAllCuts)
                                                    continue;
                                                for (let a = 0; a < c2.activeIndices.length; a++) {
                                                    const w = c2.activeIndices[a];
                                                    if (cuts1[w] > 0)
                                                        continue; // Already checked
                                                    const needed = cuts2[w] + cuts3[w];
                                                    const cap = capacity[w];
                                                    if (cap < needed) {
                                                        canSatisfyAllCuts = false;
                                                        break;
                                                    }
                                                    const cycles = Math.floor(cap / needed);
                                                    if (cycles < maxAllowedCycles)
                                                        maxAllowedCycles = cycles;
                                                }
                                                if (!canSatisfyAllCuts)
                                                    continue;
                                                for (let a = 0; a < c3.activeIndices.length; a++) {
                                                    const w = c3.activeIndices[a];
                                                    if (cuts1[w] > 0 || cuts2[w] > 0)
                                                        continue; // Already checked
                                                    const needed = cuts3[w];
                                                    const cap = capacity[w];
                                                    if (cap < needed) {
                                                        canSatisfyAllCuts = false;
                                                        break;
                                                    }
                                                    const cycles = Math.floor(cap / needed);
                                                    if (cycles < maxAllowedCycles)
                                                        maxAllowedCycles = cycles;
                                                }
                                                if (!canSatisfyAllCuts || maxAllowedCycles < 1)
                                                    continue;
                                                // Compute cyclePlannedKgPerRun once
                                                let cyclePlannedKgPerRun = 0;
                                                for (let a = 0; a < c1.activeIndices.length; a++) {
                                                    const w = c1.activeIndices[a];
                                                    cyclePlannedKgPerRun += weightPerCut[w] * (cuts1[w] + cuts2[w] + cuts3[w]);
                                                }
                                                for (let a = 0; a < c2.activeIndices.length; a++) {
                                                    const w = c2.activeIndices[a];
                                                    if (cuts1[w] === 0)
                                                        cyclePlannedKgPerRun += weightPerCut[w] * (cuts2[w] + cuts3[w]);
                                                }
                                                for (let a = 0; a < c3.activeIndices.length; a++) {
                                                    const w = c3.activeIndices[a];
                                                    if (cuts1[w] === 0 && cuts2[w] === 0)
                                                        cyclePlannedKgPerRun += weightPerCut[w] * cuts3[w];
                                                }
                                                const repeatCycles = maxAllowedCycles;
                                                const cyclePlannedKg = cyclePlannedKgPerRun * repeatCycles;
                                                const mslTrimKg = ((c1.mslTrim / c1.jumboWidth) * c1.singleJumboWeightKg +
                                                    (c2.mslTrim / c2.jumboWidth) * c2.singleJumboWeightKg +
                                                    (c3.mslTrim / c3.jumboWidth) * c3.singleJumboWeightKg) * repeatCycles;
                                                const ps01TrimKg = ps01TrimKgBase * repeatCycles;
                                                const totalTrimKg = mslTrimKg + ps01TrimKg;
                                                let score = 0;
                                                score += baseStatusScore;
                                                score += cyclePlannedKg * 20;
                                                score += 30000;
                                                score += Math.max(0, (500 - ps01Trim) * 50); // Trim tightness bonus
                                                score += c1.packageMultiple * 50000; // Multiplier priority (2x, 3x full jumbo)
                                                score += (c1.jumboDiameterMm / 1250) * 100000; // Target diameter (~1250mm) bonus
                                                score += repeatCycles * 2000;
                                                const wastePct = totalTrimKg > 0 ? (totalTrimKg / (cyclePlannedKg + totalTrimKg)) * 100 : 0;
                                                score -= wastePct * 100;
                                                score -= setupPenalty;
                                                if (score > bestSetScore) {
                                                    bestSetScore = score;
                                                    bestWinningSet = {
                                                        candidates: [c1, c2, c3],
                                                        ps01Ups: 3,
                                                        jumboWidths: [w1, w2, w3],
                                                        totalWeb,
                                                        ps01Trim,
                                                        status,
                                                        repeatCycles,
                                                        totalPlannedKg: cyclePlannedKg,
                                                        totalTrimKg,
                                                        score,
                                                    };
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    };
                    // 3. 4-UPS MEET-IN-THE-MIDDLE PAIR SEARCH (First-Class 4-Roll Pack Generation)
                    const search4UpsPairs = (minTrimAllowed, maxTrimAllowed) => {
                        if (uniqueWidths.length === 0 || uniqueWidths[0] * 4 > 10400 - 120)
                            return;
                        // Build valid pairs (c1, c2) with w1 <= w2
                        const pairsBySum = new Map();
                        for (let i = 0; i < numUniqueWidths; i++) {
                            const w1 = uniqueWidths[i];
                            const list1 = candidatesByWidth.get(w1);
                            for (let j = i; j < numUniqueWidths; j++) {
                                const w2 = uniqueWidths[j];
                                const list2 = candidatesByWidth.get(w2);
                                const pairSum = w1 + w2;
                                for (let idx1 = 0; idx1 < list1.length; idx1++) {
                                    const c1 = list1[idx1];
                                    const start2 = (w1 === w2) ? idx1 : 0;
                                    for (let idx2 = start2; idx2 < list2.length; idx2++) {
                                        const c2 = list2[idx2];
                                        // Check pair capacity
                                        let pairFeasible = true;
                                        const combinedCuts = new Array(numDemandSlots).fill(0);
                                        const activeIndices = [];
                                        let kgPerRun = 0;
                                        const checkedSet = new Set();
                                        for (let a = 0; a < c1.activeIndices.length; a++)
                                            checkedSet.add(c1.activeIndices[a]);
                                        for (let a = 0; a < c2.activeIndices.length; a++)
                                            checkedSet.add(c2.activeIndices[a]);
                                        for (const s of checkedSet) {
                                            const needed = c1.cuts[s] + c2.cuts[s];
                                            if (needed > capacity[s]) {
                                                pairFeasible = false;
                                                break;
                                            }
                                            combinedCuts[s] = needed;
                                            activeIndices.push(s);
                                            kgPerRun += weightPerCut[s] * needed;
                                        }
                                        if (!pairFeasible)
                                            continue;
                                        const mslTrimKgPerRun = (c1.mslTrim / c1.jumboWidth) * c1.singleJumboWeightKg +
                                            (c2.mslTrim / c2.jumboWidth) * c2.singleJumboWeightKg;
                                        const pair = {
                                            c1,
                                            c2,
                                            w1,
                                            w2,
                                            pairSum,
                                            combinedCuts,
                                            activeIndices,
                                            kgPerRun,
                                            mslTrimKgPerRun,
                                        };
                                        let list = pairsBySum.get(pairSum);
                                        if (!list) {
                                            list = [];
                                            pairsBySum.set(pairSum, list);
                                        }
                                        if (list.length < 10) {
                                            list.push(pair);
                                        }
                                    }
                                }
                            }
                        }
                        // Sort unique pair sums
                        const uniquePairSums = Array.from(pairsBySum.keys()).sort((a, b) => a - b);
                        const numPairSums = uniquePairSums.length;
                        for (let pAIdx = 0; pAIdx < numPairSums; pAIdx++) {
                            const sumA = uniquePairSums[pAIdx];
                            const pairsA = pairsBySum.get(sumA);
                            const minSumB = Math.max(sumA, 10400 - sumA - maxTrimAllowed);
                            const maxSumB = 10400 - sumA - minTrimAllowed;
                            if (minSumB > maxSumB)
                                continue;
                            const startB = binarySearchLower(uniquePairSums, minSumB, pAIdx, numPairSums - 1);
                            const endB = binarySearchUpper(uniquePairSums, maxSumB, pAIdx, numPairSums - 1);
                            if (startB > endB)
                                continue;
                            for (let pBIdx = startB; pBIdx <= endB; pBIdx++) {
                                const sumB = uniquePairSums[pBIdx];
                                const pairsB = pairsBySum.get(sumB);
                                const totalWeb = sumA + sumB;
                                const ps01Trim = 10400 - totalWeb;
                                if (ps01Trim < 120 || ps01Trim > 500)
                                    continue;
                                const status = (ps01Trim >= 140 && ps01Trim <= 250) ? 'GREEN' : 'YELLOW';
                                const baseStatusScore = status === 'GREEN' ? 1000000 : 50000;
                                const ps01TrimKgBase = (0, metallizerMasterData_1.calculateJumboWeight)(ps01Trim, thickness, density, pairsA[0].c1.jumboLengthM);
                                for (let idxA = 0; idxA < pairsA.length; idxA++) {
                                    const pairA = pairsA[idxA];
                                    const startPairB = (sumA === sumB) ? idxA : 0;
                                    for (let idxB = startPairB; idxB < pairsB.length; idxB++) {
                                        const pairB = pairsB[idxB];
                                        // Canonical ordering: pairA.w2 <= pairB.w1 if sumA === sumB
                                        if (sumA === sumB && pairA.w2 > pairB.w1)
                                            continue;
                                        let maxAllowedCycles = Infinity;
                                        let canSatisfyAllCuts = true;
                                        const checkedUnion = new Set();
                                        for (let a = 0; a < pairA.activeIndices.length; a++)
                                            checkedUnion.add(pairA.activeIndices[a]);
                                        for (let b = 0; b < pairB.activeIndices.length; b++)
                                            checkedUnion.add(pairB.activeIndices[b]);
                                        for (const s of checkedUnion) {
                                            const needed = pairA.combinedCuts[s] + pairB.combinedCuts[s];
                                            const cap = capacity[s];
                                            if (cap < needed) {
                                                canSatisfyAllCuts = false;
                                                break;
                                            }
                                            const cycles = Math.floor(cap / needed);
                                            if (cycles < maxAllowedCycles)
                                                maxAllowedCycles = cycles;
                                        }
                                        if (!canSatisfyAllCuts || maxAllowedCycles < 1)
                                            continue;
                                        const repeatCycles = maxAllowedCycles;
                                        const cyclePlannedKgPerRun = pairA.kgPerRun + pairB.kgPerRun;
                                        const cyclePlannedKg = cyclePlannedKgPerRun * repeatCycles;
                                        const totalTrimKg = (pairA.mslTrimKgPerRun + pairB.mslTrimKgPerRun + ps01TrimKgBase) * repeatCycles;
                                        let score = baseStatusScore;
                                        score += cyclePlannedKg * 25;
                                        score += 50000; // 4-UPS pack evaluation
                                        score += Math.max(0, (500 - ps01Trim) * 50); // Trim tightness bonus
                                        score += pairA.c1.packageMultiple * 50000; // Multiplier priority (2x, 3x full jumbo)
                                        score += (pairA.c1.jumboDiameterMm / 1250) * 100000; // Target diameter (~1250mm) bonus
                                        score += repeatCycles * 2500;
                                        const wastePct = totalTrimKg > 0 ? (totalTrimKg / (cyclePlannedKg + totalTrimKg)) * 100 : 0;
                                        score -= wastePct * 100;
                                        if (score > bestSetScore) {
                                            bestSetScore = score;
                                            bestWinningSet = {
                                                candidates: [pairA.c1, pairA.c2, pairB.c1, pairB.c2],
                                                ps01Ups: 4,
                                                jumboWidths: [pairA.w1, pairA.w2, pairB.w1, pairB.w2],
                                                totalWeb,
                                                ps01Trim,
                                                status,
                                                repeatCycles,
                                                totalPlannedKg: cyclePlannedKg,
                                                totalTrimKg,
                                                score,
                                            };
                                        }
                                    }
                                }
                            }
                        }
                    };
                    // 1. PRIMARY: SEARCH ALL GREEN CONFIGURATIONS FIRST (Pure, 3-UPS Mixed Triplets, 4-UPS Mixed Pairs)
                    searchPurePacks(140, 250);
                    searchTriplets(140, 250);
                    search4UpsPairs(140, 250);
                    // 2. FALLBACK TO YELLOW TRIM [120-139mm & 251-500mm] ONLY IF NO GREEN PACK CAN BE FORMED
                    if (!bestWinningSet || bestWinningSet.status !== 'GREEN') {
                        searchPurePacks(120, 139);
                        searchPurePacks(251, 500);
                        searchTriplets(120, 139);
                        searchTriplets(251, 500);
                        search4UpsPairs(120, 139);
                        search4UpsPairs(251, 500);
                    }
                }
            }
        };
        // Phase 1: Search for Full-Length Multiplier packs (2x, 3x, or max diameter) first
        runSearchPass(false);
        // Phase 2: If NO full-length pack can be formed across any active balance orders, allow single tail pack (1x remainder)
        if (!bestWinningSet) {
            runSearchPass(true);
        }
        // ALL PACKS ARE FULLY DEMAND-BACKED:
        // If no 3-UPS or 4-UPS combination can be formed from remaining active orders,
        // we strictly terminate with zero surplus rather than creating phantom/unallocated rolls.
        if (!bestWinningSet)
            break;
        // ALLOCATE DEMAND AND DEDUCT FROM ORDER TRACKERS FOR THE WINNING SET
        const winning = bestWinningSet;
        const distinctCandidates = Array.from(new Set(winning.candidates));
        let totalAllocatedInIter = 0;
        for (const cand of distinctCandidates) {
            const occurrencesInSet = winning.candidates.filter(c => c.id === cand.id).length;
            const totalRollsForCand = occurrencesInSet * winning.repeatCycles;
            const jumboLen = cand.jumboLengthM;
            const ordersCoveredMap = new Map();
            const slotCutsNeeded = new Map();
            for (const cut of cand.cutsList) {
                slotCutsNeeded.set(cut.slotIdx, (slotCutsNeeded.get(cut.slotIdx) || 0) + 1);
            }
            for (const [slotIdx, cutsPerJumbo] of slotCutsNeeded.entries()) {
                const slotDef = demandSlots[slotIdx];
                if (!slotDef)
                    continue;
                let totalKnifeRunsToDistribute = cutsPerJumbo * totalRollsForCand;
                const matching = orderTrackers
                    .filter(t => t.slotIdx === slotIdx && t.remainingKg > 0.01)
                    .sort((a, b) => (b.order.priority ? 1 : 0) - (a.order.priority ? 1 : 0) || b.remainingKg - a.remainingKg);
                for (const tr of matching) {
                    if (totalKnifeRunsToDistribute <= 0)
                        break;
                    const spareKg = tr.maxAllowedKg - tr.allocatedKg;
                    const weightPerReel = (0, metallizerMasterData_1.calculateJumboWeight)(slotDef.width_mm, thickness, density, tr.pkgLength);
                    const reelsPerJumboRun = Math.max(1, Math.round(jumboLen / tr.pkgLength));
                    const maxJumboRunsAllowed = Math.floor((spareKg + 0.01) / (weightPerReel * reelsPerJumboRun));
                    if (maxJumboRunsAllowed >= 1) {
                        const runsForThis = Math.min(totalKnifeRunsToDistribute, maxJumboRunsAllowed);
                        const reelsForThis = runsForThis * reelsPerJumboRun;
                        const weightForThis = Number((reelsForThis * weightPerReel).toFixed(2));
                        tr.allocatedKg = Number((tr.allocatedKg + weightForThis).toFixed(2));
                        tr.remainingKg = Math.max(0, Number((tr.order.remaining_qty - tr.allocatedKg).toFixed(2)));
                        tr.allocatedReels += reelsForThis;
                        tr.status = tr.remainingKg <= 0.01 ? 'COMPLETED' : 'PARTIALLY_FULFILLED';
                        totalKnifeRunsToDistribute -= runsForThis;
                        totalAllocatedInIter += weightForThis;
                        const existingCov = ordersCoveredMap.get(tr.order.id);
                        if (existingCov) {
                            existingCov.required_reels += reelsForThis;
                            existingCov.weight_kg = Number((existingCov.weight_kg + weightForThis).toFixed(2));
                        }
                        else {
                            ordersCoveredMap.set(tr.order.id, {
                                order_id: tr.order.id,
                                sales_order: tr.order.sales_order,
                                item_number: tr.order.item_number,
                                customer: tr.order.customer,
                                width_mm: tr.order.width_mm,
                                length_m: tr.pkgLength,
                                required_reels: reelsForThis,
                                weight_kg: weightForThis,
                            });
                        }
                    }
                }
            }
            const totalWeightKg = Number((cand.singleJumboWeightKg * totalRollsForCand).toFixed(2));
            const actualTrim = cand.mslTrim;
            const uniqueInDeckle = new Set(winning.jumboWidths).size;
            const deckleTypeDesc = uniqueInDeckle === 1 ? 'Uniform' : uniqueInDeckle === 2 ? '2-Width Mixed' : '3-Width Mixed';
            finalRequirements.push({
                id: `req-msl-${reqCounter++}`,
                film: cand.film || groupLabel,
                thickness_micron: thickness,
                required_jumbo_width_mm: cand.jumboWidth,
                required_jumbo_length_m: cand.jumboLengthM,
                calculated_diameter_mm: cand.jumboDiameterMm,
                core: settings.core,
                required_rolls_count: totalRollsForCand,
                ups: cand.combo.ups,
                finished_widths_covered: cand.combo.widths,
                expected_trim_mm: actualTrim,
                trim_width_mm: actualTrim,
                orders_covered: Array.from(ordersCoveredMap.values()),
                package_multiple: cand.packageMultiple,
                total_weight_kg: totalWeightKg,
                efficiency_percent: Number(((cand.combo.sumWidth / cand.jumboWidth) * 100).toFixed(1)),
                planning_mode: filmsInGroup.length > 1 ? 'COMBINED' : 'SINGLE',
                compatible_group_key: groupLabel,
                ps01_run_index: iteration,
                ps01_parent_deckle_id: `ps01-run-${iteration}`,
                msl_pattern_summary: {
                    total_cuts: cand.combo.ups,
                    cuts: Array.from(ordersCoveredMap.values()).map(cov => ({
                        order_id: cov.order_id,
                        sales_order: cov.sales_order,
                        film: cand.film || groupLabel,
                        width_mm: cov.width_mm,
                        length_m: cov.length_m,
                        allocated_weight_kg: cov.weight_kg,
                    })),
                },
                ps01_feasibility: {
                    status: winning.status,
                    is_feasible: true,
                    ps01_deckle_mm: 10400,
                    jumbo_width_mm: cand.jumboWidth,
                    ps01_ups: winning.ps01Ups,
                    ps01_cut_combination: winning.jumboWidths,
                    ps01_total_width_mm: winning.totalWeb,
                    ps01_trim_mm: winning.ps01Trim,
                    ps01_deckle_efficiency_percent: Number(((winning.totalWeb / 10400) * 100).toFixed(2)),
                    ps01_duplex_balanced: true,
                    side_a_ups: Math.ceil(winning.ps01Ups / 2),
                    side_b_ups: Math.floor(winning.ps01Ups / 2),
                    relaxation_type: winning.status === 'GREEN' ? 'NONE' : 'PS01_TRIM_RELAXED',
                    relaxation_flag: winning.status === 'YELLOW' ? `NON-STANDARD PS01 TRIM: Upstream trim relaxed to ${winning.ps01Trim} mm for ${deckleTypeDesc} pattern` : undefined,
                    explanation: `${winning.ps01Ups}-UPS ${deckleTypeDesc} jumbo manufacturing pattern on PS01 ([${winning.jumboWidths.join(', ')}] mm = ${winning.totalWeb} mm, PS01 Trim: ${winning.ps01Trim}mm)`,
                },
                is_mutually_feasible: true,
                relaxation_flag: winning.status === 'YELLOW' ? `NON-STANDARD PS01 TRIM: Upstream trim relaxed to ${winning.ps01Trim} mm` : undefined,
                notes: `${deckleTypeDesc} [${winning.jumboWidths.join(', ')}] mm deckle on PS01 (Trim: ${winning.ps01Trim}mm)`,
                created_at: new Date().toISOString(),
            });
        }
        if (totalAllocatedInIter <= 0)
            break;
    }
    // Summary Metrics Calculation
    const totalRolls = finalRequirements.reduce((sum, r) => sum + r.required_rolls_count, 0);
    const uniqueJumboWidths = Array.from(new Set(finalRequirements.map(r => r.required_jumbo_width_mm)));
    const totalPlannedKg = finalRequirements.reduce((sum, r) => sum + r.total_weight_kg, 0);
    const totalTrimKg = finalRequirements.reduce((sum, r) => {
        const trimFraction = (r.expected_trim_mm || 0) / r.required_jumbo_width_mm;
        return sum + (r.total_weight_kg * trimFraction);
    }, 0);
    const avgWaste = totalPlannedKg > 0 ? (totalTrimKg / totalPlannedKg) * 100 : 0;
    const ps01_3ups = finalRequirements.filter(r => r.ps01_feasibility?.ps01_ups === 3).length;
    const ps01_4ups = finalRequirements.filter(r => r.ps01_feasibility?.ps01_ups === 4).length;
    const greenCount = finalRequirements.filter(r => r.ps01_feasibility?.status === 'GREEN').length;
    const yellowCount = finalRequirements.filter(r => r.ps01_feasibility?.status === 'YELLOW').length;
    const redCount = finalRequirements.filter(r => r.ps01_feasibility?.status === 'RED').length;
    const totalDemandKg = groupOrders.reduce((sum, o) => sum + o.remaining_qty, 0);
    const orderFulfillment = totalDemandKg > 0 ? Math.min(100, (totalPlannedKg / totalDemandKg) * 100) : 0;
    const maxJumboLen = Math.max(...finalRequirements.map(r => r.required_jumbo_length_m), 0);
    let totalScore = 0;
    totalScore += orderFulfillment * 2000;
    totalScore -= redCount * 10000000;
    totalScore += greenCount * 15000;
    totalScore += yellowCount * 5000;
    totalScore += ps01_3ups * 10000;
    totalScore += ps01_4ups * 4000;
    totalScore -= totalRolls * 500;
    totalScore -= uniqueJumboWidths.length * 300;
    totalScore -= avgWaste * 50;
    return {
        requirements: finalRequirements,
        score: totalScore,
        evaluation: {
            strategy: filmsInGroup.length > 1 ? 'COMBINED' : 'SEPARATE',
            film_group: groupLabel,
            films_included: filmsInGroup,
            requirements: finalRequirements,
            total_rolls: totalRolls,
            unique_jumbo_widths: uniqueJumboWidths,
            total_planned_kg: totalPlannedKg,
            total_trim_kg: totalTrimKg,
            average_waste_percent: avgWaste,
            ps01_3ups_count: ps01_3ups,
            ps01_4ups_count: ps01_4ups,
            max_jumbo_length_m: maxJumboLen,
            is_fully_feasible: finalRequirements.every(r => r.ps01_feasibility?.is_feasible && r.ps01_feasibility.status !== 'RED'),
            score: totalScore,
            reason: `${finalRequirements.length} plan(s), ${totalRolls} roll(s), ${ps01_3ups} 3-UPS patterns`,
        },
    };
}
/**
 * Generate Upstream Jumbo Roll Requirements from Metallized Orders
 *
 * IMPLEMENTS COMPATIBLE FILM GROUP PLANNING (Sections 1-25):
 * 1. Determines film compatibility group (e.g. MZ10S-18 ↔ MZ18, MZ10S-20 ↔ MZ20).
 * 2. Compares Option A (Separate Planning) vs Option B (Combined Planning).
 * 3. Prefers Combined Planning when feasible and objectively better under locked priority hierarchy.
 * 4. Allows a PORTFOLIO OF DIFFERENT JUMBO WIDTHS in the final plan.
 * 5. Strictly enforces per-order +3% ceiling (Allocated <= Balance * 1.03).
 * 6. Discards RED candidates immediately (0 KG, 0 rolls).
 */
function generateJumboRollRequirements(orders, settings, selectedFilm, options) {
    const rules = options?.compatibilityRules || filmCompatibilityMaster_1.DEFAULT_FILM_COMPATIBILITY_RULES;
    const forceStrategy = options?.forceStrategy || 'AUTO';
    const onProgress = options?.onProgress;
    onProgress?.(10, 'Filtering metallizer orders & analyzing film compatibility...');
    // HARD RULE: Include only MZ orders in Metallizer Slitter demand/planning
    let pending = orders.filter(o => isMetallizerOrder(o) && o.remaining_qty > 0.01);
    if (pending.length === 0) {
        onProgress?.(100, 'No pending metallizer orders found');
        return [];
    }
    // Determine target films
    let targetFilms = [];
    if (selectedFilm && selectedFilm !== 'ALL') {
        // If selectedFilm belongs to a compatible group, include the whole group
        targetFilms = (0, filmCompatibilityMaster_1.getCompatibleFilmsFor)(selectedFilm, rules);
        pending = pending.filter(o => targetFilms.includes(o.film));
    }
    if (pending.length === 0) {
        onProgress?.(100, 'No matching pending orders for target film');
        return [];
    }
    // Group pending orders into compatible film groups
    const allFilmsInPending = Array.from(new Set(pending.map(o => o.film)));
    const compatibleGroups = (0, filmCompatibilityMaster_1.getAllCompatibleGroups)(allFilmsInPending, rules);
    const finalRequirements = [];
    let globalReqCounter = 1;
    const totalGroups = compatibleGroups.length;
    for (let gIdx = 0; gIdx < totalGroups; gIdx++) {
        const group = compatibleGroups[gIdx];
        const baseProgress = 20 + Math.floor((gIdx / totalGroups) * 70);
        onProgress?.(baseProgress, `Synthesizing ${group.group_name} patterns & evaluating PS01 deckles...`);
        const groupOrders = pending.filter(o => group.films.includes(o.film));
        if (groupOrders.length === 0)
            continue;
        // If group has only 1 film or cannot be combined, optimize directly
        if (group.films.length <= 1 || !group.is_combined_eligible || forceStrategy === 'SEPARATE') {
            const result = optimizeDemandPool(groupOrders, settings, group.group_name, globalReqCounter);
            finalRequirements.push(...result.requirements);
            globalReqCounter += result.requirements.length;
            continue;
        }
        // MULTI-FILM COMPATIBLE GROUP: Evaluate Option A (Separate) vs Option B (Combined)
        // Option A: Separate Planning
        let optionATotalScore = 0;
        const optionAReqs = [];
        let optionAReqCount = globalReqCounter;
        for (const singleFilm of group.films) {
            const singleFilmOrders = groupOrders.filter(o => o.film === singleFilm);
            if (singleFilmOrders.length === 0)
                continue;
            const singleRes = optimizeDemandPool(singleFilmOrders, settings, singleFilm, optionAReqCount);
            optionAReqs.push(...singleRes.requirements);
            optionATotalScore += singleRes.score;
            optionAReqCount += singleRes.requirements.length;
        }
        // Option B: Combined Planning
        const optionBRes = optimizeDemandPool(groupOrders, settings, group.group_name, globalReqCounter);
        const optionBTotalScore = optionBRes.score;
        const optionBReqs = optionBRes.requirements;
        // Decision Logic according to Section 5:
        // "If combined planning provides a better result according to the locked optimization priorities,
        // combined planning should be preferred."
        let selectCombined = false;
        if (forceStrategy === 'COMBINED') {
            selectCombined = true;
        }
        else {
            // Automatic Evaluation:
            // Check if Option B is fully feasible and has higher/equal score, fewer rolls, better 3-UPS utilization, or higher fulfilled weight
            const optAFulfilledKg = optionAReqs.reduce((sum, r) => sum + r.total_weight_kg, 0);
            const optBFulfilledKg = optionBReqs.reduce((sum, r) => sum + r.total_weight_kg, 0);
            const optA3Ups = optionAReqs.filter(r => r.ps01_feasibility?.ps01_ups === 3).length;
            const optB3Ups = optionBReqs.filter(r => r.ps01_feasibility?.ps01_ups === 3).length;
            const optARolls = optionAReqs.reduce((sum, r) => sum + r.required_rolls_count, 0);
            const optBRolls = optionBReqs.reduce((sum, r) => sum + r.required_rolls_count, 0);
            if (group.preference === 'PREFER_COMBINED' && optionBRes.evaluation.is_fully_feasible && optionBReqs.length > 0) {
                // Prefer combined if it fulfills at least as much demand with equal or fewer rolls, or higher score
                if (optBFulfilledKg >= optAFulfilledKg * 0.95 || optionBTotalScore >= optionATotalScore) {
                    selectCombined = true;
                }
            }
            else if (optionBTotalScore > optionATotalScore) {
                selectCombined = true;
            }
        }
        if (selectCombined && optionBReqs.length > 0) {
            finalRequirements.push(...optionBReqs);
            globalReqCounter += optionBReqs.length;
        }
        else {
            finalRequirements.push(...optionAReqs);
            globalReqCounter += optionAReqs.length;
        }
    }
    return finalRequirements;
}
/**
 * Generate MSL Candidate Slit Patterns for a given physical jumbo roll and available orders.
 * Supports:
 * - 1 to 6 UPS (MSL capacity)
 * - Single width repeats
 * - Multi-width combinations (e.g. 1120 + 1130 + 1140 mm)
 * - Multi-length combinations (e.g. 10,000 m + 20,000 m where 1x and 2x are concurrently slit)
 * - Compatible film cross-allocation if films are in the same compatibility group
 */
function findMSLCandidatePatterns(roll, activeOrders, settings, rules = filmCompatibilityMaster_1.DEFAULT_FILM_COMPATIBILITY_RULES) {
    const matchingOrders = activeOrders.filter(o => isMetallizerOrder(o) &&
        o.remaining_qty > 0.01 &&
        (0, filmCompatibilityMaster_1.areFilmsCompatible)(o.film, roll.film, rules) &&
        (o.thickness_micron === roll.thickness_micron || !o.thickness_micron));
    if (matchingOrders.length === 0 || roll.remaining_length_m <= 0)
        return [];
    const candidates = [];
    const maxUps = Math.min(6, settings.max_planning_ups || 6);
    // 1. Single order repeats (1 to maxUps)
    for (const ord of matchingOrders) {
        for (let ups = 1; ups <= maxUps; ups++) {
            const totalWidth = ord.width_mm * ups;
            const trim = roll.width_mm - totalWidth;
            if (trim >= settings.min_trim_mm && trim <= roll.width_mm * 0.15) {
                const pkgLength = ord.length_m || 19500;
                if (roll.remaining_length_m < pkgLength)
                    continue;
                const multiple = Math.floor(roll.remaining_length_m / pkgLength);
                if (multiple < 1)
                    continue;
                const totalReels = ups * multiple;
                const totalWeight = (0, metallizerMasterData_1.calculateJumboWeight)(ord.width_mm, roll.thickness_micron, roll.density, pkgLength) * totalReels;
                // Strict ceiling check: cannot exceed individual order remaining_qty * 1.03
                if (totalWeight > ord.remaining_qty * 1.03)
                    continue;
                const totalRollWeight = (0, metallizerMasterData_1.calculateJumboWeight)(roll.width_mm, roll.thickness_micron, roll.density, pkgLength * multiple);
                const trimWeight = totalRollWeight - totalWeight;
                const wastePct = (trimWeight / totalRollWeight) * 100;
                let score = 500 + ups * 100;
                if (trim >= settings.min_trim_mm && trim <= settings.max_trim_mm)
                    score += 500;
                else
                    score -= Math.abs(trim - 25) * 10;
                if (ord.priority)
                    score += 2000;
                score += totalWeight / 10;
                score -= wastePct * 50;
                candidates.push({
                    jumbo_roll: roll,
                    ups,
                    slit_widths: Array(ups).fill(ord.width_mm),
                    orders: [{
                            order: ord,
                            ups,
                            width_mm: ord.width_mm,
                            length_m: pkgLength,
                            reels: totalReels,
                            weight_kg: totalWeight,
                            is_closed: ord.remaining_qty <= totalWeight * 1.03,
                        }],
                    total_slit_width_mm: totalWidth,
                    trim_mm: trim,
                    package_length_m: pkgLength,
                    package_multiple: multiple,
                    total_planned_weight_kg: totalWeight,
                    trim_weight_kg: trimWeight,
                    waste_percent: wastePct,
                    score,
                });
            }
        }
    }
    // 2. 2-Order Combinations (Multi-width and/or Multi-length: e.g. 1+1, 2+1, 1+2, 2+2, 3+1, 3+2, 3+3)
    if (matchingOrders.length >= 2) {
        for (let i = 0; i < matchingOrders.length; i++) {
            for (let j = 0; j < matchingOrders.length; j++) {
                if (i === j)
                    continue;
                const o1 = matchingOrders[i];
                const o2 = matchingOrders[j];
                const len1 = o1.length_m || 19500;
                const len2 = o2.length_m || 19500;
                const isCompatibleLength = (len1 === len2) || (len1 * 2 === len2) || (len1 === len2 * 2);
                if (!isCompatibleLength)
                    continue;
                const lcmLen = Math.max(len1, len2);
                if (roll.remaining_length_m < lcmLen)
                    continue;
                const multiple = Math.floor(roll.remaining_length_m / lcmLen);
                if (multiple < 1)
                    continue;
                for (let u1 = 1; u1 <= 5; u1++) {
                    for (let u2 = 1; u2 <= 5; u2++) {
                        const totalUps = u1 + u2;
                        if (totalUps > maxUps)
                            continue;
                        const totalWidth = o1.width_mm * u1 + o2.width_mm * u2;
                        const trim = roll.width_mm - totalWidth;
                        if (trim >= settings.min_trim_mm && trim <= roll.width_mm * 0.15) {
                            const o1Reels = u1 * multiple * Math.floor(lcmLen / len1);
                            const o2Reels = u2 * multiple * Math.floor(lcmLen / len2);
                            const order1Weight = (0, metallizerMasterData_1.calculateJumboWeight)(o1.width_mm, roll.thickness_micron, roll.density, len1) * o1Reels;
                            const order2Weight = (0, metallizerMasterData_1.calculateJumboWeight)(o2.width_mm, roll.thickness_micron, roll.density, len2) * o2Reels;
                            if (order1Weight > o1.remaining_qty * 1.03 || order2Weight > o2.remaining_qty * 1.03)
                                continue;
                            const totalWeight = order1Weight + order2Weight;
                            const totalRollWeight = (0, metallizerMasterData_1.calculateJumboWeight)(roll.width_mm, roll.thickness_micron, roll.density, lcmLen * multiple);
                            const trimWeight = totalRollWeight - totalWeight;
                            const wastePct = (trimWeight / totalRollWeight) * 100;
                            let score = 800 + totalUps * 100;
                            if (o1.width_mm !== o2.width_mm)
                                score += 500;
                            if (len1 !== len2)
                                score += 600;
                            if (trim >= settings.min_trim_mm && trim <= settings.max_trim_mm)
                                score += 500;
                            else
                                score -= Math.abs(trim - 25) * 10;
                            if (o1.priority || o2.priority)
                                score += 2000;
                            score += totalWeight / 10;
                            score -= wastePct * 50;
                            const widthsArray = [];
                            for (let k = 0; k < u1; k++)
                                widthsArray.push(o1.width_mm);
                            for (let k = 0; k < u2; k++)
                                widthsArray.push(o2.width_mm);
                            candidates.push({
                                jumbo_roll: roll,
                                ups: totalUps,
                                slit_widths: widthsArray,
                                orders: [
                                    {
                                        order: o1,
                                        ups: u1,
                                        width_mm: o1.width_mm,
                                        length_m: len1,
                                        reels: o1Reels,
                                        weight_kg: order1Weight,
                                        is_closed: o1.remaining_qty <= order1Weight * 1.03,
                                    },
                                    {
                                        order: o2,
                                        ups: u2,
                                        width_mm: o2.width_mm,
                                        length_m: len2,
                                        reels: o2Reels,
                                        weight_kg: order2Weight,
                                        is_closed: o2.remaining_qty <= order2Weight * 1.03,
                                    }
                                ],
                                total_slit_width_mm: totalWidth,
                                trim_mm: trim,
                                package_length_m: lcmLen,
                                package_multiple: multiple,
                                total_planned_weight_kg: totalWeight,
                                trim_weight_kg: trimWeight,
                                waste_percent: wastePct,
                                score,
                            });
                        }
                    }
                }
            }
        }
    }
    // 3. 3-Order Combinations (e.g. 1+1+1 across compatible finished widths)
    if (matchingOrders.length >= 3) {
        for (let i = 0; i < matchingOrders.length; i++) {
            for (let j = i + 1; j < matchingOrders.length; j++) {
                for (let k = j + 1; k < matchingOrders.length; k++) {
                    const o1 = matchingOrders[i];
                    const o2 = matchingOrders[j];
                    const o3 = matchingOrders[k];
                    const len1 = o1.length_m || 19500;
                    const len2 = o2.length_m || 19500;
                    const len3 = o3.length_m || 19500;
                    const minLen = Math.min(len1, len2, len3);
                    const isCompatible = [len1, len2, len3].every(l => l === minLen || l === minLen * 2);
                    if (!isCompatible)
                        continue;
                    const lcmLen = Math.max(len1, len2, len3);
                    if (roll.remaining_length_m < lcmLen)
                        continue;
                    const multiple = Math.floor(roll.remaining_length_m / lcmLen);
                    if (multiple < 1)
                        continue;
                    const totalWidth = o1.width_mm + o2.width_mm + o3.width_mm;
                    const trim = roll.width_mm - totalWidth;
                    if (trim >= settings.min_trim_mm && trim <= roll.width_mm * 0.15) {
                        const r1 = multiple * Math.floor(lcmLen / len1);
                        const r2 = multiple * Math.floor(lcmLen / len2);
                        const r3 = multiple * Math.floor(lcmLen / len3);
                        const w1 = (0, metallizerMasterData_1.calculateJumboWeight)(o1.width_mm, roll.thickness_micron, roll.density, len1) * r1;
                        const w2 = (0, metallizerMasterData_1.calculateJumboWeight)(o2.width_mm, roll.thickness_micron, roll.density, len2) * r2;
                        const w3 = (0, metallizerMasterData_1.calculateJumboWeight)(o3.width_mm, roll.thickness_micron, roll.density, len3) * r3;
                        if (w1 > o1.remaining_qty * 1.03 || w2 > o2.remaining_qty * 1.03 || w3 > o3.remaining_qty * 1.03)
                            continue;
                        const totalWeight = w1 + w2 + w3;
                        const totalRollWeight = (0, metallizerMasterData_1.calculateJumboWeight)(roll.width_mm, roll.thickness_micron, roll.density, lcmLen * multiple);
                        const trimWeight = totalRollWeight - totalWeight;
                        const wastePct = (trimWeight / totalRollWeight) * 100;
                        let score = 1200;
                        const distinctWidths = new Set([o1.width_mm, o2.width_mm, o3.width_mm]).size;
                        score += distinctWidths * 300;
                        if (trim >= settings.min_trim_mm && trim <= settings.max_trim_mm)
                            score += 500;
                        else
                            score -= Math.abs(trim - 25) * 10;
                        if (o1.priority || o2.priority || o3.priority)
                            score += 2000;
                        score += totalWeight / 10;
                        score -= wastePct * 50;
                        candidates.push({
                            jumbo_roll: roll,
                            ups: 3,
                            slit_widths: [o1.width_mm, o2.width_mm, o3.width_mm],
                            orders: [
                                { order: o1, ups: 1, width_mm: o1.width_mm, length_m: len1, reels: r1, weight_kg: w1, is_closed: o1.remaining_qty <= w1 * 1.03 },
                                { order: o2, ups: 1, width_mm: o2.width_mm, length_m: len2, reels: r2, weight_kg: w2, is_closed: o2.remaining_qty <= w2 * 1.03 },
                                { order: o3, ups: 1, width_mm: o3.width_mm, length_m: len3, reels: r3, weight_kg: w3, is_closed: o3.remaining_qty <= w3 * 1.03 },
                            ],
                            total_slit_width_mm: totalWidth,
                            trim_mm: trim,
                            package_length_m: lcmLen,
                            package_multiple: multiple,
                            total_planned_weight_kg: totalWeight,
                            trim_weight_kg: trimWeight,
                            waste_percent: wastePct,
                            score,
                        });
                    }
                }
            }
        }
    }
    return candidates;
}
/**
 * Metallizer Slitter Plan Optimizer
 * Generates execution slitting plans strictly against available physical jumbo rolls
 * Supports 1 to 6 UPS (MSL has 6 UPS available).
 * Enables multi-plan sequential jumbo roll reuse (e.g. 1 x 20,000m jumbo supplying Plan A 10,000m and Plan B 10,000m).
 */
function generateMetallizerPlans(orders, availableJumboRolls, rawSettings, selectedFilm, rules = filmCompatibilityMaster_1.DEFAULT_FILM_COMPATIBILITY_RULES) {
    const settings = { ...metallizerMasterData_1.DEFAULT_METALLIZER_SETTINGS, ...rawSettings };
    // HARD RULE: Only usable MZ jumbo rolls are processed for Metallizer Slitter
    let usableRolls = availableJumboRolls.filter(r => isMetallizedFilm(r.film) &&
        (r.status === 'AVAILABLE' || r.status === 'PARTIALLY_CONSUMED') &&
        r.remaining_length_m > 0 &&
        r.width_mm <= settings.max_jumbo_width_mm &&
        r.diameter_mm <= settings.max_jumbo_diameter_mm);
    if (selectedFilm && selectedFilm !== 'ALL') {
        const compatibleFilms = (0, filmCompatibilityMaster_1.getCompatibleFilmsFor)(selectedFilm, rules);
        usableRolls = usableRolls.filter(r => compatibleFilms.includes(r.film));
    }
    if (usableRolls.length === 0) {
        return { plans: [], remainingOrders: orders, updatedRolls: availableJumboRolls };
    }
    const activeOrders = orders.map(o => ({ ...o }));
    const rollsPool = usableRolls.map(r => ({ ...r }));
    const generatedPlans = [];
    let planCounter = 1;
    // Process available jumbo rolls sequentially, allowing EACH jumbo roll to supply
    // multiple MSL plans until its length is fully exhausted
    for (const roll of rollsPool) {
        let rollLoopCount = 0;
        const maxRollLoops = 50;
        while (roll.remaining_length_m > 0 && roll.status !== 'CONSUMED' && rollLoopCount < maxRollLoops) {
            rollLoopCount++;
            // Find active orders with matching MZ film grade and thickness (or compatible film in same group)
            const matchingOrders = activeOrders.filter(o => isMetallizerOrder(o) &&
                o.remaining_qty > 0.01 &&
                (0, filmCompatibilityMaster_1.areFilmsCompatible)(o.film, roll.film, rules) &&
                (o.thickness_micron === roll.thickness_micron || !o.thickness_micron));
            if (matchingOrders.length === 0)
                break;
            // Find all candidate patterns for this roll and current remaining orders
            const candidates = findMSLCandidatePatterns(roll, activeOrders, settings, rules);
            if (candidates.length === 0)
                break;
            // Pick top scoring candidate pattern
            candidates.sort((a, b) => b.score - a.score);
            const best = candidates[0];
            const planId = `plan-msl-${Date.now()}-${planCounter}`;
            const planNumber = `MSL-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(planCounter).padStart(3, '0')}`;
            planCounter++;
            const consumedLength = best.package_length_m * best.package_multiple;
            const newRemainingLength = Math.max(0, roll.remaining_length_m - consumedLength);
            const rollStatusAfter = newRemainingLength <= 0 ? 'CONSUMED' : 'PARTIALLY_CONSUMED';
            const orderAllocations = best.orders.map(item => {
                const liveOrd = activeOrders.find(o => o.id === item.order.id);
                const remBefore = liveOrd.remaining_qty;
                const remAfter = Math.max(0, Number((remBefore - item.weight_kg).toFixed(2)));
                // Update order in place
                liveOrd.remaining_qty = remAfter;
                liveOrd.produced_qty = Number((liveOrd.produced_qty + item.weight_kg).toFixed(2));
                liveOrd.status = remAfter <= 0.01 ? 'COMPLETED' : 'PARTIALLY_FULFILLED';
                return {
                    sales_order: item.order.sales_order,
                    item_number: item.order.item_number,
                    customer: item.order.customer,
                    width_mm: item.width_mm,
                    length_m: item.length_m,
                    ups: item.ups,
                    planned_reels: item.reels,
                    weight_per_reel_kg: Number((item.weight_kg / item.reels).toFixed(2)),
                    planned_weight_kg: Number(item.weight_kg.toFixed(2)),
                    remaining_before_kg: remBefore,
                    remaining_after_kg: remAfter,
                    is_closed: remAfter <= 0.01,
                };
            });
            const newPlan = {
                id: planId,
                plan_number: planNumber,
                film: roll.film,
                jumbo_roll_id: roll.roll_id,
                jumbo_roll_db_id: roll.id,
                jumbo_width_mm: roll.width_mm,
                jumbo_length_m: roll.length_m,
                thickness_micron: roll.thickness_micron,
                diameter_mm: roll.diameter_mm,
                core: roll.core || settings.core,
                ups: best.ups,
                finished_sizes: best.slit_widths,
                total_slit_width_mm: best.total_slit_width_mm,
                trim_mm: best.trim_mm,
                package_length_m: best.package_length_m,
                package_multiple: best.package_multiple,
                orders_covered: orderAllocations,
                planned_quantity_kg: Number(best.total_planned_weight_kg.toFixed(2)),
                trim_weight_kg: Number(best.trim_weight_kg.toFixed(2)),
                waste_percent: Number(best.waste_percent.toFixed(2)),
                consumed_length_m: consumedLength,
                remaining_roll_length_m: newRemainingLength,
                roll_status_after: rollStatusAfter,
                status: 'APPROVED',
                created_by: 'Planner Engine',
                created_at: new Date().toISOString(),
            };
            generatedPlans.push(newPlan);
            // Update physical roll in inventory
            roll.remaining_length_m = newRemainingLength;
            roll.remaining_quantity_kg = (0, metallizerMasterData_1.calculateJumboWeight)(roll.width_mm, roll.thickness_micron, roll.density, newRemainingLength);
            roll.status = rollStatusAfter;
            roll.consumed_by_plan = planNumber;
            roll.updated_at = new Date().toISOString();
        }
    }
    // Update complete rolls in available list
    const finalRolls = availableJumboRolls.map(r => {
        const updated = rollsPool.find(p => p.id === r.id);
        return updated || r;
    });
    return {
        plans: generatedPlans,
        remainingOrders: activeOrders,
        updatedRolls: finalRolls,
    };
}
