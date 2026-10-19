"use strict";
/**
 * GPAK Primary Slitter 1 (PS01) Master Deckle Optimization Engine
 * Authoritative Implementation conforming to SRS V3.2:
 * - 10,400 mm Mother Deckle
 * - Normal Trim: 140 mm – 250 mm (Usable Slit Width: 10,150 mm – 10,260 mm)
 * - 16 Physical Arms (Side A: 1–8, Side B: 9–16) with Duplex Balance |UPS_A - UPS_B| <= 1
 * - Global Target Ceiling: TargetKg * 1.03 (Hard Ceiling)
 * - Elastic Pack-Count Evaluation (NaturalMax -> NaturalMax-1 -> ... -> 1)
 * - Deterministic Bounded Combinatorial Search with Mathematical Pruning
 * - Distinct Multi-Order Allocation for Identical Widths
 * - Fixed Physical Arm Identity Dynamic Replacement ("Bare se Chote")
 * - Governed Residual Planning Loop without Silent Trim Relaxation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatPositionLabel = formatPositionLabel;
exports.isPlanLengthCompatible = isPlanLengthCompatible;
exports.assignDuplexStations = assignDuplexStations;
exports.generateValidWidthCombinations = generateValidWidthCombinations;
exports.findInitialSameLengthDeckles = findInitialSameLengthDeckles;
exports.findDuplexDualLengthDeckles = findDuplexDualLengthDeckles;
exports.findDuplexDualCoreDeckles = findDuplexDualCoreDeckles;
exports.findInitialMixedLengthDeckles = findInitialMixedLengthDeckles;
exports.simulateMultiPackExecution = simulateMultiPackExecution;
exports.normalizeTreatmentGroup = normalizeTreatmentGroup;
exports.generatePrimarySlitterPlans = generatePrimarySlitterPlans;
const weightCalculator_1 = require("../weightCalculator");
const masterData_1 = require("../masterData");
/**
 * Format an array of position numbers into readable ranges (e.g. [1,2,3,4] -> "1–4", [1,3,5] -> "1, 3, 5")
 */
function formatPositionLabel(positions) {
    if (positions.length === 0)
        return '-';
    if (positions.length === 1)
        return `${positions[0]}`;
    const sorted = [...positions].sort((a, b) => a - b);
    let isSequential = true;
    for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i + 1] !== sorted[i] + 1) {
            isSequential = false;
            break;
        }
    }
    if (isSequential) {
        return `${sorted[0]}–${sorted[sorted.length - 1]}`;
    }
    return sorted.join(', ');
}
/**
 * PS01 Hard Physical Rule: Length Compatibility
 * - Maximum 2 distinct roll lengths in any single plan.
 * - If 2 lengths exist (Short L, Long 2L), Long must be EXACTLY 2 * Short.
 * - 3 or more distinct lengths is strictly prohibited.
 */
function isPlanLengthCompatible(lengths) {
    const validLengths = lengths.filter((l) => typeof l === 'number' && l > 0);
    const distinct = Array.from(new Set(validLengths));
    if (distinct.length <= 1)
        return true;
    if (distinct.length === 2) {
        const sorted = distinct.sort((a, b) => a - b);
        const shortLen = sorted[0];
        const longLen = sorted[1];
        // Exact 1:2 ratio with 0.001 floating point tolerance
        return Math.abs(longLen - 2 * shortLen) < 0.001;
    }
    return false;
}
/**
 * Assign and balance duplex rewind stations (Side A: Station 1 / Arms 1–8 vs Side B: Station 2 / Arms 9–16)
 * Enforces: Side A <= 8 arms, Side B <= 8 arms, and |Side A UPS - Side B UPS| <= 1.
 */
function assignDuplexStations(items) {
    const totalUps = items.reduce((sum, it) => sum + it.ups, 0);
    if (totalUps < 2 || totalUps > 16) {
        return { success: false, items, sideAUps: 0, sideBUps: 0, isDualCore: false, isDualLength: false };
    }
    const hasPreAssignedStations = items.some(it => it.station === 'SIDE_A') && items.some(it => it.station === 'SIDE_B');
    if (hasPreAssignedStations) {
        const sideAItems = items.filter(it => it.station === 'SIDE_A');
        const sideBItems = items.filter(it => it.station === 'SIDE_B');
        const sideAUps = sideAItems.reduce((sum, it) => sum + it.ups, 0);
        const sideBUps = sideBItems.reduce((sum, it) => sum + it.ups, 0);
        if (sideAUps <= 8 && sideBUps <= 8 && Math.abs(sideAUps - sideBUps) <= 1) {
            let currentPos = 1;
            const finalItems = [];
            sideAItems.forEach(it => {
                const positions = [];
                for (let u = 0; u < it.ups; u++)
                    positions.push(currentPos++);
                finalItems.push({
                    ...it,
                    station: 'SIDE_A',
                    positions,
                    position_label: formatPositionLabel(positions),
                });
            });
            sideBItems.forEach(it => {
                const positions = [];
                for (let u = 0; u < it.ups; u++)
                    positions.push(currentPos++);
                finalItems.push({
                    ...it,
                    station: 'SIDE_B',
                    positions,
                    position_label: formatPositionLabel(positions),
                });
            });
            const distinctCoresA = Array.from(new Set(sideAItems.map(it => it.core)));
            const distinctCoresB = Array.from(new Set(sideBItems.map(it => it.core)));
            const isDualCore = distinctCoresA.length === 1 && distinctCoresB.length === 1 && distinctCoresA[0] !== distinctCoresB[0];
            const distinctLengthsA = Array.from(new Set(sideAItems.map(it => it.length)));
            const distinctLengthsB = Array.from(new Set(sideBItems.map(it => it.length)));
            if (distinctLengthsA.length > 1 || distinctLengthsB.length > 1) {
                return { success: false, items, sideAUps: 0, sideBUps: 0, isDualCore: false, isDualLength: false };
            }
            if (!isPlanLengthCompatible([...distinctLengthsA, ...distinctLengthsB])) {
                return { success: false, items, sideAUps: 0, sideBUps: 0, isDualCore: false, isDualLength: false };
            }
            const isDualLength = distinctLengthsA.length === 1 && distinctLengthsB.length === 1 && distinctLengthsA[0] !== distinctLengthsB[0];
            return {
                success: true,
                items: finalItems,
                sideAUps,
                sideBUps,
                isDualCore,
                isDualLength,
                sideACore: distinctCoresA[0],
                sideBCore: distinctCoresB[0],
                sideALength: distinctLengthsA[0],
                sideBLength: distinctLengthsB[0],
            };
        }
    }
    // Target: sideAUps = Math.ceil(totalUps / 2), sideBUps = Math.floor(totalUps / 2)
    const targetSideAUps = Math.ceil(totalUps / 2);
    const targetSideBUps = Math.floor(totalUps / 2);
    if (targetSideAUps > 8 || targetSideBUps > 8) {
        return { success: false, items, sideAUps: 0, sideBUps: 0, isDualCore: false, isDualLength: false };
    }
    const unrolledUnits = [];
    items.forEach((it, idx) => {
        for (let u = 0; u < it.ups; u++) {
            unrolledUnits.push({ item: it, index: idx });
        }
    });
    const distinctCores = Array.from(new Set(items.map(it => it.core)));
    const distinctLengths = Array.from(new Set(items.map(it => it.length)));
    if (!isPlanLengthCompatible(distinctLengths)) {
        return { success: false, items, sideAUps: 0, sideBUps: 0, isDualCore: false, isDualLength: false };
    }
    if (distinctCores.length === 2) {
        const coreA = distinctCores[0];
        const coreB = distinctCores[1];
        const unitsA = unrolledUnits.filter(u => u.item.core === coreA);
        const unitsB = unrolledUnits.filter(u => u.item.core === coreB);
        if (unitsA.length <= 8 && unitsB.length <= 8 && Math.abs(unitsA.length - unitsB.length) <= 1) {
            let currentPos = 1;
            const remappedItems = [];
            items.filter(it => it.core === coreA).forEach(it => {
                const positions = [];
                for (let u = 0; u < it.ups; u++)
                    positions.push(currentPos++);
                remappedItems.push({
                    ...it,
                    station: 'SIDE_A',
                    positions,
                    position_label: formatPositionLabel(positions),
                });
            });
            items.filter(it => it.core === coreB).forEach(it => {
                const positions = [];
                for (let u = 0; u < it.ups; u++)
                    positions.push(currentPos++);
                remappedItems.push({
                    ...it,
                    station: 'SIDE_B',
                    positions,
                    position_label: formatPositionLabel(positions),
                });
            });
            return {
                success: true,
                items: remappedItems,
                sideAUps: unitsA.length,
                sideBUps: unitsB.length,
                isDualCore: true,
                isDualLength: distinctLengths.length > 1,
                sideACore: coreA,
                sideBCore: coreB,
            };
        }
    }
    if (distinctLengths.length === 2) {
        const lenA = distinctLengths[0];
        const lenB = distinctLengths[1];
        if (!isPlanLengthCompatible([lenA, lenB])) {
            return { success: false, items, sideAUps: 0, sideBUps: 0, isDualCore: false, isDualLength: false };
        }
        const unitsA = unrolledUnits.filter(u => u.item.length === lenA);
        const unitsB = unrolledUnits.filter(u => u.item.length === lenB);
        if (unitsA.length <= 8 && unitsB.length <= 8 && Math.abs(unitsA.length - unitsB.length) <= 1) {
            let currentPos = 1;
            const remappedItems = [];
            items.filter(it => it.length === lenA).forEach(it => {
                const positions = [];
                for (let u = 0; u < it.ups; u++)
                    positions.push(currentPos++);
                remappedItems.push({
                    ...it,
                    station: 'SIDE_A',
                    positions,
                    position_label: formatPositionLabel(positions),
                });
            });
            items.filter(it => it.length === lenB).forEach(it => {
                const positions = [];
                for (let u = 0; u < it.ups; u++)
                    positions.push(currentPos++);
                remappedItems.push({
                    ...it,
                    station: 'SIDE_B',
                    positions,
                    position_label: formatPositionLabel(positions),
                });
            });
            return {
                success: true,
                items: remappedItems,
                sideAUps: unitsA.length,
                sideBUps: unitsB.length,
                isDualCore: distinctCores.length > 1,
                isDualLength: true,
                sideALength: lenA,
                sideBLength: lenB,
            };
        }
    }
    let assignedA = 0;
    let currentPos = 1;
    const remappedItems = [];
    items.forEach(it => {
        const itemUps = it.ups;
        if (assignedA + itemUps <= targetSideAUps) {
            const positions = [];
            for (let u = 0; u < itemUps; u++)
                positions.push(currentPos++);
            assignedA += itemUps;
            remappedItems.push({
                ...it,
                station: 'SIDE_A',
                positions,
                position_label: formatPositionLabel(positions),
            });
        }
        else if (assignedA >= targetSideAUps) {
            const positions = [];
            for (let u = 0; u < itemUps; u++)
                positions.push(currentPos++);
            remappedItems.push({
                ...it,
                station: 'SIDE_B',
                positions,
                position_label: formatPositionLabel(positions),
            });
        }
        else {
            const upsForA = targetSideAUps - assignedA;
            const upsForB = itemUps - upsForA;
            const posA = [];
            for (let u = 0; u < upsForA; u++)
                posA.push(currentPos++);
            assignedA += upsForA;
            remappedItems.push({
                ...it,
                ups: upsForA,
                station: 'SIDE_A',
                positions: posA,
                position_label: formatPositionLabel(posA),
            });
            const posB = [];
            for (let u = 0; u < upsForB; u++)
                posB.push(currentPos++);
            remappedItems.push({
                ...it,
                ups: upsForB,
                station: 'SIDE_B',
                positions: posB,
                position_label: formatPositionLabel(posB),
            });
        }
    });
    return {
        success: true,
        items: remappedItems,
        sideAUps: targetSideAUps,
        sideBUps: targetSideBUps,
        isDualCore: false,
        isDualLength: false,
        sideACore: items[0]?.core,
        sideBCore: items[0]?.core,
        sideALength: items[0]?.length,
        sideBLength: items[0]?.length,
    };
}
/**
 * Deterministic Bounded Combinatorial Deckle Search with Multi-Objective Dominance Pruning.
 * Generates mathematically valid width combinations within [minSlitWidth, maxSlitWidth].
 * Employs branch-and-bound with mathematical pruning based on knife capacity and min/max widths.
 * Retains a diverse, non-dominated candidate pool across trim buckets and UPS arm counts.
 */
function generateValidWidthCombinations(distinctWidthsDesc, minSlitWidth, maxSlitWidth, minUps = 3, maxUps = 16, maxTotalPatterns = 2500, minIndividualWidth = 355) {
    // Hard physical constraint: filter out any individual slit width < 355 mm
    const validWidthsDesc = distinctWidthsDesc.filter(w => w >= minIndividualWidth);
    if (validWidthsDesc.length === 0)
        return [];
    const maxWidth = validWidthsDesc[0];
    const minWidth = validWidthsDesc[validWidthsDesc.length - 1];
    // Bucket candidates by (UPS arm count, Trim bin) to guarantee diversity across knife setups and trim levels
    // Trim bins: 0 = Nominal (180–192mm trim), 1 = Standard tight (140–180mm), 2 = Standard loose (192–250mm)
    const bucketMap = new Map();
    const maxPerBucket = Math.max(35, Math.ceil(maxTotalPatterns / 30));
    function getBucketKey(ups, totalWidth) {
        const trim = 10400 - totalWidth;
        let trimBin = 1;
        if (trim >= 180 && trim <= 192)
            trimBin = 0;
        else if (trim > 192)
            trimBin = 2;
        return `${ups}-${trimBin}`;
    }
    function bnbSearch(startIndex, currentCombo, currentWidth, currentUps) {
        if (currentUps > maxUps || currentWidth > maxSlitWidth)
            return;
        if (currentUps >= minUps && currentWidth >= minSlitWidth && currentWidth <= maxSlitWidth) {
            const bucketKey = getBucketKey(currentUps, currentWidth);
            let bucket = bucketMap.get(bucketKey);
            if (!bucket) {
                bucket = [];
                bucketMap.set(bucketKey, bucket);
            }
            const trimDev = Math.abs(currentWidth - 10214);
            const distinctCount = new Set(currentCombo).size;
            // Multi-objective score: lower trim deviation + bonus for width diversity
            const score = trimDev - distinctCount * 3;
            if (bucket.length < maxPerBucket) {
                bucket.push({ widthCombo: [...currentCombo], totalWidth: currentWidth, score });
            }
            else {
                // In-place dominance replacement: replace worst candidate in bucket if current is strictly better
                let worstIdx = 0;
                let worstScore = bucket[0].score;
                for (let i = 1; i < bucket.length; i++) {
                    if (bucket[i].score > worstScore) {
                        worstScore = bucket[i].score;
                        worstIdx = i;
                    }
                }
                if (score < worstScore) {
                    bucket[worstIdx] = { widthCombo: [...currentCombo], totalWidth: currentWidth, score };
                }
            }
        }
        if (currentUps >= maxUps)
            return;
        const remainingArms = maxUps - currentUps;
        if (currentWidth + maxWidth * remainingArms < minSlitWidth)
            return;
        if (currentWidth + minWidth * 1 > maxSlitWidth)
            return;
        for (let i = startIndex; i < validWidthsDesc.length; i++) {
            const w = validWidthsDesc[i];
            if (currentWidth + w <= maxSlitWidth) {
                currentCombo.push(w);
                bnbSearch(i, currentCombo, currentWidth + w, currentUps + 1);
                currentCombo.pop();
            }
        }
    }
    bnbSearch(0, [], 0, 0);
    const allPatterns = [];
    bucketMap.forEach(bucket => {
        allPatterns.push(...bucket);
    });
    return allPatterns
        .sort((a, b) => {
        if (a.score !== b.score)
            return a.score - b.score;
        const devA = Math.abs(a.totalWidth - 10214);
        const devB = Math.abs(b.totalWidth - 10214);
        if (devA !== devB)
            return devA - devB;
        return a.widthCombo.length - b.widthCombo.length;
    })
        .slice(0, maxTotalPatterns)
        .map(p => ({ widthCombo: p.widthCombo, totalWidth: p.totalWidth }));
}
/**
 * Stage 1: Find all feasible deckle combinations using SAME-LENGTH orders
 * Multi-Order mapping: For widths shared by multiple distinct SO# / Items,
 * generates distinct non-dominated allocation candidates (closing smaller orders, priority orders first).
 */
function findInitialSameLengthDeckles(eligibleOrders, minTrim, maxTrim, minUps, maxUps, deckleWidth, targetLength, maxCandidatePool = 2500) {
    const lengthOrders = eligibleOrders
        .filter(o => o.remaining_qty > 0.01 && o.length_m === targetLength && o.width_mm >= 355)
        .sort((a, b) => b.width_mm - a.width_mm);
    if (lengthOrders.length === 0)
        return [];
    const distinctWidths = Array.from(new Set(lengthOrders.map(o => o.width_mm))).sort((a, b) => b - a);
    const minSlitWidth = deckleWidth - maxTrim; // e.g. 10400 - 250 = 10150 mm
    const maxSlitWidth = deckleWidth - minTrim; // e.g. 10400 - 140 = 10260 mm
    const validPatterns = generateValidWidthCombinations(distinctWidths, minSlitWidth, maxSlitWidth, minUps, maxUps, maxCandidatePool);
    const concreteCombinations = [];
    validPatterns.forEach(pat => {
        const widthCounts = new Map();
        pat.widthCombo.forEach(w => widthCounts.set(w, (widthCounts.get(w) || 0) + 1));
        // Variant 1: Order closure / Small balance first (prioritizes closing orders)
        let pos1 = 1;
        const itemsClosure = [];
        let possible1 = true;
        for (const [w, neededUps] of Array.from(widthCounts.entries())) {
            const matchingOrders = lengthOrders
                .filter(o => o.width_mm === w)
                .sort((a, b) => {
                if (a.priority !== b.priority)
                    return (b.priority ? 1 : 0) - (a.priority ? 1 : 0);
                return a.remaining_qty - b.remaining_qty; // Smallest demand first to close orders
            });
            if (matchingOrders.length === 0) {
                possible1 = false;
                break;
            }
            let assignedUps = 0;
            for (const ord of matchingOrders) {
                if (assignedUps >= neededUps)
                    break;
                const upsToAssign = Math.min(neededUps - assignedUps, Math.max(1, Math.floor((ord.remaining_qty) / ((0, weightCalculator_1.calculateSingleReelWeight)(w, ord.thickness_micron || 20, ord.density || 0.91, ord.length_m) || 1)) || 1));
                const actualUps = Math.min(neededUps - assignedUps, upsToAssign);
                const positions = [];
                for (let u = 0; u < actualUps; u++)
                    positions.push(pos1++);
                itemsClosure.push({
                    orderId: ord.id,
                    salesOrder: ord.sales_order,
                    itemNumber: ord.item_number,
                    customer: ord.customer,
                    film: ord.film,
                    width: ord.width_mm,
                    length: ord.length_m,
                    ups: actualUps,
                    positions,
                    position_label: formatPositionLabel(positions),
                    core: ord.core,
                    treatment_side: ord.treatment_side,
                });
                assignedUps += actualUps;
            }
            if (assignedUps < neededUps) {
                const fallbackOrd = matchingOrders[0];
                const diff = neededUps - assignedUps;
                const positions = [];
                for (let u = 0; u < diff; u++)
                    positions.push(pos1++);
                itemsClosure.push({
                    orderId: fallbackOrd.id,
                    salesOrder: fallbackOrd.sales_order,
                    itemNumber: fallbackOrd.item_number,
                    customer: fallbackOrd.customer,
                    film: fallbackOrd.film,
                    width: fallbackOrd.width_mm,
                    length: fallbackOrd.length_m,
                    ups: diff,
                    positions,
                    position_label: formatPositionLabel(positions),
                    core: fallbackOrd.core,
                    treatment_side: fallbackOrd.treatment_side,
                });
            }
        }
        if (possible1 && itemsClosure.length > 0) {
            concreteCombinations.push(itemsClosure);
        }
        // Variant 2: High Demand / Largest Volume Assignment
        let pos2 = 1;
        const itemsVolume = [];
        let possible2 = true;
        for (const [w, neededUps] of Array.from(widthCounts.entries())) {
            const matchingOrders = lengthOrders
                .filter(o => o.width_mm === w)
                .sort((a, b) => {
                if (a.priority !== b.priority)
                    return (b.priority ? 1 : 0) - (a.priority ? 1 : 0);
                return b.remaining_qty - a.remaining_qty; // Largest demand first
            });
            if (matchingOrders.length === 0) {
                possible2 = false;
                break;
            }
            const primaryOrd = matchingOrders[0];
            const positions = [];
            for (let u = 0; u < neededUps; u++)
                positions.push(pos2++);
            itemsVolume.push({
                orderId: primaryOrd.id,
                salesOrder: primaryOrd.sales_order,
                itemNumber: primaryOrd.item_number,
                customer: primaryOrd.customer,
                film: primaryOrd.film,
                width: primaryOrd.width_mm,
                length: primaryOrd.length_m,
                ups: neededUps,
                positions,
                position_label: formatPositionLabel(positions),
                core: primaryOrd.core,
                treatment_side: primaryOrd.treatment_side,
            });
        }
        if (possible2 && itemsVolume.length > 0) {
            concreteCombinations.push(itemsVolume);
        }
    });
    return concreteCombinations.slice(0, maxCandidatePool * 2);
}
/**
 * Stage 2: Dual-Length Duplex Optimization
 * Validates integer synchronization: nA * LA == nB * LB for positive integers nA, nB.
 * Side A <= 8 arms @ LA, Side B <= 8 arms @ LB, |Side A UPS - Side B UPS| <= 1.
 */
function findDuplexDualLengthDeckles(eligibleOrders, minTrim, maxTrim, deckleWidth, lengthA, lengthB) {
    // Hard physical rule: PS01 dual-length must follow exact 1:2 ratio (Short = L, Long = 2L)
    if (!isPlanLengthCompatible([lengthA, lengthB])) {
        return [];
    }
    // Integer synchronization check: nA * lengthA == nB * lengthB
    const maxMultiplier = 8;
    let isSynchronized = false;
    for (let nA = 1; nA <= maxMultiplier; nA++) {
        for (let nB = 1; nB <= maxMultiplier; nB++) {
            if (nA * lengthA === nB * lengthB) {
                isSynchronized = true;
                break;
            }
        }
        if (isSynchronized)
            break;
    }
    if (!isSynchronized)
        return [];
    const ordersA = eligibleOrders
        .filter(o => o.remaining_qty > 0.01 && o.length_m === lengthA && o.width_mm >= 355)
        .sort((a, b) => b.width_mm - a.width_mm);
    const ordersB = eligibleOrders
        .filter(o => o.remaining_qty > 0.01 && o.length_m === lengthB && o.width_mm >= 355)
        .sort((a, b) => b.width_mm - a.width_mm);
    if (ordersA.length === 0 || ordersB.length === 0)
        return [];
    const widthsA = Array.from(new Set(ordersA.map(o => o.width_mm))).sort((a, b) => b - a);
    const widthsB = Array.from(new Set(ordersB.map(o => o.width_mm))).sort((a, b) => b - a);
    const minSlitWidth = deckleWidth - maxTrim;
    const maxSlitWidth = deckleWidth - minTrim;
    // Sub-combos Side A (2..8 arms, bounded to top 300 diverse non-dominated combos)
    const combosA = [];
    function searchA(startIndex, current, currentW, ups) {
        if (combosA.length >= 300)
            return;
        if (ups >= 2 && ups <= 8 && currentW <= maxSlitWidth) {
            combosA.push({ widths: [...current], totalWidth: currentW, ups });
        }
        if (ups >= 8)
            return;
        for (let i = startIndex; i < widthsA.length; i++) {
            if (currentW + widthsA[i] <= maxSlitWidth) {
                current.push(widthsA[i]);
                searchA(i, current, currentW + widthsA[i], ups + 1);
                current.pop();
            }
        }
    }
    searchA(0, [], 0, 0);
    // Sub-combos Side B (2..8 arms, bounded to top 300 diverse non-dominated combos)
    const combosB = [];
    function searchB(startIndex, current, currentW, ups) {
        if (combosB.length >= 300)
            return;
        if (ups >= 2 && ups <= 8 && currentW <= maxSlitWidth) {
            combosB.push({ widths: [...current], totalWidth: currentW, ups });
        }
        if (ups >= 8)
            return;
        for (let i = startIndex; i < widthsB.length; i++) {
            if (currentW + widthsB[i] <= maxSlitWidth) {
                current.push(widthsB[i]);
                searchB(i, current, currentW + widthsB[i], ups + 1);
                current.pop();
            }
        }
    }
    searchB(0, [], 0, 0);
    const balancedDeckles = [];
    for (const cA of combosA) {
        for (const cB of combosB) {
            if (balancedDeckles.length >= 500)
                break;
            if (Math.abs(cA.ups - cB.ups) > 1)
                continue;
            const combinedWidth = cA.totalWidth + cB.totalWidth;
            if (combinedWidth >= minSlitWidth && combinedWidth <= maxSlitWidth) {
                let pos = 1;
                const mappedItemsA = [];
                const widthMapA = new Map();
                cA.widths.forEach(w => widthMapA.set(w, (widthMapA.get(w) || 0) + 1));
                let validA = true;
                for (const [w, neededUps] of Array.from(widthMapA.entries())) {
                    const matchOrd = ordersA.find(o => o.width_mm === w);
                    if (!matchOrd) {
                        validA = false;
                        break;
                    }
                    const positions = [];
                    for (let u = 0; u < neededUps; u++)
                        positions.push(pos++);
                    mappedItemsA.push({
                        orderId: matchOrd.id,
                        salesOrder: matchOrd.sales_order,
                        itemNumber: matchOrd.item_number,
                        customer: matchOrd.customer,
                        film: matchOrd.film,
                        width: matchOrd.width_mm,
                        length: matchOrd.length_m,
                        ups: neededUps,
                        positions,
                        position_label: formatPositionLabel(positions),
                        station: 'SIDE_A',
                        core: matchOrd.core,
                        treatment_side: matchOrd.treatment_side,
                    });
                }
                if (!validA)
                    continue;
                const mappedItemsB = [];
                const widthMapB = new Map();
                cB.widths.forEach(w => widthMapB.set(w, (widthMapB.get(w) || 0) + 1));
                let validB = true;
                for (const [w, neededUps] of Array.from(widthMapB.entries())) {
                    const matchOrd = ordersB.find(o => o.width_mm === w);
                    if (!matchOrd) {
                        validB = false;
                        break;
                    }
                    const positions = [];
                    for (let u = 0; u < neededUps; u++)
                        positions.push(pos++);
                    mappedItemsB.push({
                        orderId: matchOrd.id,
                        salesOrder: matchOrd.sales_order,
                        itemNumber: matchOrd.item_number,
                        customer: matchOrd.customer,
                        film: matchOrd.film,
                        width: matchOrd.width_mm,
                        length: matchOrd.length_m,
                        ups: neededUps,
                        positions,
                        position_label: formatPositionLabel(positions),
                        station: 'SIDE_B',
                        core: matchOrd.core,
                        treatment_side: matchOrd.treatment_side,
                    });
                }
                if (!validB)
                    continue;
                balancedDeckles.push([...mappedItemsA, ...mappedItemsB]);
            }
        }
    }
    return balancedDeckles;
}
/**
 * Stage 3: Dual-Core Duplex Optimization (Side A @ 3" Core vs Side B @ 6" Core)
 * Side A <= 8 arms @ 3", Side B <= 8 arms @ 6", |Side A UPS - Side B UPS| <= 1.
 */
function findDuplexDualCoreDeckles(eligibleOrders, minTrim, maxTrim, deckleWidth, targetLength) {
    const activeOrders = eligibleOrders.filter(o => o.remaining_qty > 0.01 && o.width_mm >= 355 && (!targetLength || o.length_m === targetLength));
    const ordersCore3 = activeOrders.filter(o => o.core === 3).sort((a, b) => b.width_mm - a.width_mm);
    const ordersCore6 = activeOrders.filter(o => o.core === 6).sort((a, b) => b.width_mm - a.width_mm);
    if (ordersCore3.length === 0 || ordersCore6.length === 0)
        return [];
    const widths3 = Array.from(new Set(ordersCore3.map(o => o.width_mm))).sort((a, b) => b - a);
    const widths6 = Array.from(new Set(ordersCore6.map(o => o.width_mm))).sort((a, b) => b - a);
    const minSlitWidth = deckleWidth - maxTrim;
    const maxSlitWidth = deckleWidth - minTrim;
    const combos3 = [];
    function search3(startIndex, current, currentW, ups) {
        if (combos3.length >= 300)
            return;
        if (ups >= 2 && ups <= 8 && currentW <= maxSlitWidth) {
            combos3.push({ widths: [...current], totalWidth: currentW, ups });
        }
        if (ups >= 8)
            return;
        for (let i = startIndex; i < widths3.length; i++) {
            if (currentW + widths3[i] <= maxSlitWidth) {
                current.push(widths3[i]);
                search3(i, current, currentW + widths3[i], ups + 1);
                current.pop();
            }
        }
    }
    search3(0, [], 0, 0);
    const combos6 = [];
    function search6(startIndex, current, currentW, ups) {
        if (combos6.length >= 300)
            return;
        if (ups >= 2 && ups <= 8 && currentW <= maxSlitWidth) {
            combos6.push({ widths: [...current], totalWidth: currentW, ups });
        }
        if (ups >= 8)
            return;
        for (let i = startIndex; i < widths6.length; i++) {
            if (currentW + widths6[i] <= maxSlitWidth) {
                current.push(widths6[i]);
                search6(i, current, currentW + widths6[i], ups + 1);
                current.pop();
            }
        }
    }
    search6(0, [], 0, 0);
    const balancedDeckles = [];
    for (const c3 of combos3) {
        for (const c6 of combos6) {
            if (balancedDeckles.length >= 500)
                break;
            if (Math.abs(c3.ups - c6.ups) > 1)
                continue;
            const combinedWidth = c3.totalWidth + c6.totalWidth;
            if (combinedWidth >= minSlitWidth && combinedWidth <= maxSlitWidth) {
                let pos = 1;
                const mappedItemsA = [];
                const widthMapA = new Map();
                c3.widths.forEach(w => widthMapA.set(w, (widthMapA.get(w) || 0) + 1));
                let validA = true;
                for (const [w, neededUps] of Array.from(widthMapA.entries())) {
                    const matchOrd = ordersCore3.find(o => o.width_mm === w);
                    if (!matchOrd) {
                        validA = false;
                        break;
                    }
                    const positions = [];
                    for (let u = 0; u < neededUps; u++)
                        positions.push(pos++);
                    mappedItemsA.push({
                        orderId: matchOrd.id,
                        salesOrder: matchOrd.sales_order,
                        itemNumber: matchOrd.item_number,
                        customer: matchOrd.customer,
                        film: matchOrd.film,
                        width: matchOrd.width_mm,
                        length: matchOrd.length_m,
                        ups: neededUps,
                        positions,
                        position_label: formatPositionLabel(positions),
                        station: 'SIDE_A',
                        core: 3,
                        treatment_side: matchOrd.treatment_side,
                    });
                }
                if (!validA)
                    continue;
                const mappedItemsB = [];
                const widthMapB = new Map();
                c6.widths.forEach(w => widthMapB.set(w, (widthMapB.get(w) || 0) + 1));
                let validB = true;
                for (const [w, neededUps] of Array.from(widthMapB.entries())) {
                    const matchOrd = ordersCore6.find(o => o.width_mm === w);
                    if (!matchOrd) {
                        validB = false;
                        break;
                    }
                    const positions = [];
                    for (let u = 0; u < neededUps; u++)
                        positions.push(pos++);
                    mappedItemsB.push({
                        orderId: matchOrd.id,
                        salesOrder: matchOrd.sales_order,
                        itemNumber: matchOrd.item_number,
                        customer: matchOrd.customer,
                        film: matchOrd.film,
                        width: matchOrd.width_mm,
                        length: matchOrd.length_m,
                        ups: neededUps,
                        positions,
                        position_label: formatPositionLabel(positions),
                        station: 'SIDE_B',
                        core: 6,
                        treatment_side: matchOrd.treatment_side,
                    });
                }
                if (!validB)
                    continue;
                balancedDeckles.push([...mappedItemsA, ...mappedItemsB]);
            }
        }
    }
    return balancedDeckles;
}
/**
 * Stage 4: Rare Mixed-Length Fallback
 */
function findInitialMixedLengthDeckles(eligibleOrders, minTrim, maxTrim, minUps, maxUps, deckleWidth) {
    const activeOrders = eligibleOrders
        .filter(o => o.remaining_qty > 0.01 && o.width_mm >= 355)
        .sort((a, b) => b.width_mm - a.width_mm);
    if (activeOrders.length === 0)
        return [];
    const minSlitWidth = deckleWidth - maxTrim;
    const maxSlitWidth = deckleWidth - minTrim;
    const validPatterns = [];
    function search(index, currentCombo, currentWidth, currentUps) {
        if (validPatterns.length >= 500)
            return;
        if (currentUps > maxUps || currentWidth > maxSlitWidth)
            return;
        if (currentUps >= minUps && currentWidth >= minSlitWidth && currentWidth <= maxSlitWidth) {
            if (isPlanLengthCompatible(currentCombo.map(ord => ord.length_m))) {
                let pos = 1;
                const mapped = currentCombo.map(ord => ({
                    orderId: ord.id,
                    salesOrder: ord.sales_order,
                    itemNumber: ord.item_number,
                    customer: ord.customer,
                    width: ord.width_mm,
                    length: ord.length_m,
                    ups: 1,
                    positions: [pos],
                    position_label: `${pos++}`,
                    core: ord.core,
                    treatment_side: ord.treatment_side,
                }));
                validPatterns.push(mapped);
            }
        }
        if (currentUps >= maxUps)
            return;
        for (let i = index; i < activeOrders.length; i++) {
            const ord = activeOrders[i];
            if (currentWidth + ord.width_mm <= maxSlitWidth) {
                const proposedLengths = [...currentCombo.map(o => o.length_m), ord.length_m];
                if (isPlanLengthCompatible(proposedLengths)) {
                    currentCombo.push(ord);
                    search(i, currentCombo, currentWidth + ord.width_mm, currentUps + 1);
                    currentCombo.pop();
                }
            }
        }
    }
    search(0, [], 0, 0);
    return validPatterns;
}
/**
 * Stage 5: Elastic Multi-Pack Simulation Loop with Continuous In-Run Size Replacement,
 * Fixed Physical Arm Identity ("Bare se Chote"), and Global Target Ceiling Enforcement.
 */
function simulateMultiPackExecution(initialSetup, availableOrders, filmThickness, filmDensity, deckleWidth, minTrim, maxTrim, minUps, maxUps, priorityOrderIds, targetLength, isMixed, targetRemainingKg, maxAllowedForPlanKg, targetKg, cumulativePlannedSoFarKg = 0) {
    const duplexAssign = assignDuplexStations(initialSetup);
    const currentSetup = duplexAssign.success ? duplexAssign.items : initialSetup;
    if (!isPlanLengthCompatible(currentSetup.map(it => it.length))) {
        return null;
    }
    const totalSlitInitial = currentSetup.reduce((sum, it) => sum + it.width * it.ups, 0);
    const trimInitial = deckleWidth - totalSlitInitial;
    if (trimInitial < minTrim || trimInitial > maxTrim) {
        return null;
    }
    /**
     * Deterministic Global Deckle Lookahead & Existing Size Preservation Selector.
     *
     * TIER 1: Hard physical & business constraints dominate first (Deckle trim 140-250mm, +3% ceiling, duplex, core/length).
     * TIER 2: Existing Size Preservation (Keep currently active width if legal future demand exists on this arm).
     * TIER 3: Avoidable Cross-Arm Relocation Penalty (Prevent X -> Y on Arm A while Z -> X on Arm B).
     * TIER 4: Avoidable Same-Arm Oscillation & Intermediate Stepping Churn (e.g., suppress 980 -> 975 -> 981 in favor of direct 980 -> 981).
     * TIER 5: Run-Length Stability (3+ packs > 2 packs > 1 pack).
     * TIER 6: Order Priority / Business Value.
     * TIER 7: Lookahead Knife Change Minimization.
     * TIER 8: Demand Fulfillment Capacity.
     * TIER 9: Trim Centering (Proximity to optimal midpoint).
     * TIER 10: Width Descending ("Bare se Chote" as final deterministic tie-breaker).
     */
    function selectBestReplacementCandidate({ posToReplace, oldArm, currentArms, simOrderMap, orderBaseDemandMap, orderMaxAllowedMap, priorityOrderIds, deckleWidth, minTrim, maxTrim, filmThickness, filmDensity, targetLength, duplexAssign, packNum, positionHistoryMap, }) {
        const otherArms = currentArms.filter(a => a.position !== posToReplace);
        const otherArmsWidth = otherArms.reduce((sum, a) => sum + a.width_mm, 0);
        // Active widths currently mounted on other arms
        const otherArmsWidthCount = new Map();
        otherArms.forEach(a => {
            otherArmsWidthCount.set(a.width_mm, (otherArmsWidthCount.get(a.width_mm) || 0) + 1);
        });
        // 1. TIER 1: HARD PHYSICAL & BUSINESS FILTER
        const eligibleCandidates = [];
        for (const o of simOrderMap.values()) {
            if (o.remaining_qty <= 0.05)
                continue;
            if (o.width_mm < 355)
                continue; // Hard physical constraint: minimum allowable slit width 355 mm
            if (duplexAssign.isDualLength && o.length_m !== oldArm.length_m)
                continue;
            if (!duplexAssign.isDualLength && o.length_m !== targetLength)
                continue;
            if (duplexAssign.isDualCore && o.core !== oldArm.core)
                continue;
            // Rewind Station physical shaft constraint: arms sharing the same station must wind identical roll lengths
            const sameStationOtherArms = otherArms.filter(a => a.station === oldArm.station);
            if (sameStationOtherArms.some(a => a.length_m !== o.length_m))
                continue;
            // Plan-level length compatibility: total distinct lengths in resulting plan must remain <= 2, with exact 1:2 ratio if 2
            const resultingPlanLengths = [...otherArms.map(a => a.length_m), o.length_m];
            if (!isPlanLengthCompatible(resultingPlanLengths))
                continue;
            const candReelW = (0, weightCalculator_1.calculateSingleReelWeight)(o.width_mm, filmThickness, filmDensity, o.length_m);
            const candBaseDemand = orderBaseDemandMap.get(o.id) || o.remaining_qty;
            const candHist = historicalProducedMap.get(o.id) || 0;
            const rawCandMax = orderMaxAllowedMap.get(o.id) ?? (candBaseDemand * 1.03);
            const candMaxCap = candHist === 0 ? Math.max(rawCandMax, candReelW * 1.00) : rawCandMax;
            // Count how many arms in currentArms are already assigned to this candidate order (excluding posToReplace)
            const alreadyAssignedArms = otherArms.filter(a => a.orderId === o.id).length;
            const projectedImmediateProd = o.produced_qty + (alreadyAssignedArms + 1) * candReelW;
            if (projectedImmediateProd > candMaxCap + 0.05)
                continue;
            // Deckle trim check (140–250 mm standard window)
            const newTotalSlit = otherArmsWidth + o.width_mm;
            const newTrim = deckleWidth - newTotalSlit;
            if (newTrim < minTrim || newTrim > maxTrim)
                continue;
            eligibleCandidates.push(o);
        }
        if (eligibleCandidates.length === 0)
            return null;
        if (eligibleCandidates.length === 1)
            return eligibleCandidates[0]; // Physical necessity (single legal choice)
        // Check if the currently active width on this arm can be legally preserved
        const currentArmWidth = oldArm.width_mm;
        const canPreserveCurrentWidth = eligibleCandidates.some(c => c.width_mm === currentArmWidth);
        const armHistory = positionHistoryMap.get(posToReplace) || [currentArmWidth];
        const recentArmWidths = armHistory.slice(-3);
        // Pre-calculate candidate pack capacity and multi-pack availability
        const candidatePackStats = new Map();
        let hasMultiPackCandidate = false;
        eligibleCandidates.forEach(cand => {
            const candReelW = (0, weightCalculator_1.calculateSingleReelWeight)(cand.width_mm, filmThickness, filmDensity, cand.length_m);
            const candBaseDemand = orderBaseDemandMap.get(cand.id) || cand.remaining_qty;
            const candHist = historicalProducedMap.get(cand.id) || 0;
            const rawCandMax = orderMaxAllowedMap.get(cand.id) ?? (candBaseDemand * 1.03);
            const candMaxCap = candHist === 0 ? Math.max(rawCandMax, candReelW * 1.00) : rawCandMax;
            const alreadyAssignedArms = otherArms.filter(a => a.orderId === cand.id).length;
            const totalArmsOnCand = alreadyAssignedArms + 1;
            const remainingCapKg = Math.max(0, candMaxCap - cand.produced_qty);
            const totalReelsPossible = Math.floor((remainingCapKg + 0.05) / candReelW);
            const packsCanRun = Math.max(1, Math.floor(totalReelsPossible / totalArmsOnCand));
            const expectedRunPacks = Math.min(3, packsCanRun);
            candidatePackStats.set(cand.id, { expectedRunPacks, totalReelsPossible });
            if (expectedRunPacks >= 2 || cand.width_mm === currentArmWidth) {
                hasMultiPackCandidate = true;
            }
        });
        const evaluations = eligibleCandidates.map(cand => {
            const { expectedRunPacks, totalReelsPossible } = candidatePackStats.get(cand.id);
            const newTrim = deckleWidth - (otherArmsWidth + cand.width_mm);
            const trimMidpoint = (minTrim + maxTrim) / 2;
            const trimQuality = -Math.abs(newTrim - trimMidpoint);
            const isPriority = priorityOrderIds.has(cand.id) || !!cand.priority;
            // Tier 2: Existing Size Preservation
            const isSameWidthPreserved = (cand.width_mm === currentArmWidth);
            const isAvoidableSizeEviction = (canPreserveCurrentWidth && !isSameWidthPreserved);
            // Tier 3: Avoidable Cross-Arm Relocation
            // When candidate width is already running on another arm and this arm does not need to duplicate/relocate it
            const isCrossArmRelocation = (!isSameWidthPreserved && (otherArmsWidthCount.get(cand.width_mm) || 0) > 0 && totalReelsPossible <= 3);
            // Tier 4: Avoidable Same-Arm Oscillation (A -> B -> A) and Intermediate Stepping Churn (e.g., 980 -> 975 -> 981)
            let isSameArmOscillation = false;
            if (!isSameWidthPreserved && recentArmWidths.includes(cand.width_mm) && expectedRunPacks === 1) {
                isSameArmOscillation = true;
            }
            let isIntermediateSteppingChurn = false;
            if (!isSameWidthPreserved && expectedRunPacks === 1 && hasMultiPackCandidate) {
                isIntermediateSteppingChurn = true;
            }
            const avoidableOscillationOrChurn = isSameArmOscillation || isIntermediateSteppingChurn;
            // Tier 7: Future knife changes in 3-pack lookahead horizon
            // If same width is preserved, immediate change = 0. Else immediate change = 1.
            const immediateChange = isSameWidthPreserved ? 0 : 1;
            const subsequentChangesInWindow = (expectedRunPacks < 3) ? 1 : 0;
            const totalLookaheadChanges = immediateChange + subsequentChangesInWindow;
            return {
                candidate: cand,
                isSameWidthPreserved,
                isAvoidableSizeEviction,
                isCrossArmRelocation,
                avoidableOscillationOrChurn,
                expectedRunPacks,
                isPriority,
                totalLookaheadChanges,
                remainingDemandKg: cand.remaining_qty,
                trimQuality,
                width_mm: cand.width_mm,
            };
        });
        // 3. LEXICOGRAPHICAL HIERARCHICAL SORTING (Tiers 2 to 10)
        evaluations.sort((a, b) => {
            // Tier 2: Existing Size Preservation (Strongly prefer keeping active useful width on this arm)
            if (a.isSameWidthPreserved !== b.isSameWidthPreserved) {
                return a.isSameWidthPreserved ? -1 : 1;
            }
            if (a.isAvoidableSizeEviction !== b.isAvoidableSizeEviction) {
                return a.isAvoidableSizeEviction ? 1 : -1;
            }
            // Tier 3: Avoidable Cross-Arm Relocation (Penalize relocating a size between arms)
            if (a.isCrossArmRelocation !== b.isCrossArmRelocation) {
                return a.isCrossArmRelocation ? 1 : -1;
            }
            // Tier 4: Avoidable Same-Arm Oscillation & Intermediate Stepping Churn (e.g. 980 -> 975 -> 981)
            if (a.avoidableOscillationOrChurn !== b.avoidableOscillationOrChurn) {
                return a.avoidableOscillationOrChurn ? 1 : -1;
            }
            // Tier 5: Run-Length Stability (3+ packs > 2 packs > 1 pack)
            if (a.expectedRunPacks !== b.expectedRunPacks) {
                return b.expectedRunPacks - a.expectedRunPacks;
            }
            // Tier 6: Order Priority
            if (a.isPriority !== b.isPriority) {
                return a.isPriority ? -1 : 1;
            }
            // Tier 7: Total lookahead knife changes (fewer changes preferred)
            if (a.totalLookaheadChanges !== b.totalLookaheadChanges) {
                return a.totalLookaheadChanges - b.totalLookaheadChanges;
            }
            // Tier 8: Demand fulfillment capacity (fulfill larger pending demand first)
            if (Math.abs(b.remainingDemandKg - a.remainingDemandKg) > 10) {
                return b.remainingDemandKg - a.remainingDemandKg;
            }
            // Tier 9: Trim quality (closer to trim midpoint)
            if (Math.abs(b.trimQuality - a.trimQuality) > 1) {
                return b.trimQuality - a.trimQuality;
            }
            // Tier 10: Width mm descending ("Bare se Chote" as final deterministic tie-breaker)
            return b.candidate.width_mm - a.candidate.width_mm;
        });
        return evaluations[0].candidate;
    }
    // Pre-calculate full natural simulation history pack by pack dynamically driven by order demand/capacity
    const packSnapshots = [];
    const simOrderMap = new Map();
    const orderBaseDemandMap = new Map();
    const orderMaxAllowedMap = new Map();
    const historicalProducedMap = new Map();
    availableOrders.forEach(o => {
        const baseResidualDemand = Number(o.remaining_qty);
        const historicalProduced = Number(o.produced_qty || 0);
        const originalDemand = Math.max(Number(o.balance_qty || 0), baseResidualDemand + historicalProduced);
        const globalMaxAllowed = Math.round(originalDemand * 1.03 * 100) / 100;
        const planMaxAllowed = Math.max(0, Math.round((globalMaxAllowed - historicalProduced) * 100) / 100);
        orderBaseDemandMap.set(o.id, baseResidualDemand);
        orderMaxAllowedMap.set(o.id, planMaxAllowed);
        historicalProducedMap.set(o.id, historicalProduced);
        simOrderMap.set(o.id, {
            ...o,
            remaining_qty: baseResidualDemand,
            produced_qty: 0, // Plan-local production counter begins at 0 for this plan
        });
    });
    let activeArms = [];
    const positionHistoryMap = new Map();
    currentSetup.forEach(item => {
        item.positions.forEach(pos => {
            activeArms.push({
                position: pos,
                orderId: item.orderId,
                salesOrder: item.salesOrder,
                itemNumber: item.itemNumber,
                customer: item.customer,
                width_mm: item.width,
                length_m: item.length,
                station: item.station || (pos <= (duplexAssign.sideAUps || 8) ? 'SIDE_A' : 'SIDE_B'),
                core: item.core,
                treatment_side: item.treatment_side,
                startPack: 1,
            });
            positionHistoryMap.set(pos, [item.width]);
        });
    });
    activeArms.sort((a, b) => a.position - b.position);
    const accumulatedChanges = [];
    const accumulatedHistory = [];
    let packNum = 1;
    while (true) {
        // 0. Pre-check: Calculate cumulative production per order across all arms in this pack
        const armCountPerOrder = new Map();
        activeArms.forEach(arm => {
            armCountPerOrder.set(arm.orderId, (armCountPerOrder.get(arm.orderId) || 0) + 1);
        });
        const armsNeedingReplacement = [];
        const excessArmsToReplacePerOrder = new Map();
        armCountPerOrder.forEach((armCount, orderId) => {
            const ord = simOrderMap.get(orderId);
            const sampleArm = activeArms.find(a => a.orderId === orderId);
            const reelWeight = (0, weightCalculator_1.calculateSingleReelWeight)(sampleArm.width_mm, filmThickness, filmDensity, sampleArm.length_m);
            const baseDemand = orderBaseDemandMap.get(orderId) || ord.remaining_qty;
            const hist = historicalProducedMap.get(orderId) || 0;
            const rawPlanMax = orderMaxAllowedMap.get(orderId) ?? (baseDemand * 1.03);
            const maxCap = hist === 0 ? Math.max(rawPlanMax, reelWeight * 1.00) : rawPlanMax;
            const remainingCapacity = maxCap - ord.produced_qty;
            const allowedArmsInPack = Math.max(0, Math.floor((remainingCapacity + 0.05) / reelWeight));
            if (armCount > allowedArmsInPack) {
                const excess = armCount - allowedArmsInPack;
                excessArmsToReplacePerOrder.set(orderId, excess);
            }
        });
        if (excessArmsToReplacePerOrder.size > 0) {
            if (packNum === 1) {
                // Initial setup exceeds order capacity on Pack 1
                return null;
            }
            // Identify specific arm positions to replace
            excessArmsToReplacePerOrder.forEach((excessCount, orderId) => {
                const matchingArms = activeArms.filter(a => a.orderId === orderId);
                // Replace from the back of matching arms
                for (let i = 0; i < excessCount && i < matchingArms.length; i++) {
                    armsNeedingReplacement.push(matchingArms[matchingArms.length - 1 - i].position);
                }
            });
        }
        if (armsNeedingReplacement.length > 0) {
            // Try dynamic replacement for completed/excess positions before running this pack
            let allReplaced = true;
            const tempArms = activeArms.map(a => ({ ...a }));
            for (const posToReplace of armsNeedingReplacement) {
                const armIdx = tempArms.findIndex(a => a.position === posToReplace);
                const oldArm = tempArms[armIdx];
                const cand = selectBestReplacementCandidate({
                    posToReplace,
                    oldArm,
                    currentArms: tempArms,
                    simOrderMap,
                    orderBaseDemandMap,
                    orderMaxAllowedMap,
                    priorityOrderIds,
                    deckleWidth,
                    minTrim,
                    maxTrim,
                    filmThickness,
                    filmDensity,
                    targetLength,
                    duplexAssign,
                    packNum,
                    positionHistoryMap,
                });
                if (cand) {
                    tempArms[armIdx] = {
                        position: posToReplace,
                        orderId: cand.id,
                        salesOrder: cand.sales_order,
                        itemNumber: cand.item_number,
                        customer: cand.customer,
                        width_mm: cand.width_mm,
                        length_m: cand.length_m,
                        station: oldArm.station,
                        core: cand.core,
                        treatment_side: cand.treatment_side,
                        startPack: packNum,
                    };
                    positionHistoryMap.get(posToReplace)?.push(cand.width_mm);
                    if (cand.width_mm !== oldArm.width_mm) {
                        accumulatedChanges.push({
                            id: `change-sim-${accumulatedChanges.length + 1}`,
                            plan_id: '',
                            segment_id: `seg-pack-${packNum}`,
                            position: posToReplace,
                            old_width_mm: oldArm.width_mm,
                            new_width_mm: cand.width_mm,
                            after_pack: packNum - 1,
                            reason: 'ORDER_COMPLETED',
                            instruction: `AFTER PACK ${packNum - 1}: CHANGE SIZE ${oldArm.width_mm}MM → ${cand.width_mm}MM`,
                            old_order_ref: `SO# ${oldArm.salesOrder} / Item ${oldArm.itemNumber} (${oldArm.customer})`,
                            new_order_ref: `SO# ${cand.sales_order} / Item ${cand.item_number} (${cand.customer})`,
                            created_at: new Date().toISOString(),
                        });
                    }
                }
                else {
                    allReplaced = false;
                    break;
                }
            }
            if (!allReplaced) {
                // Cannot replace while staying within deckle/tolerance -> stop simulation at previous pack
                break;
            }
            activeArms = tempArms;
        }
        let packWeight = 0;
        let packReels = 0;
        const completedPositionsThisPack = [];
        // Run active arms for this pack
        for (const arm of activeArms) {
            const ord = simOrderMap.get(arm.orderId);
            const reelWeight = (0, weightCalculator_1.calculateSingleReelWeight)(arm.width_mm, filmThickness, filmDensity, arm.length_m);
            const baseDemand = orderBaseDemandMap.get(arm.orderId) || ord.remaining_qty;
            const armHist = historicalProducedMap.get(arm.orderId) || 0;
            const rawPlanMax = orderMaxAllowedMap.get(arm.orderId) ?? (baseDemand * 1.03);
            const maxCap = armHist === 0 ? Math.max(rawPlanMax, reelWeight * 1.00) : rawPlanMax;
            ord.produced_qty = Math.round((ord.produced_qty + reelWeight) * 100) / 100;
            ord.remaining_qty = Math.max(0, Math.round((ord.remaining_qty - reelWeight) * 100) / 100);
            ord.status = ord.remaining_qty <= 0.05 ? 'COMPLETED' : 'PARTIALLY_FULFILLED';
            const isNowClosed = (ord.produced_qty + reelWeight > maxCap + 0.05) || ord.remaining_qty <= 0.05;
            if (isNowClosed) {
                completedPositionsThisPack.push(arm.position);
            }
            accumulatedHistory.push({
                pack: packNum,
                position: arm.position,
                orderId: arm.orderId,
                width_mm: arm.width_mm,
                length_m: arm.length_m,
                weightKg: reelWeight,
                isClosed: isNowClosed,
            });
            packWeight += reelWeight;
            packReels += 1;
        }
        const stateClone = new Map();
        simOrderMap.forEach((v, k) => {
            const hist = historicalProducedMap.get(k) || 0;
            const cumulativeProduced = Math.round((hist + v.produced_qty) * 100) / 100;
            stateClone.set(k, { remaining_qty: v.remaining_qty, produced_qty: cumulativeProduced, status: v.status });
        });
        packSnapshots.push({
            pack: packNum,
            arms: activeArms.map(a => ({ ...a })),
            changes: accumulatedChanges.map(c => ({ ...c })),
            packWeight,
            packReels,
            history: accumulatedHistory.map(h => ({ ...h })),
            ordersState: stateClone,
        });
        if (completedPositionsThisPack.length === 0) {
            packNum++;
            continue;
        }
        // Dynamic replacement on completed positions using Bounded 3-Pack Lookahead Selector
        let allCompletedPositionsReplaced = true;
        const tempArms = activeArms.map(a => ({ ...a }));
        for (const completedPos of completedPositionsThisPack) {
            const armIdx = tempArms.findIndex(a => a.position === completedPos);
            const oldArm = tempArms[armIdx];
            const cand = selectBestReplacementCandidate({
                posToReplace: completedPos,
                oldArm,
                currentArms: tempArms,
                simOrderMap,
                orderBaseDemandMap,
                orderMaxAllowedMap,
                priorityOrderIds,
                deckleWidth,
                minTrim,
                maxTrim,
                filmThickness,
                filmDensity,
                targetLength,
                duplexAssign,
                packNum,
                positionHistoryMap,
            });
            if (cand) {
                tempArms[armIdx] = {
                    position: completedPos,
                    orderId: cand.id,
                    salesOrder: cand.sales_order,
                    itemNumber: cand.item_number,
                    customer: cand.customer,
                    width_mm: cand.width_mm,
                    length_m: cand.length_m,
                    station: oldArm.station,
                    core: cand.core,
                    treatment_side: cand.treatment_side,
                    startPack: packNum + 1,
                };
                positionHistoryMap.get(completedPos)?.push(cand.width_mm);
                if (cand.width_mm !== oldArm.width_mm) {
                    accumulatedChanges.push({
                        id: `change-sim-${accumulatedChanges.length + 1}`,
                        plan_id: '',
                        segment_id: `seg-pack-${packNum + 1}`,
                        position: completedPos,
                        old_width_mm: oldArm.width_mm,
                        new_width_mm: cand.width_mm,
                        after_pack: packNum,
                        reason: 'ORDER_COMPLETED',
                        instruction: `AFTER PACK ${packNum}: CHANGE SIZE ${oldArm.width_mm}MM → ${cand.width_mm}MM`,
                        old_order_ref: `SO# ${oldArm.salesOrder} / Item ${oldArm.itemNumber} (${oldArm.customer})`,
                        new_order_ref: `SO# ${cand.sales_order} / Item ${cand.item_number} (${cand.customer})`,
                        created_at: new Date().toISOString(),
                    });
                }
            }
            else {
                allCompletedPositionsReplaced = false;
                break;
            }
        }
        if (!allCompletedPositionsReplaced) {
            break;
        }
        activeArms = tempArms;
        packNum++;
    }
    if (packSnapshots.length === 0)
        return null;
    // Elastic Pack Count Evaluation: Test P = maxPacks down to 1 against targetMaxKg
    const naturalMaxPacks = packSnapshots.length;
    let bestEvaluatedPackResult = null;
    for (let p = naturalMaxPacks; p >= 1; p--) {
        let candidateWeight = 0;
        for (let i = 0; i < p; i++) {
            candidateWeight += packSnapshots[i].packWeight;
        }
        if (maxAllowedForPlanKg !== undefined && candidateWeight > maxAllowedForPlanKg + 0.0001) {
            continue; // Exceeds target ceiling, evaluate next smaller pack count
        }
        const snap = packSnapshots[p - 1];
        let closedCount = 0;
        let prioClosedCount = 0;
        snap.ordersState.forEach((val, ordId) => {
            if (val.status === 'COMPLETED') {
                closedCount++;
                if (priorityOrderIds.has(ordId))
                    prioClosedCount++;
            }
        });
        const totalWithThisPlan = cumulativePlannedSoFarKg + candidateWeight;
        let targetProximityBonus = 0;
        if (targetKg) {
            const targetMax = targetKg * 1.03;
            if (totalWithThisPlan <= targetMax) {
                targetProximityBonus = 500000 - Math.abs(targetKg - totalWithThisPlan) * 10;
            }
            else {
                targetProximityBonus = -10000000;
            }
        }
        const duplexBonus = (duplexAssign.success && Math.abs(duplexAssign.sideAUps - duplexAssign.sideBUps) <= 1) ? 20000 : 0;
        const mixedPenalty = isMixed ? -200000 : 0;
        const candScore = mixedPenalty +
            targetProximityBonus +
            duplexBonus +
            p * 50000 +
            candidateWeight * 5 +
            prioClosedCount * 50000 +
            closedCount * 15000 -
            snap.changes.length * 35000 -
            Math.abs(trimInitial - 186) * 10;
        if (!bestEvaluatedPackResult || candScore > bestEvaluatedPackResult.score) {
            bestEvaluatedPackResult = {
                packCount: p,
                weightKg: candidateWeight,
                score: candScore,
            };
        }
    }
    if (!bestEvaluatedPackResult) {
        return null;
    }
    const selectedTotalPacks = bestEvaluatedPackResult.packCount;
    const finalSnapshot = packSnapshots[selectedTotalPacks - 1];
    const finalHistory = accumulatedHistory.filter(h => h.pack <= selectedTotalPacks);
    const finalChanges = accumulatedChanges.filter(c => c.after_pack < selectedTotalPacks);
    const pack1ArmsList = packSnapshots[0].arms;
    const parentGroupsMap = new Map();
    pack1ArmsList.forEach(arm => {
        if (!parentGroupsMap.has(arm.orderId)) {
            const ord = availableOrders.find(o => o.id === arm.orderId) || simOrderMap.get(arm.orderId);
            parentGroupsMap.set(arm.orderId, {
                orderId: arm.orderId,
                orderRef: ord,
                pack1Positions: [arm.position],
                width_mm: arm.width_mm,
                station: arm.station,
                initialUps: 1,
            });
        }
        else {
            const g = parentGroupsMap.get(arm.orderId);
            g.pack1Positions.push(arm.position);
            g.pack1Positions.sort((a, b) => a - b);
            g.initialUps = g.pack1Positions.length;
        }
    });
    const parentGroups = Array.from(parentGroupsMap.values()).sort((a, b) => {
        if (a.width_mm !== b.width_mm)
            return b.width_mm - a.width_mm;
        return a.pack1Positions[0] - b.pack1Positions[0];
    });
    const consolidatedPlanItems = [];
    parentGroups.forEach(parent => {
        const parentOrderRef = parent.orderRef;
        const parentAssignedPositions = parent.pack1Positions;
        const parentHistoryEntries = finalHistory.filter(h => h.orderId === parent.orderId && parentAssignedPositions.includes(h.position));
        const parentReels = parentHistoryEntries.length;
        const parentTotalWeight = parentHistoryEntries.reduce((sum, h) => sum + h.weightKg, 0);
        const parentSingleReelWeight = (0, weightCalculator_1.calculateSingleReelWeight)(parentOrderRef.width_mm, filmThickness, filmDensity, parentOrderRef.length_m);
        const parentActiveDeckleMm = parentOrderRef.width_mm * parent.initialUps;
        const parentWeightPerPackKg = parentSingleReelWeight * parent.initialUps;
        const parentStartPack = parentHistoryEntries.length > 0 ? Math.min(...parentHistoryEntries.map(h => h.pack)) : 1;
        const parentEndPack = parentHistoryEntries.length > 0 ? Math.max(...parentHistoryEntries.map(h => h.pack)) : selectedTotalPacks;
        const parentActivePacks = parentHistoryEntries.length > 0 ? (parentEndPack - parentStartPack + 1) : selectedTotalPacks;
        consolidatedPlanItems.push({
            id: `item-order-${parent.orderId}`,
            plan_id: '',
            segment_id: 'seg-1',
            position: parentAssignedPositions[0] || 1,
            positions: parentAssignedPositions,
            position_label: formatPositionLabel(parentAssignedPositions),
            station: parent.station,
            sales_order: parentOrderRef.sales_order,
            item_number: parentOrderRef.item_number,
            customer: parentOrderRef.customer,
            film: parentOrderRef.film,
            width_mm: parentOrderRef.width_mm,
            length_m: parentOrderRef.length_m,
            core: parentOrderRef.core,
            treatment_side: parentOrderRef.treatment_side,
            reels: parentReels,
            ups: parent.initialUps,
            initial_ups: parent.initialUps,
            active_packs: parentActivePacks,
            start_pack: parentStartPack,
            deckle_mm: parentActiveDeckleMm,
            weight_per_pack_kg: parentWeightPerPackKg,
            total_weight_kg: parentTotalWeight,
            is_closed: (finalSnapshot.ordersState.get(parent.orderId)?.remaining_qty || 0) <= 0.05,
            is_future_replacement: false,
        });
        const replacementHistory = finalHistory.filter(h => parentAssignedPositions.includes(h.position) && h.orderId !== parent.orderId);
        const replacementOrderIds = Array.from(new Set(replacementHistory.map(h => h.orderId)));
        replacementOrderIds.forEach(repId => {
            const repOrderRef = availableOrders.find(o => o.id === repId) || simOrderMap.get(repId);
            const repEntries = replacementHistory.filter(h => h.orderId === repId);
            const repPositions = Array.from(new Set(repEntries.map(h => h.position))).sort((a, b) => a - b);
            const repStartPack = Math.min(...repEntries.map(h => h.pack));
            const repEndPack = Math.max(...repEntries.map(h => h.pack));
            const repActivePacks = repEndPack - repStartPack + 1;
            const repTotalWeight = repEntries.reduce((sum, h) => sum + h.weightKg, 0);
            const repReels = repEntries.length;
            const matchChange = finalChanges.find(c => repPositions.includes(c.position) && (c.new_order_ref.includes(repOrderRef.sales_order) || c.new_width_mm === repOrderRef.width_mm));
            const instruction = matchChange
                ? matchChange.instruction
                : undefined;
            consolidatedPlanItems.push({
                id: `item-order-${repId}-rep-${parent.orderId}`,
                plan_id: '',
                segment_id: 'seg-1',
                position: repPositions[0] || 1,
                positions: repPositions,
                position_label: formatPositionLabel(repPositions),
                station: parent.station,
                sales_order: repOrderRef.sales_order,
                item_number: repOrderRef.item_number,
                customer: repOrderRef.customer,
                film: repOrderRef.film,
                width_mm: repOrderRef.width_mm,
                length_m: repOrderRef.length_m,
                core: repOrderRef.core,
                treatment_side: repOrderRef.treatment_side,
                reels: repReels,
                ups: repPositions.length,
                initial_ups: 0,
                active_packs: repActivePacks,
                start_pack: repStartPack,
                deckle_mm: 0,
                weight_per_pack_kg: 0,
                total_weight_kg: repTotalWeight,
                is_closed: (finalSnapshot.ordersState.get(repId)?.remaining_qty || 0) <= 0.05,
                is_future_replacement: true,
                replacement_instruction: instruction,
            });
        });
    });
    const planSegments = [
        {
            id: 'seg-1',
            plan_id: '',
            segment_number: 1,
            name: `Initial Layout (Packs 1–${selectedTotalPacks})`,
            start_pack: 1,
            end_pack: selectedTotalPacks,
            repetitions: selectedTotalPacks,
            total_slit_width_mm: totalSlitInitial,
            trim_mm: trimInitial,
            ups: currentSetup.reduce((sum, item) => sum + item.ups, 0),
            items: consolidatedPlanItems,
            changes: finalChanges,
        },
    ];
    let totalClosed = 0;
    let totalPrioClosed = 0;
    finalSnapshot.ordersState.forEach((val, ordId) => {
        if (val.status === 'COMPLETED') {
            totalClosed++;
            if (priorityOrderIds.has(ordId))
                totalPrioClosed++;
        }
    });
    // =========================================================================
    // HARD VALIDATION GATE: Final Plan Level Length Compatibility Validation
    // =========================================================================
    const allResultingPlanLengths = [
        ...consolidatedPlanItems.map(it => it.length_m),
        ...finalHistory.map(h => h.length_m),
    ].filter((l) => typeof l === 'number' && l > 0);
    if (!isPlanLengthCompatible(allResultingPlanLengths)) {
        return null;
    }
    // Rewind Station Length Homogeneity Validation: rolls on the same station shaft must share identical length
    const sideAItems = consolidatedPlanItems.filter(it => it.station === 'SIDE_A');
    const sideBItems = consolidatedPlanItems.filter(it => it.station === 'SIDE_B');
    const distinctSideALengths = Array.from(new Set(sideAItems.map(it => it.length_m).filter((l) => typeof l === 'number' && l > 0)));
    const distinctSideBLengths = Array.from(new Set(sideBItems.map(it => it.length_m).filter((l) => typeof l === 'number' && l > 0)));
    if (distinctSideALengths.length > 1 || distinctSideBLengths.length > 1) {
        return null;
    }
    return {
        initialCombination: currentSetup,
        selected_length: targetLength,
        is_mixed: isMixed,
        is_dual_core: duplexAssign.isDualCore,
        is_dual_length: duplexAssign.isDualLength,
        side_a_ups: duplexAssign.sideAUps,
        side_b_ups: duplexAssign.sideBUps,
        side_a_core: duplexAssign.sideACore,
        side_b_core: duplexAssign.sideBCore,
        side_a_length_m: duplexAssign.sideALength,
        side_b_length_m: duplexAssign.sideBLength,
        balance_delta: Math.abs((duplexAssign.sideAUps || 0) - (duplexAssign.sideBUps || 0)),
        totalPacks: selectedTotalPacks,
        planItems: consolidatedPlanItems,
        planChanges: finalChanges,
        planSegments,
        totalPlannedWeightKg: bestEvaluatedPackResult.weightKg,
        totalOrderWeightKg: bestEvaluatedPackResult.weightKg,
        totalReels: finalHistory.length,
        ordersClosedCount: totalClosed,
        priorityOrdersClosed: totalPrioClosed,
        totalSlitWidth_mm: totalSlitInitial,
        trim_mm: trimInitial,
        totalUps: currentSetup.reduce((sum, item) => sum + item.ups, 0),
        simulatedOrdersState: finalSnapshot.ordersState,
        score: bestEvaluatedPackResult.score,
    };
}
/**
 * Normalizes treatment side string into standard group keys: 'OUTSIDE' | 'INSIDE' | 'BOTH SIDE' | 'NONE'
 */
function normalizeTreatmentGroup(ts) {
    if (!ts)
        return 'OUTSIDE';
    const clean = ts.trim().toUpperCase();
    if (clean === 'OS' || clean === 'OUTSIDE' || clean === 'OUT' || clean === 'O/S')
        return 'OUTSIDE';
    if (clean === 'IS' || clean === 'INSIDE' || clean === 'IN' || clean === 'I/S')
        return 'INSIDE';
    if (clean === 'BOTH' || clean === 'BOTH SIDE' || clean === 'BOTHSIDE' || clean === 'BS' || clean === 'B/S')
        return 'BOTH SIDE';
    if (clean === 'NONE' || clean === 'NT' || clean === 'NO' || clean === 'UN' || clean === 'UNTREATED')
        return 'NONE';
    return 'OUTSIDE';
}
/**
 * Single Treatment Group Master Deckle Optimization Execution
 * (Authoritative, Frozen PS01 Optimizer Engine)
 */
function executeSingleTreatmentGroupOptimization(input, startingPlanIndex = 1, runNumberOverride) {
    const rules = input.rules || masterData_1.DEFAULT_PLANNING_RULES;
    const logs = [];
    let logStep = 1;
    function addLog(message, type = 'INFO', data) {
        logs.push({ step: logStep++, message, type, data });
    }
    const trimRuleMode = input.trim_rule_mode || 'NORMAL';
    let activeMinTrim = rules.min_trim_mm || 160;
    let activeMaxTrim = rules.max_trim_mm || 220;
    if (trimRuleMode === 'RELAXED_50MM') {
        activeMinTrim = 50;
        activeMaxTrim = rules.max_trim_mm || 220;
    }
    else if (trimRuleMode === 'MANUAL_OVERRIDE') {
        activeMinTrim = input.custom_min_trim_mm !== undefined ? input.custom_min_trim_mm : 50;
        activeMaxTrim = input.custom_max_trim_mm !== undefined ? input.custom_max_trim_mm : 300;
    }
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const activeFilms = (input.films && input.films.length > 0)
        ? Array.from(new Set(input.films))
        : [input.film];
    const filmDisplay = activeFilms.join(' + ');
    const filmRunKey = activeFilms.map(f => f.replace(/[^a-zA-Z0-9]/g, '')).join('_');
    const runNumber = runNumberOverride || input.run_number || `RUN-${filmRunKey}-${dateStr}-${Math.floor(100 + Math.random() * 900)}`;
    addLog(`Starting intelligent duplex planning session ${runNumber} for Film [${filmDisplay}]`);
    addLog(`Duplex Split: 8 Arms (Side A: Station 1) + 8 Arms (Side B: Station 2) · Max Arm Capacity: 16 · Balance: |UPS_A - UPS_B| <= 1`);
    addLog(`Trim Rule Mode: ${trimRuleMode} · Deckle=${rules.deckle_width_mm}mm · Trim Range=${activeMinTrim}–${activeMaxTrim}mm (Slit Width: ${rules.deckle_width_mm - activeMaxTrim}–${rules.deckle_width_mm - activeMinTrim}mm)`);
    const filmMasters = activeFilms.map(f => masterData_1.FILM_MASTERS.find(m => m.code === f));
    const thicknesses = activeFilms.map((f, i) => input.orders.find(o => o.film === f)?.thickness_micron || filmMasters[i]?.thickness_micron || 20);
    const filmThickness = thicknesses[0];
    const orderWithDensity = input.orders.find(o => activeFilms.includes(o.film) && o.density && !isNaN(o.density));
    const filmDensity = orderWithDensity?.density || filmMasters[0]?.density || 0.91;
    const currentOrders = input.orders
        .filter(o => {
        if (!activeFilms.includes(o.film) || o.width_mm < 355)
            return false;
        // Physical integrity check: An order cannot be planned on PS01 if 1 full physical reel exceeds its allowed +3% ceiling
        const singleReelKg = (0, weightCalculator_1.calculateSingleReelWeight)(o.width_mm, filmThickness, filmDensity, o.length_m);
        const activeDemand = Math.max(Number(o.remaining_qty || 0), Number(o.balance_qty || 0));
        const orderCeiling = activeDemand * 1.0301;
        return singleReelKg <= orderCeiling;
    })
        .map(o => ({ ...o, remaining_qty: Number(o.remaining_qty), produced_qty: Number(o.produced_qty || 0) }));
    const prioritySet = new Set(input.priority_order_ids || []);
    currentOrders.forEach(o => {
        if (o.priority)
            prioritySet.add(o.id);
    });
    const totalDemandKg = currentOrders.reduce((sum, o) => sum + o.remaining_qty, 0);
    const targetKg = input.target_quantity_kg !== undefined && input.target_quantity_kg > 0
        ? input.target_quantity_kg
        : totalDemandKg;
    const isTargetQuantityMode = input.planning_mode === 'TARGET_QUANTITY' || input.target_quantity_kg !== undefined;
    const targetMaxKg = targetKg * 1.03; // Hard +3.0% Global Target Ceiling
    addLog(`Total open demand: ${totalDemandKg.toLocaleString()} kg across ${currentOrders.length} order lines`);
    addLog(`Target Quantity: ${targetKg.toLocaleString()} kg · Max Allowed (+3% Hard Ceiling): ${targetMaxKg.toFixed(2)} kg`);
    const generatedPlans = [];
    let cumulativePlannedKg = 0;
    let planIndex = startingPlanIndex;
    let status = 'COMPLETED';
    let stopReason = 'Planning completed: target output or eligible order closure achieved.';
    let suggestRelaxation = false;
    const MAX_PLANS_PER_RUN = 25;
    while (cumulativePlannedKg < targetKg && generatedPlans.length < MAX_PLANS_PER_RUN) {
        if (cumulativePlannedKg >= targetKg && cumulativePlannedKg <= targetMaxKg) {
            stopReason = `Target quantity achieved within +3% maximum tolerance (${cumulativePlannedKg.toFixed(2)} kg / ${targetKg.toLocaleString()} kg · ${((cumulativePlannedKg / targetKg) * 100).toFixed(2)}%).`;
            addLog(stopReason, 'SUCCESS');
            break;
        }
        const activeOrders = currentOrders.filter(o => o.remaining_qty > 0.05);
        if (activeOrders.length === 0) {
            stopReason = 'All pending orders for this film grade have been fully planned and completed.';
            addLog(stopReason, 'SUCCESS');
            break;
        }
        const remainingTargetForRun = targetKg - cumulativePlannedKg;
        const maxAllowedForThisPlan = Math.max(0, targetMaxKg - cumulativePlannedKg);
        if (cumulativePlannedKg > 0 && maxAllowedForThisPlan < 200) {
            stopReason = `Stopping plan creation: Adding another physical plan would breach the +3% maximum limit of ${targetMaxKg.toFixed(2)} kg. Current planned: ${cumulativePlannedKg.toFixed(2)} kg.`;
            addLog(stopReason, 'INFO');
            break;
        }
        const activeLengths = Array.from(new Set(activeOrders.map(o => o.length_m))).sort((lenA, lenB) => {
            const ordersA = activeOrders.filter(o => o.length_m === lenA);
            const ordersB = activeOrders.filter(o => o.length_m === lenB);
            const prioA = ordersA.filter(o => prioritySet.has(o.id) || o.priority).length;
            const prioB = ordersB.filter(o => prioritySet.has(o.id) || o.priority).length;
            if (prioA !== prioB)
                return prioB - prioA;
            const kgA = ordersA.reduce((sum, o) => sum + o.remaining_qty, 0);
            const kgB = ordersB.reduce((sum, o) => sum + o.remaining_qty, 0);
            return kgB - kgA;
        });
        let bestSimulatedPlan = null;
        // Search Tier 1: Same-Length Duplex Balanced Search
        for (const len of activeLengths) {
            const candidateCombinations = findInitialSameLengthDeckles(activeOrders, activeMinTrim, activeMaxTrim, rules.min_ups, rules.max_ups, rules.deckle_width_mm, len);
            for (const comb of candidateCombinations) {
                const simulated = simulateMultiPackExecution(comb, activeOrders, filmThickness, filmDensity, rules.deckle_width_mm, activeMinTrim, activeMaxTrim, rules.min_ups, rules.max_ups, prioritySet, len, false, remainingTargetForRun, maxAllowedForThisPlan, targetKg, cumulativePlannedKg);
                if (simulated) {
                    if (cumulativePlannedKg + simulated.totalPlannedWeightKg > targetMaxKg + 0.0001)
                        continue;
                    if (!bestSimulatedPlan || simulated.score > bestSimulatedPlan.score) {
                        bestSimulatedPlan = simulated;
                    }
                }
            }
        }
        // Search Tier 2: Dual-Length Synchronized Duplex Search
        if (!bestSimulatedPlan && activeLengths.length >= 2) {
            for (let i = 0; i < activeLengths.length; i++) {
                for (let j = i + 1; j < activeLengths.length; j++) {
                    const len1 = activeLengths[i];
                    const len2 = activeLengths[j];
                    if (!isPlanLengthCompatible([len1, len2]))
                        continue;
                    const dualLenDeckles = findDuplexDualLengthDeckles(activeOrders, activeMinTrim, activeMaxTrim, rules.deckle_width_mm, len1, len2);
                    for (const comb of dualLenDeckles) {
                        const masterLength = Math.max(len1, len2);
                        const simulatedDual = simulateMultiPackExecution(comb, activeOrders, filmThickness, filmDensity, rules.deckle_width_mm, activeMinTrim, activeMaxTrim, rules.min_ups, rules.max_ups, prioritySet, masterLength, false, remainingTargetForRun, maxAllowedForThisPlan, targetKg, cumulativePlannedKg);
                        if (simulatedDual) {
                            if (cumulativePlannedKg + simulatedDual.totalPlannedWeightKg > targetMaxKg + 0.0001)
                                continue;
                            if (!bestSimulatedPlan || simulatedDual.score > bestSimulatedPlan.score) {
                                bestSimulatedPlan = simulatedDual;
                            }
                        }
                    }
                }
            }
        }
        // Search Tier 3: Dual-Core Duplex Search (3" vs 6")
        if (!bestSimulatedPlan) {
            for (const len of activeLengths) {
                const dualCoreDeckles = findDuplexDualCoreDeckles(activeOrders, activeMinTrim, activeMaxTrim, rules.deckle_width_mm, len);
                for (const comb of dualCoreDeckles) {
                    const simulatedDualCore = simulateMultiPackExecution(comb, activeOrders, filmThickness, filmDensity, rules.deckle_width_mm, activeMinTrim, activeMaxTrim, rules.min_ups, rules.max_ups, prioritySet, len, false, remainingTargetForRun, maxAllowedForThisPlan, targetKg, cumulativePlannedKg);
                    if (simulatedDualCore) {
                        if (cumulativePlannedKg + simulatedDualCore.totalPlannedWeightKg > targetMaxKg + 0.0001)
                            continue;
                        if (!bestSimulatedPlan || simulatedDualCore.score > bestSimulatedPlan.score) {
                            bestSimulatedPlan = simulatedDualCore;
                        }
                    }
                }
            }
        }
        // Search Tier 4: Mixed-Length Fallback
        if (!bestSimulatedPlan) {
            const mixedCombinations = findInitialMixedLengthDeckles(activeOrders, activeMinTrim, activeMaxTrim, rules.min_ups, rules.max_ups, rules.deckle_width_mm);
            for (const comb of mixedCombinations) {
                const simulatedMixed = simulateMultiPackExecution(comb, activeOrders, filmThickness, filmDensity, rules.deckle_width_mm, activeMinTrim, activeMaxTrim, rules.min_ups, rules.max_ups, prioritySet, comb[0]?.length || 19500, true, remainingTargetForRun, maxAllowedForThisPlan, targetKg, cumulativePlannedKg);
                if (simulatedMixed) {
                    if (cumulativePlannedKg + simulatedMixed.totalPlannedWeightKg > targetMaxKg + 0.0001)
                        continue;
                    if (!bestSimulatedPlan || simulatedMixed.score > bestSimulatedPlan.score) {
                        bestSimulatedPlan = simulatedMixed;
                    }
                }
            }
        }
        // Governed stopping: No silent trim relaxation
        if (!bestSimulatedPlan) {
            if (cumulativePlannedKg > 0) {
                stopReason = `Planning finished for this session. Total Planned: ${cumulativePlannedKg.toFixed(2)} kg (Max Allowed: ${targetMaxKg.toFixed(2)} kg). Remaining orders are left in unplanned balance.`;
                addLog(stopReason, 'SUCCESS');
                status = 'COMPLETED';
                break;
            }
            if (trimRuleMode === 'NORMAL' && generatedPlans.length === 0) {
                suggestRelaxation = true;
                stopReason = `No feasible plan was found within normal trim range (${activeMinTrim}–${activeMaxTrim} mm). Request confirmation to relax trim.`;
            }
            else {
                stopReason = `No feasible planning combination could be formed within trim bounds (${activeMinTrim}–${activeMaxTrim}mm) for the requested film and order specifications.`;
            }
            addLog(stopReason, 'WARNING');
            status = 'NO_FEASIBLE_MATCH';
            break;
        }
        // Commit chosen plan
        const chosenPlan = bestSimulatedPlan;
        const planNumber = `PS1-${dateStr}-${String(planIndex).padStart(3, '0')}`;
        const planId = `plan-${planNumber}-${Date.now()}-${planIndex}`;
        const plannedMrLength = chosenPlan.totalPacks * chosenPlan.selected_length;
        chosenPlan.simulatedOrdersState.forEach((val, ordId) => {
            const actualOrder = currentOrders.find(o => o.id === ordId);
            if (actualOrder) {
                actualOrder.remaining_qty = val.remaining_qty;
                actualOrder.produced_qty = val.produced_qty;
                actualOrder.status = val.status;
            }
        });
        const finalPlanItems = chosenPlan.planItems.map((item, idx) => ({
            ...item,
            id: `item-${planId}-${idx + 1}`,
            plan_id: planId,
            segment_id: `seg-${planId}-1`,
        }));
        const finalPlanChanges = chosenPlan.planChanges.map((chg, idx) => ({
            ...chg,
            id: `change-${planId}-${idx + 1}`,
            plan_id: planId,
        }));
        const finalPlanSegments = [
            {
                id: `seg-${planId}-1`,
                plan_id: planId,
                segment_number: 1,
                name: `Initial Layout (Packs 1–${chosenPlan.totalPacks})`,
                start_pack: 1,
                end_pack: chosenPlan.totalPacks,
                repetitions: chosenPlan.totalPacks,
                total_slit_width_mm: chosenPlan.totalSlitWidth_mm,
                trim_mm: chosenPlan.trim_mm,
                ups: chosenPlan.totalUps,
                items: finalPlanItems,
                changes: finalPlanChanges,
            },
        ];
        const trimWeight = (0, weightCalculator_1.calculateTrimWeight)(chosenPlan.trim_mm, filmThickness, filmDensity, plannedMrLength);
        const millRollWeight = (0, weightCalculator_1.calculateMillRollWeight)(rules.deckle_width_mm, filmThickness, filmDensity, plannedMrLength);
        const wastePercent = Math.round((chosenPlan.trim_mm / rules.deckle_width_mm) * 10000) / 100;
        const weightPerPack = chosenPlan.totalPlannedWeightKg / chosenPlan.totalPacks;
        const newPlan = {
            id: planId,
            planning_run_id: runNumber,
            plan_number: planNumber,
            machine_id: 'PS01',
            machine_name: 'PRIMARY SLITTER 1',
            film: filmDisplay,
            films: activeFilms,
            thickness_micron: filmThickness,
            density: filmDensity,
            deckle_mm: rules.deckle_width_mm,
            total_slit_width_mm: chosenPlan.totalSlitWidth_mm,
            trim_mm: chosenPlan.trim_mm,
            allowed_trim_mm: 180,
            remaining_web_mm: Math.max(0, chosenPlan.trim_mm - 180),
            ups: chosenPlan.totalUps,
            max_ups_capacity: rules.max_ups,
            repetitions: chosenPlan.totalPacks,
            length_m: chosenPlan.selected_length,
            planned_mr_length_m: plannedMrLength,
            mill_roll_weight_kg: millRollWeight,
            trim_weight_kg: trimWeight,
            waste_percent: wastePercent,
            planned_quantity_kg: chosenPlan.totalPlannedWeightKg,
            order_weight_kg: chosenPlan.totalOrderWeightKg,
            total_reels: chosenPlan.totalReels,
            weight_per_pack_total_kg: weightPerPack,
            rejection_material: activeFilms.map(f => `R-${f}`).join(' / '),
            trim_rule_mode: trimRuleMode,
            min_trim_mm_used: activeMinTrim,
            max_trim_mm_used: activeMaxTrim,
            trim_override_reason: input.trim_override_reason,
            trim_override_by: input.created_by,
            duplex_layout: {
                side_a_ups: chosenPlan.side_a_ups || Math.ceil(chosenPlan.totalUps / 2),
                side_b_ups: chosenPlan.side_b_ups || Math.floor(chosenPlan.totalUps / 2),
                side_a_core: chosenPlan.side_a_core,
                side_b_core: chosenPlan.side_b_core,
                side_a_length_m: chosenPlan.side_a_length_m,
                side_b_length_m: chosenPlan.side_b_length_m,
                is_dual_core: chosenPlan.is_dual_core,
                is_dual_length: chosenPlan.is_dual_length,
                balance_delta: chosenPlan.balance_delta !== undefined ? chosenPlan.balance_delta : Math.abs((chosenPlan.side_a_ups || 0) - (chosenPlan.side_b_ups || 0)),
            },
            doc_ref: 'APS/QR/PL/01',
            rev_no: 0,
            issue_date: new Date().toLocaleDateString('en-GB'),
            items: finalPlanItems,
            changes: finalPlanChanges,
            segments: finalPlanSegments,
            status: 'DRAFT',
            created_at: new Date().toISOString(),
        };
        generatedPlans.push(newPlan);
        cumulativePlannedKg += chosenPlan.totalPlannedWeightKg;
        const duplexModeLabel = chosenPlan.is_dual_length
            ? `Dual-Length Duplex (${chosenPlan.side_a_length_m}m & ${chosenPlan.side_b_length_m}m)`
            : chosenPlan.is_dual_core
                ? `Dual-Core Duplex (3" & 6")`
                : `Balanced Duplex Split (Side A: ${chosenPlan.side_a_ups} · Side B: ${chosenPlan.side_b_ups})`;
        addLog(`Plan [${planNumber}] Generated [${duplexModeLabel} · ${chosenPlan.totalPacks} Packs]: ${plannedMrLength.toLocaleString()}m MR · ${chosenPlan.totalUps} UPS (Side A: ${chosenPlan.side_a_ups || '-'} / Side B: ${chosenPlan.side_b_ups || '-'}) · Slit: ${chosenPlan.totalSlitWidth_mm}mm · Trim: ${chosenPlan.trim_mm}mm · Output: ${chosenPlan.totalPlannedWeightKg.toFixed(2)} kg`, 'SUCCESS');
        if (finalPlanChanges.length > 0) {
            finalPlanChanges.forEach(chg => {
                addLog(`Dynamic Replacement in [${planNumber}]: ${chg.instruction}`, 'SUCCESS');
            });
        }
        planIndex++;
    }
    const closedCount = currentOrders.filter(o => o.status === 'COMPLETED').length;
    const partialCount = currentOrders.filter(o => o.status === 'PARTIALLY_FULFILLED').length;
    const remainingCount = currentOrders.filter(o => o.remaining_qty > 0).length;
    const targetDeviationPercent = isTargetQuantityMode
        ? Math.round(((cumulativePlannedKg - targetKg) / targetKg) * 10000) / 100
        : 0;
    const planningRun = {
        id: `run-${runNumber}`,
        run_number: runNumber,
        film: filmDisplay,
        films: activeFilms,
        target_quantity_kg: targetKg,
        planned_quantity_kg: Math.round(cumulativePlannedKg * 100) / 100,
        remaining_quantity_kg: Math.max(0, Math.round((totalDemandKg - cumulativePlannedKg) * 100) / 100),
        target_min_kg: undefined,
        target_max_kg: isTargetQuantityMode ? targetMaxKg : undefined,
        target_deviation_percent: targetDeviationPercent,
        planning_mode: input.planning_mode,
        priority_so_items: Array.from(prioritySet),
        status,
        stop_reason: stopReason,
        rules_version: rules.version || '1.0',
        optimizer_version: '3.2.0-elastic-duplex-optimizer',
        trim_rule_mode: trimRuleMode,
        min_trim_mm_used: activeMinTrim,
        max_trim_mm_used: activeMaxTrim,
        trim_override_reason: input.trim_override_reason,
        trim_override_by: input.created_by,
        created_by: input.created_by || 'M.USMAN (Planner)',
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        plans_count: generatedPlans.length,
        orders_closed_count: closedCount,
        orders_partial_count: partialCount,
        orders_remaining_count: remainingCount,
    };
    addLog(`Optimization session finished with status [${status}]. Total Plans: ${generatedPlans.length} · Output: ${cumulativePlannedKg.toLocaleString()} kg (${targetDeviationPercent >= 0 ? '+' : ''}${targetDeviationPercent}% of target) · Closed: ${closedCount} Orders.`);
    return {
        run: planningRun,
        plans: generatedPlans,
        remaining_orders: currentOrders,
        logs,
        status,
        stop_reason: stopReason,
        suggest_trim_relaxation: suggestRelaxation,
    };
}
/**
 * Main Deterministic Multi-Plan Generator conforming to SRS V3.2
 * Strictly separates orders by Treatment Side (OUTSIDE, INSIDE, BOTH SIDE)
 * before plan generation so orders with different Treatment Side values are NEVER combined.
 */
function generatePrimarySlitterPlans(input) {
    const activeFilms = (input.films && input.films.length > 0)
        ? Array.from(new Set(input.films))
        : [input.film];
    const filmMasters = activeFilms.map(f => masterData_1.FILM_MASTERS.find(m => m.code === f));
    const thicknesses = activeFilms.map((f, i) => input.orders.find(o => o.film === f)?.thickness_micron || filmMasters[i]?.thickness_micron || 20);
    const filmThickness = thicknesses[0];
    const orderWithDensity = input.orders.find(o => activeFilms.includes(o.film) && o.density && !isNaN(o.density));
    const filmDensity = orderWithDensity?.density || filmMasters[0]?.density || 0.91;
    const eligibleOrders = input.orders.filter(o => {
        if (!activeFilms.includes(o.film) || o.width_mm < 355)
            return false;
        if (Number(o.remaining_qty) <= 0.05 && o.status !== 'PENDING' && o.status !== 'PARTIALLY_FULFILLED')
            return false;
        const singleReelKg = (0, weightCalculator_1.calculateSingleReelWeight)(o.width_mm, filmThickness, filmDensity, o.length_m);
        const activeDemand = Math.max(Number(o.remaining_qty || 0), Number(o.balance_qty || 0));
        const orderCeiling = activeDemand * 1.0301;
        return singleReelKg <= orderCeiling;
    });
    // Group by strict Treatment Side
    const treatmentMap = new Map();
    for (const ord of eligibleOrders) {
        const grp = normalizeTreatmentGroup(ord.treatment_side);
        if (!treatmentMap.has(grp)) {
            treatmentMap.set(grp, []);
        }
        treatmentMap.get(grp).push(ord);
    }
    // If there's at most 1 treatment side present in the backlog, run standard optimizer directly
    if (treatmentMap.size <= 1) {
        return executeSingleTreatmentGroupOptimization(input);
    }
    // Multiple Treatment Sides present: Separate into distinct planning groups
    const groupOrder = ['OUTSIDE', 'INSIDE', 'BOTH SIDE', 'NONE'];
    const presentGroups = groupOrder.filter(g => treatmentMap.has(g) && treatmentMap.get(g).length > 0);
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filmRunKey = activeFilms.map(f => f.replace(/[^a-zA-Z0-9]/g, '')).join('_');
    const runNumber = input.run_number || `RUN-${filmRunKey}-${dateStr}-${Math.floor(100 + Math.random() * 900)}`;
    const allGeneratedPlans = [];
    let cumulativePlannedKg = 0;
    let currentPlanIndex = 1;
    const allLogs = [];
    let logStep = 1;
    function addMasterLog(message, type = 'INFO', data) {
        allLogs.push({ step: logStep++, message, type, data });
    }
    const filmDisplay = activeFilms.join(' + ');
    addMasterLog(`Starting Treatment Side Multi-Group Planning Session ${runNumber} for Film [${filmDisplay}]`);
    addMasterLog(`Strict Treatment Separation Active: Identified ${presentGroups.length} separate groups: ${presentGroups.join(', ')}`);
    const updatedOrdersMap = new Map();
    // Seed with all original orders so untouched orders are preserved
    input.orders.forEach(o => {
        updatedOrdersMap.set(o.id, { ...o, remaining_qty: Number(o.remaining_qty), produced_qty: Number(o.produced_qty || 0) });
    });
    const totalDemandKg = eligibleOrders.reduce((sum, o) => sum + Number(o.remaining_qty), 0);
    const targetKg = input.target_quantity_kg !== undefined && input.target_quantity_kg > 0
        ? input.target_quantity_kg
        : totalDemandKg;
    const isTargetQuantityMode = input.planning_mode === 'TARGET_QUANTITY' || input.target_quantity_kg !== undefined;
    const targetMaxKg = targetKg * 1.03;
    for (const groupKey of presentGroups) {
        const groupOrders = treatmentMap.get(groupKey);
        const groupDemandKg = groupOrders.reduce((sum, o) => sum + Number(o.remaining_qty), 0);
        let groupTargetKg = undefined;
        if (isTargetQuantityMode) {
            const remainingTarget = Math.max(0, targetKg - cumulativePlannedKg);
            if (remainingTarget <= 0 || cumulativePlannedKg >= targetKg) {
                addMasterLog(`Skipping Treatment Group [${groupKey}]: Target quantity already reached (${cumulativePlannedKg.toFixed(2)} kg / ${targetKg.toLocaleString()} kg).`, 'INFO');
                break;
            }
            groupTargetKg = Math.min(groupDemandKg, remainingTarget);
        }
        addMasterLog(`>>> Planning Treatment Side Group: [${groupKey}] (${groupOrders.length} orders, Demand: ${groupDemandKg.toLocaleString()} kg) <<<`, 'INFO');
        const groupInput = {
            ...input,
            orders: groupOrders,
            target_quantity_kg: groupTargetKg,
            run_number: runNumber,
        };
        const groupResult = executeSingleTreatmentGroupOptimization(groupInput, currentPlanIndex, runNumber);
        if (groupResult.plans.length > 0) {
            allGeneratedPlans.push(...groupResult.plans);
            currentPlanIndex += groupResult.plans.length;
            cumulativePlannedKg += groupResult.run.planned_quantity_kg;
        }
        // Update remaining orders from this group
        groupResult.remaining_orders.forEach(upd => {
            updatedOrdersMap.set(upd.id, upd);
        });
        // Merge logs
        groupResult.logs.forEach(l => {
            allLogs.push({
                step: logStep++,
                message: `[${groupKey}] ${l.message}`,
                type: l.type,
                data: l.data,
            });
        });
    }
    const allUpdatedOrders = Array.from(updatedOrdersMap.values());
    const closedCount = allUpdatedOrders.filter(o => activeFilms.includes(o.film) && o.status === 'COMPLETED').length;
    const partialCount = allUpdatedOrders.filter(o => activeFilms.includes(o.film) && o.status === 'PARTIALLY_FULFILLED').length;
    const remainingCount = allUpdatedOrders.filter(o => activeFilms.includes(o.film) && o.remaining_qty > 0).length;
    const targetDeviationPercent = isTargetQuantityMode && targetKg > 0
        ? Math.round(((cumulativePlannedKg - targetKg) / targetKg) * 10000) / 100
        : 0;
    const overallStatus = allGeneratedPlans.length > 0 ? 'COMPLETED' : 'NO_FEASIBLE_MATCH';
    const overallStopReason = allGeneratedPlans.length > 0
        ? `Completed separate planning across ${presentGroups.length} Treatment Side group(s) with ${allGeneratedPlans.length} plan(s).`
        : `No feasible plans found for the requested Treatment Side groups.`;
    const rules = input.rules || masterData_1.DEFAULT_PLANNING_RULES;
    const trimRuleMode = input.trim_rule_mode || 'NORMAL';
    let activeMinTrim = rules.min_trim_mm || 160;
    let activeMaxTrim = rules.max_trim_mm || 220;
    if (trimRuleMode === 'RELAXED_50MM') {
        activeMinTrim = 50;
        activeMaxTrim = rules.max_trim_mm || 220;
    }
    else if (trimRuleMode === 'MANUAL_OVERRIDE') {
        activeMinTrim = input.custom_min_trim_mm !== undefined ? input.custom_min_trim_mm : 50;
        activeMaxTrim = input.custom_max_trim_mm !== undefined ? input.custom_max_trim_mm : 300;
    }
    const planningRun = {
        id: `run-${runNumber}`,
        run_number: runNumber,
        film: filmDisplay,
        films: activeFilms,
        target_quantity_kg: targetKg,
        planned_quantity_kg: Math.round(cumulativePlannedKg * 100) / 100,
        remaining_quantity_kg: Math.max(0, Math.round((totalDemandKg - cumulativePlannedKg) * 100) / 100),
        target_min_kg: undefined,
        target_max_kg: isTargetQuantityMode ? targetMaxKg : undefined,
        target_deviation_percent: targetDeviationPercent,
        planning_mode: input.planning_mode,
        priority_so_items: Array.from(input.priority_order_ids || []),
        status: overallStatus,
        stop_reason: overallStopReason,
        rules_version: rules.version || '1.0',
        optimizer_version: '3.2.0-elastic-duplex-optimizer',
        trim_rule_mode: trimRuleMode,
        min_trim_mm_used: activeMinTrim,
        max_trim_mm_used: activeMaxTrim,
        trim_override_reason: input.trim_override_reason,
        trim_override_by: input.created_by,
        created_by: input.created_by || 'M.USMAN (Planner)',
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        plans_count: allGeneratedPlans.length,
        orders_closed_count: closedCount,
        orders_partial_count: partialCount,
        orders_remaining_count: remainingCount,
    };
    addMasterLog(`Multi-Group Treatment Planning finished with status [${overallStatus}]. Total Plans: ${allGeneratedPlans.length} · Output: ${cumulativePlannedKg.toLocaleString()} kg · Closed: ${closedCount} Orders.`);
    return {
        run: planningRun,
        plans: allGeneratedPlans,
        remaining_orders: allUpdatedOrders,
        logs: allLogs,
        status: overallStatus,
        stop_reason: overallStopReason,
        suggest_trim_relaxation: allGeneratedPlans.length === 0,
    };
}
