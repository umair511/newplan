"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateMetallizerPlans = exports.generateJumboRollRequirements = exports.generateMSLWidthCombinations = exports.isMetallizerOrder = exports.isMetallizedFilm = void 0;
exports.isSSFilm = isSSFilm;
exports.isSSOrder = isSSOrder;
exports.generateSSWidthCombinations = generateSSWidthCombinations;
exports.generateSSJumboRollRequirements = generateSSJumboRollRequirements;
exports.generateSSPlans = generateSSPlans;
const ssMasterData_1 = require("./ssMasterData");
const ssFilmCompatibilityMaster_1 = require("./ssFilmCompatibilityMaster");
/**
 * SECONDARY SLITTER (SS) FILM IDENTIFICATION
 * MZ film-code orders are EXCLUDED from SS demand/planning selection.
 * Non-MZ film codes from the shared SAP VA05 order backlog are INCLUDED in SS.
 */
function isSSFilm(filmCode) {
    if (!filmCode || typeof filmCode !== 'string')
        return false;
    const trimmed = filmCode.trim();
    if (trimmed.length === 0)
        return false;
    return !trimmed.toUpperCase().includes('MZ');
}
exports.isMetallizedFilm = isSSFilm;
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
 * SECONDARY SLITTER (SS) DEFAULT DEMAND CLASSIFICATION
 * Default SS demand includes non-MZ orders with width < 355 mm.
 * Orders with width >= 355 mm default to PS01 and are not automatically selected for SS.
 * Note: SS physically supports >= 355 mm, but < 355 mm is the default planning assignment.
 */
function isSSOrder(order) {
    if (!order)
        return false;
    return isSSFilm(order.film) && Number(order.width_mm) < 355;
}
exports.isMetallizerOrder = isSSOrder;
function generateSSWidthCombinations(uniqueWidths, maxUps = 14, maxTotalWidth = 1700, minTrim = 20) {
    const sortedWidths = uniqueWidths.slice().sort((a, b) => a - b);
    const combinations = [];
    const maxSsUps = Math.min(14, maxUps);
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
        if (currentWidths.length >= maxSsUps)
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
exports.generateMSLWidthCombinations = generateSSWidthCombinations;
function optimizeDemandPool(groupOrders, rawSettings, groupLabel, startReqCounter = 1) {
    const settings = { ...ssMasterData_1.DEFAULT_SS_SETTINGS, ...rawSettings };
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
    const maxSsUps = Math.min(14, settings.max_planning_ups || 14);
    function computeLengthFamilies(lengths, filmThickness, maxDiameterMm, configuredMultiples) {
        const sorted = Array.from(new Set(lengths)).sort((a, b) => a - b);
        const visited = new Set();
        const families = [];
        for (const len of sorted) {
            if (visited.has(len))
                continue;
            const famLens = [len];
            visited.add(len);
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
            const packLengthM = famLens[famLens.length - 1];
            const validMultiples = [];
            const maxK = Math.max(...configuredMultiples, 6);
            for (let k = 1; k <= maxK; k++) {
                const jumboLen = packLengthM * k;
                const dia = (0, ssMasterData_1.calculateJumboDiameter)(filmThickness, jumboLen);
                if (dia <= maxDiameterMm) {
                    validMultiples.push({ multiple: k, length_m: jumboLen, diameter_mm: dia });
                }
            }
            if (validMultiples.length === 0) {
                validMultiples.push({
                    multiple: 1,
                    length_m: packLengthM,
                    diameter_mm: (0, ssMasterData_1.calculateJumboDiameter)(filmThickness, packLengthM),
                });
            }
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
                const uniqueCombos = generateSSWidthCombinations(filmWidths, maxSsUps, settings.max_jumbo_width_mm, 20);
                for (const combo of uniqueCombos) {
                    const possibleCutLengths = combo.widths.map(w => {
                        const validLengths = fam.lengths.filter(L => slotMap.has(`${filmCode}__${w}__${L}`));
                        return validLengths.length > 0 ? validLengths : [fam.packLengthM];
                    });
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
                        if (uniqueLens.length > 2)
                            continue;
                        if (uniqueLens.length === 2) {
                            const lenA = uniqueLens[0];
                            const lenB = uniqueLens[1];
                            const countA = assign.filter(L => L === lenA).length;
                            const countB = assign.filter(L => L === lenB).length;
                            if (countA > 3 || countB > 3)
                                continue;
                            if (Math.abs(countA - countB) > 1)
                                continue;
                            const minL = Math.min(lenA, lenB);
                            const maxL = Math.max(lenA, lenB);
                            if (maxL !== minL * 2)
                                continue;
                        }
                        for (const testTrim of candidateTrims) {
                            const derivedJumbo = combo.sumWidth + testTrim;
                            if (derivedJumbo < 355 || derivedJumbo > settings.max_jumbo_width_mm)
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
                                    const singleReelWeightKg = (0, ssMasterData_1.calculateJumboWeight)(cutW, thickness, density, cutL);
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
                                const singleWeight = (0, ssMasterData_1.calculateJumboWeight)(derivedJumbo, thickness, density, vm.length_m);
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
    const masterCandidatePool = generateCandidatePool(orderTrackers);
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
                    const capacity = new Array(numDemandSlots).fill(0);
                    const weightPerCut = new Array(numDemandSlots).fill(0);
                    for (const tr of activeTrackers) {
                        if (tr.remainingKg <= 0.01)
                            continue;
                        const s = tr.slotIdx;
                        const spareKg = tr.maxAllowedKg - tr.allocatedKg;
                        const weightPerReel = (0, ssMasterData_1.calculateJumboWeight)(tr.order.width_mm, thickness, density, tr.pkgLength);
                        const reelsPerCut = Math.max(1, Math.round(vm.length_m / tr.pkgLength));
                        const weightForCut = weightPerReel * reelsPerCut;
                        const cutsAllowed = Math.floor((spareKg + 0.01) / weightForCut);
                        capacity[s] += Math.max(0, cutsAllowed);
                        if (weightPerCut[s] === 0)
                            weightPerCut[s] = weightForCut;
                    }
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
                    const candidatesByWidth = new Map();
                    for (const c of viableCandidates) {
                        let list = candidatesByWidth.get(c.jumboWidth);
                        if (!list) {
                            list = [];
                            candidatesByWidth.set(c.jumboWidth, list);
                        }
                        list.push(c);
                    }
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
                        if (list.length > 15) {
                            candidatesByWidth.set(width, list.slice(0, 15));
                        }
                    }
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
                    const searchPurePacks = (minTrimAllowed, maxTrimAllowed) => {
                        for (const cand of viableCandidates) {
                            for (let ups = 6; ups <= 16; ups++) {
                                const totalWeb = cand.jumboWidth * ups;
                                const trim = 10400 - totalWeb;
                                if (trim >= minTrimAllowed && trim <= maxTrimAllowed && trim >= 120 && trim <= 500) {
                                    const status = (trim >= 140 && trim <= 250) ? 'GREEN' : 'YELLOW';
                                    let maxCycles = Infinity;
                                    let canForm = true;
                                    let cyclePlannedKgPerRun = 0;
                                    for (let a = 0; a < cand.activeIndices.length; a++) {
                                        const s = cand.activeIndices[a];
                                        const needed = cand.cuts[s] * ups;
                                        if (needed === 0)
                                            continue;
                                        const cap = capacity[s];
                                        if (cap < needed) {
                                            canForm = false;
                                            break;
                                        }
                                        const cycles = Math.floor(cap / needed);
                                        if (cycles < maxCycles)
                                            maxCycles = cycles;
                                        cyclePlannedKgPerRun += weightPerCut[s] * needed;
                                    }
                                    if (canForm && maxCycles >= 1) {
                                        const repeatCycles = maxCycles;
                                        const cyclePlannedKg = cyclePlannedKgPerRun * repeatCycles;
                                        const mslTrimKg = ((cand.mslTrim / cand.jumboWidth) * cand.singleJumboWeightKg * ups) * repeatCycles;
                                        const ps01TrimKgBase = (0, ssMasterData_1.calculateJumboWeight)(trim, thickness, density, cand.jumboLengthM);
                                        const totalTrimKg = mslTrimKg + (ps01TrimKgBase * repeatCycles);
                                        let score = status === 'GREEN' ? 1000000 : 50000;
                                        score += cyclePlannedKg * 25;
                                        score += (16 - ups) * 5000; // Prefer lower UPS within 6..16
                                        score += (cand.jumboWidth / 1700) * 15000; // Prefer widths close to 1700 mm
                                        score += Math.max(0, (500 - trim) * 50);
                                        score += cand.packageMultiple * 50000;
                                        score += (cand.jumboDiameterMm / 1250) * 100000;
                                        score += repeatCycles * 3000;
                                        const wastePct = totalTrimKg > 0 ? (totalTrimKg / (cyclePlannedKg + totalTrimKg)) * 100 : 0;
                                        score -= wastePct * 100;
                                        if (score > bestSetScore) {
                                            bestSetScore = score;
                                            bestWinningSet = {
                                                candidates: Array(ups).fill(cand),
                                                ps01Ups: ups,
                                                jumboWidths: Array(ups).fill(cand.jumboWidth),
                                                totalWeb,
                                                ps01Trim: trim,
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
                    const searchMixedCombinations = (minTrimAllowed, maxTrimAllowed) => {
                        if (numUniqueWidths < 2)
                            return;
                        // Search 2-width combinations (count1 of w1 + count2 of w2 = total UPS 6..16)
                        for (let i = 0; i < numUniqueWidths; i++) {
                            const w1 = uniqueWidths[i];
                            const list1 = candidatesByWidth.get(w1);
                            for (let j = i + 1; j < numUniqueWidths; j++) {
                                const w2 = uniqueWidths[j];
                                const list2 = candidatesByWidth.get(w2);
                                for (let ups = 6; ups <= 16; ups++) {
                                    for (let c1 = 1; c1 < ups; c1++) {
                                        const c2 = ups - c1;
                                        const totalWeb = c1 * w1 + c2 * w2;
                                        const ps01Trim = 10400 - totalWeb;
                                        if (ps01Trim < minTrimAllowed || ps01Trim > maxTrimAllowed || ps01Trim < 120 || ps01Trim > 500)
                                            continue;
                                        const status = (ps01Trim >= 140 && ps01Trim <= 250) ? 'GREEN' : 'YELLOW';
                                        const baseStatusScore = status === 'GREEN' ? 1000000 : 40000;
                                        const setupPenalty = 300;
                                        const ps01TrimKgBase = (0, ssMasterData_1.calculateJumboWeight)(ps01Trim, thickness, density, list1[0].jumboLengthM);
                                        for (let idx1 = 0; idx1 < Math.min(6, list1.length); idx1++) {
                                            const cand1 = list1[idx1];
                                            for (let idx2 = 0; idx2 < Math.min(6, list2.length); idx2++) {
                                                const cand2 = list2[idx2];
                                                let maxCycles = Infinity;
                                                let canForm = true;
                                                let cyclePlannedKgPerRun = 0;
                                                const allIndices = new Set([...cand1.activeIndices, ...cand2.activeIndices]);
                                                for (const s of allIndices) {
                                                    const needed = (cand1.cuts[s] || 0) * c1 + (cand2.cuts[s] || 0) * c2;
                                                    if (needed === 0)
                                                        continue;
                                                    const cap = capacity[s];
                                                    if (cap < needed) {
                                                        canForm = false;
                                                        break;
                                                    }
                                                    const cycles = Math.floor(cap / needed);
                                                    if (cycles < maxCycles)
                                                        maxCycles = cycles;
                                                    cyclePlannedKgPerRun += weightPerCut[s] * needed;
                                                }
                                                if (canForm && maxCycles >= 1) {
                                                    const repeatCycles = maxCycles;
                                                    const cyclePlannedKg = cyclePlannedKgPerRun * repeatCycles;
                                                    const mslTrimKg = ((cand1.mslTrim / cand1.jumboWidth) * cand1.singleJumboWeightKg * c1 +
                                                        (cand2.mslTrim / cand2.jumboWidth) * cand2.singleJumboWeightKg * c2) * repeatCycles;
                                                    const totalTrimKg = mslTrimKg + (ps01TrimKgBase * repeatCycles);
                                                    const avgWidth = totalWeb / ups;
                                                    let score = baseStatusScore;
                                                    score += cyclePlannedKg * 25;
                                                    score += (16 - ups) * 5000; // Prefer minimum UPS positions (6 > 7 > ... > 16)
                                                    score += (avgWidth / 1700) * 15000; // Prefer jumbo widths close to 1700 mm
                                                    score += Math.max(0, (500 - ps01Trim) * 50);
                                                    score += cand1.packageMultiple * 50000;
                                                    score += (cand1.jumboDiameterMm / 1250) * 100000;
                                                    score += repeatCycles * 2500;
                                                    const wastePct = totalTrimKg > 0 ? (totalTrimKg / (cyclePlannedKg + totalTrimKg)) * 100 : 0;
                                                    score -= wastePct * 100;
                                                    score -= setupPenalty;
                                                    if (score > bestSetScore) {
                                                        bestSetScore = score;
                                                        const comboCands = [];
                                                        const comboWidths = [];
                                                        for (let x = 0; x < c1; x++) {
                                                            comboCands.push(cand1);
                                                            comboWidths.push(w1);
                                                        }
                                                        for (let x = 0; x < c2; x++) {
                                                            comboCands.push(cand2);
                                                            comboWidths.push(w2);
                                                        }
                                                        bestWinningSet = {
                                                            candidates: comboCands,
                                                            ps01Ups: ups,
                                                            jumboWidths: comboWidths,
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
                        }
                    };
                    searchPurePacks(140, 250);
                    searchMixedCombinations(140, 250);
                    if (!bestWinningSet || bestWinningSet.status !== 'GREEN') {
                        searchPurePacks(120, 139);
                        searchPurePacks(251, 500);
                        searchMixedCombinations(120, 139);
                        searchMixedCombinations(251, 500);
                    }
                }
            }
        };
        runSearchPass(false);
        if (!bestWinningSet) {
            runSearchPass(true);
        }
        if (!bestWinningSet)
            break;
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
                    const weightPerReel = (0, ssMasterData_1.calculateJumboWeight)(slotDef.width_mm, thickness, density, tr.pkgLength);
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
                id: `req-ss-${reqCounter++}`,
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
                ps01_parent_deckle_id: `ps01-run-ss-${iteration}`,
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
    const totalRolls = finalRequirements.reduce((sum, r) => sum + r.required_rolls_count, 0);
    const uniqueJumboWidths = Array.from(new Set(finalRequirements.map(r => r.required_jumbo_width_mm)));
    const totalPlannedKg = finalRequirements.reduce((sum, r) => sum + r.total_weight_kg, 0);
    const totalTrimKg = finalRequirements.reduce((sum, r) => {
        const trimFraction = (r.expected_trim_mm || 0) / r.required_jumbo_width_mm;
        return sum + (r.total_weight_kg * trimFraction);
    }, 0);
    const avgWaste = totalPlannedKg > 0 ? (totalTrimKg / totalPlannedKg) * 100 : 0;
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
            ps01_3ups_count: 0,
            ps01_4ups_count: 0,
            max_jumbo_length_m: maxJumboLen,
            is_fully_feasible: finalRequirements.every(r => r.ps01_feasibility?.is_feasible && r.ps01_feasibility.status !== 'RED'),
            score: totalScore,
            reason: `${finalRequirements.length} plan(s), ${totalRolls} roll(s), all PS01 patterns feasible (6–16 UPS)`,
        },
    };
}
function generateSSJumboRollRequirements(orders, settings, selectedFilm, options) {
    const rules = options?.compatibilityRules || ssFilmCompatibilityMaster_1.DEFAULT_FILM_COMPATIBILITY_RULES;
    const forceStrategy = options?.forceStrategy || 'AUTO';
    const onProgress = options?.onProgress;
    onProgress?.(10, 'Filtering secondary slitter orders & analyzing film compatibility...');
    let pending = orders.filter(o => isSSOrder(o) && o.remaining_qty > 0.01);
    if (pending.length === 0) {
        onProgress?.(100, 'No pending secondary slitter orders found');
        return [];
    }
    let targetFilms = [];
    if (selectedFilm && selectedFilm !== 'ALL') {
        targetFilms = (0, ssFilmCompatibilityMaster_1.getCompatibleFilmsFor)(selectedFilm, rules);
        pending = pending.filter(o => targetFilms.includes(o.film));
    }
    if (pending.length === 0) {
        onProgress?.(100, 'No matching pending orders for target film');
        return [];
    }
    const allFilmsInPending = Array.from(new Set(pending.map(o => o.film)));
    const compatibleGroups = (0, ssFilmCompatibilityMaster_1.getAllCompatibleGroups)(allFilmsInPending, rules);
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
        if (group.films.length <= 1 || !group.is_combined_eligible || forceStrategy === 'SEPARATE') {
            const result = optimizeDemandPool(groupOrders, settings, group.group_name, globalReqCounter);
            finalRequirements.push(...result.requirements);
            globalReqCounter += result.requirements.length;
            continue;
        }
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
        const optionBRes = optimizeDemandPool(groupOrders, settings, group.group_name, globalReqCounter);
        const optionBTotalScore = optionBRes.score;
        const optionBReqs = optionBRes.requirements;
        let selectCombined = false;
        if (forceStrategy === 'COMBINED') {
            selectCombined = true;
        }
        else {
            const optAFulfilledKg = optionAReqs.reduce((sum, r) => sum + r.total_weight_kg, 0);
            const optBFulfilledKg = optionBReqs.reduce((sum, r) => sum + r.total_weight_kg, 0);
            if (group.preference === 'PREFER_COMBINED' && optionBRes.evaluation.is_fully_feasible && optionBReqs.length > 0) {
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
exports.generateJumboRollRequirements = generateSSJumboRollRequirements;
function findSSCandidatePatterns(roll, activeOrders, settings, rules = ssFilmCompatibilityMaster_1.DEFAULT_FILM_COMPATIBILITY_RULES) {
    const matchingOrders = activeOrders.filter(o => isSSOrder(o) &&
        o.remaining_qty > 0.01 &&
        (0, ssFilmCompatibilityMaster_1.areFilmsCompatible)(o.film, roll.film, rules) &&
        (o.thickness_micron === roll.thickness_micron || !o.thickness_micron));
    if (matchingOrders.length === 0 || roll.remaining_length_m <= 0)
        return [];
    const candidates = [];
    const maxUps = Math.min(14, settings.max_planning_ups || 14);
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
                const totalWeight = (0, ssMasterData_1.calculateJumboWeight)(ord.width_mm, roll.thickness_micron, roll.density, pkgLength) * totalReels;
                if (totalWeight > ord.remaining_qty * 1.03)
                    continue;
                const totalRollWeight = (0, ssMasterData_1.calculateJumboWeight)(roll.width_mm, roll.thickness_micron, roll.density, pkgLength * multiple);
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
                for (let u1 = 1; u1 <= maxUps - 1; u1++) {
                    for (let u2 = 1; u2 <= maxUps - u1; u2++) {
                        const totalUps = u1 + u2;
                        if (totalUps > maxUps)
                            continue;
                        const totalWidth = o1.width_mm * u1 + o2.width_mm * u2;
                        const trim = roll.width_mm - totalWidth;
                        if (trim >= settings.min_trim_mm && trim <= roll.width_mm * 0.15) {
                            const o1Reels = u1 * multiple * Math.floor(lcmLen / len1);
                            const o2Reels = u2 * multiple * Math.floor(lcmLen / len2);
                            const order1Weight = (0, ssMasterData_1.calculateJumboWeight)(o1.width_mm, roll.thickness_micron, roll.density, len1) * o1Reels;
                            const order2Weight = (0, ssMasterData_1.calculateJumboWeight)(o2.width_mm, roll.thickness_micron, roll.density, len2) * o2Reels;
                            if (order1Weight > o1.remaining_qty * 1.03 || order2Weight > o2.remaining_qty * 1.03)
                                continue;
                            const totalWeight = order1Weight + order2Weight;
                            const totalRollWeight = (0, ssMasterData_1.calculateJumboWeight)(roll.width_mm, roll.thickness_micron, roll.density, lcmLen * multiple);
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
                        const w1 = (0, ssMasterData_1.calculateJumboWeight)(o1.width_mm, roll.thickness_micron, roll.density, len1) * r1;
                        const w2 = (0, ssMasterData_1.calculateJumboWeight)(o2.width_mm, roll.thickness_micron, roll.density, len2) * r2;
                        const w3 = (0, ssMasterData_1.calculateJumboWeight)(o3.width_mm, roll.thickness_micron, roll.density, len3) * r3;
                        if (w1 > o1.remaining_qty * 1.03 || w2 > o2.remaining_qty * 1.03 || w3 > o3.remaining_qty * 1.03)
                            continue;
                        const totalWeight = w1 + w2 + w3;
                        const totalRollWeight = (0, ssMasterData_1.calculateJumboWeight)(roll.width_mm, roll.thickness_micron, roll.density, lcmLen * multiple);
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
function generateSSPlans(orders, availableJumboRolls, rawSettings, selectedFilm, rules = ssFilmCompatibilityMaster_1.DEFAULT_FILM_COMPATIBILITY_RULES) {
    const settings = { ...ssMasterData_1.DEFAULT_SS_SETTINGS, ...rawSettings };
    let usableRolls = availableJumboRolls.filter(r => isSSFilm(r.film) &&
        (r.status === 'AVAILABLE' || r.status === 'PARTIALLY_CONSUMED') &&
        r.remaining_length_m > 0 &&
        r.width_mm <= settings.max_jumbo_width_mm &&
        r.diameter_mm <= settings.max_jumbo_diameter_mm);
    if (selectedFilm && selectedFilm !== 'ALL') {
        const compatibleFilms = (0, ssFilmCompatibilityMaster_1.getCompatibleFilmsFor)(selectedFilm, rules);
        usableRolls = usableRolls.filter(r => compatibleFilms.includes(r.film));
    }
    if (usableRolls.length === 0) {
        return { plans: [], remainingOrders: orders, updatedRolls: availableJumboRolls };
    }
    const activeOrders = orders.map(o => ({ ...o }));
    const rollsPool = usableRolls.map(r => ({ ...r }));
    const generatedPlans = [];
    let planCounter = 1;
    for (const roll of rollsPool) {
        let rollLoopCount = 0;
        const maxRollLoops = 50;
        while (roll.remaining_length_m > 0 && roll.status !== 'CONSUMED' && rollLoopCount < maxRollLoops) {
            rollLoopCount++;
            const matchingOrders = activeOrders.filter(o => isSSOrder(o) &&
                o.remaining_qty > 0.01 &&
                (0, ssFilmCompatibilityMaster_1.areFilmsCompatible)(o.film, roll.film, rules) &&
                (o.thickness_micron === roll.thickness_micron || !o.thickness_micron));
            if (matchingOrders.length === 0)
                break;
            const candidates = findSSCandidatePatterns(roll, activeOrders, settings, rules);
            if (candidates.length === 0)
                break;
            candidates.sort((a, b) => b.score - a.score);
            const best = candidates[0];
            const planId = `plan-ss-${Date.now()}-${planCounter}`;
            const planNumber = `SS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(planCounter).padStart(3, '0')}`;
            planCounter++;
            const consumedLength = best.package_length_m * best.package_multiple;
            const newRemainingLength = Math.max(0, roll.remaining_length_m - consumedLength);
            const rollStatusAfter = newRemainingLength <= 0 ? 'CONSUMED' : 'PARTIALLY_CONSUMED';
            const orderAllocations = best.orders.map(item => {
                const liveOrd = activeOrders.find(o => o.id === item.order.id);
                const remBefore = liveOrd.remaining_qty;
                const remAfter = Math.max(0, Number((remBefore - item.weight_kg).toFixed(2)));
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
            roll.remaining_length_m = newRemainingLength;
            roll.remaining_quantity_kg = (0, ssMasterData_1.calculateJumboWeight)(roll.width_mm, roll.thickness_micron, roll.density, newRemainingLength);
            roll.status = rollStatusAfter;
            roll.consumed_by_plan = planNumber;
            roll.updated_at = new Date().toISOString();
        }
    }
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
exports.generateMetallizerPlans = generateSSPlans;
